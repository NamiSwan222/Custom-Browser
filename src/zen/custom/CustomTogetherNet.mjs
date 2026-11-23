// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Browse Together, network: everything goes straight between the browsers on
// a LAN or a virtual LAN (Radmin VPN, Hamachi, Tailscale), with no server in
// between. One browser hosts a room (a TCP listener), the others join it, and
// the host passes each message on to everyone else.
//
// Messages are JSON objects, one per line (UTF-8). Hosts are found with a
// small UDP multicast announcement, which LAN-emulating VPNs pass along like
// a real LAN; typing the host's address always works too.

export const TOGETHER_VERSION = 1;
export const DEFAULT_PORT = 47110;
export const DISCOVERY_PORT = 47111;
const DISCOVERY_GROUP = "239.255.74.74";
const DISCOVERY_APP = "custom-together";

// A connection's unread input past this is a broken or hostile peer.
const MAX_BUFFERED_INPUT = 16 * 1024 * 1024;

const encoder = new TextEncoder();

// Addresses a room accepts and announces on: this machine, home and office
// networks, and the VPNs people use as a LAN. Anything else is the internet.
export function isPrivateAddress(address) {
  const ip = String(address || "").replace(/^::ffff:/i, "");
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
    return ip === "::1";
  }
  const [a, b] = parts;
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    a === 26 || // Radmin VPN
    a === 25 || // Hamachi
    (a === 100 && b >= 64 && b <= 127) // Tailscale and other CGNAT VPNs
  );
}

// This machine's IPv4 addresses on private networks, from resolving its own
// host name (Windows answers with every interface's address).
export function localAddresses() {
  return new Promise(resolve => {
    const found = new Set();
    const finish = () => {
      const list = [...found].filter(ip => isPrivateAddress(ip) && !ip.startsWith("127."));
      // Radmin and other VPNs first: they are what a friend elsewhere can reach.
      list.sort((x, y) => Number(/^(26|25|100)\./.test(y)) - Number(/^(26|25|100)\./.test(x)));
      resolve(list);
    };
    try {
      Services.dns.asyncResolve(
        Services.dns.myHostName,
        Ci.nsIDNSService.RESOLVE_TYPE_DEFAULT,
        Ci.nsIDNSService.RESOLVE_DISABLE_IPV6,
        null,
        {
          onLookupComplete(_request, record, status) {
            if (Components.isSuccessCode(status) && record) {
              record.QueryInterface(Ci.nsIDNSAddrRecord);
              while (record.hasMore()) {
                found.add(record.getNextAddrAsString());
              }
            }
            finish();
          },
        },
        Services.tm.mainThread
      );
    } catch {
      finish();
    }
  });
}

// One JSON-lines connection over a TCP socket transport.
export class TogetherConnection {
  #transport;
  #input;
  #output;
  #reader;
  #decoder = new TextDecoder();
  #buffer = "";
  #queue = [];
  #queuedBytes = 0;
  #waitingForOutput = false;
  #closed = false;

  constructor(transport, { onMessage, onClose, onOpen } = {}) {
    this.#transport = transport;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.onOpen = onOpen;
    this.lastHeard = Date.now();
    this.#input = transport
      .openInputStream(0, 0, 0)
      .QueryInterface(Ci.nsIAsyncInputStream);
    // A large buffer: live tab view frames are tens of kilobytes each.
    this.#output = transport
      .openOutputStream(0, 65536, 128)
      .QueryInterface(Ci.nsIAsyncOutputStream);
    this.#reader = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(
      Ci.nsIScriptableInputStream
    );
    this.#reader.init(this.#input);
    this.#waitForInput();
  }

  // Connects to host:port.
  static connect(host, port, handlers) {
    const transport = Cc["@mozilla.org/network/socket-transport-service;1"]
      .getService(Ci.nsISocketTransportService)
      .createTransport([], host, port, null, null);
    transport.setTimeout(Ci.nsISocketTransport.TIMEOUT_CONNECT, 8);
    return new TogetherConnection(transport, handlers);
  }

  get isClosed() {
    return this.#closed;
  }

  get peerAddress() {
    try {
      return this.#transport.getScriptablePeerAddr().address;
    } catch {
      return "";
    }
  }

  // Bytes waiting to go out; senders of optional data (live view frames) skip
  // a frame instead of piling up behind a slow link.
  get queuedBytes() {
    return this.#queuedBytes;
  }

  #waitForInput() {
    this.#input.asyncWait(
      { onInputStreamReady: () => this.#onInput() },
      0,
      0,
      Services.tm.mainThread
    );
  }

  #onInput() {
    if (this.#closed) {
      return;
    }
    let available;
    try {
      available = this.#input.available();
    } catch (e) {
      this.close(e.result === Cr.NS_BASE_STREAM_CLOSED ? "closed" : "unreachable");
      return;
    }
    if (available === 0) {
      this.close("closed");
      return;
    }
    if (!this.opened) {
      this.opened = true;
    }
    const raw = this.#reader.readBytes(available);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }
    this.#buffer += this.#decoder.decode(bytes, { stream: true });
    this.lastHeard = Date.now();
    let newline;
    while ((newline = this.#buffer.indexOf("\n")) >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (!line) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message && typeof message === "object" && typeof message.t === "string") {
        try {
          this.onMessage?.(message, this);
        } catch (e) {
          console.error("Browse Together: message handler failed", e);
        }
      }
      if (this.#closed) {
        return;
      }
    }
    if (this.#buffer.length > MAX_BUFFERED_INPUT) {
      this.close("too much data");
      return;
    }
    this.#waitForInput();
  }

  send(message) {
    if (this.#closed) {
      return false;
    }
    const bytes = encoder.encode(JSON.stringify(message) + "\n");
    let chunk = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      chunk += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    this.#queue.push(chunk);
    this.#queuedBytes += chunk.length;
    this.#flush();
    return true;
  }

  #flush() {
    while (this.#queue.length && !this.#closed) {
      const chunk = this.#queue[0];
      let written;
      try {
        written = this.#output.write(chunk, chunk.length);
      } catch (e) {
        if (e.result === Cr.NS_BASE_STREAM_WOULD_BLOCK) {
          this.#waitForOutput();
        } else {
          this.close("connection lost");
        }
        return;
      }
      this.#queuedBytes -= written;
      if (written < chunk.length) {
        this.#queue[0] = chunk.slice(written);
        this.#waitForOutput();
        return;
      }
      this.#queue.shift();
    }
  }

  #waitForOutput() {
    if (this.#waitingForOutput || this.#closed) {
      return;
    }
    this.#waitingForOutput = true;
    this.#output.asyncWait(
      {
        onOutputStreamReady: () => {
          this.#waitingForOutput = false;
          this.#flush();
        },
      },
      0,
      0,
      Services.tm.mainThread
    );
  }

  close(reason = "closed") {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#queue = [];
    this.#queuedBytes = 0;
    for (const stream of [this.#input, this.#output]) {
      try {
        stream.close();
      } catch {}
    }
    try {
      this.#transport.close(Cr.NS_OK);
    } catch {}
    try {
      this.onClose?.(reason, this);
    } catch (e) {
      console.error("Browse Together: close handler failed", e);
    }
  }
}

// The host's listener. Connections from outside private networks are closed
// at once (see isPrivateAddress).
export class TogetherServer {
  #socket = null;

  constructor({ port = DEFAULT_PORT, onConnection }) {
    this.port = port;
    this.onConnection = onConnection;
  }

  start() {
    const socket = Cc["@mozilla.org/network/server-socket;1"].createInstance(
      Ci.nsIServerSocket
    );
    socket.init(this.port, false, -1);
    socket.asyncListen({
      onSocketAccepted: (_server, transport) => {
        let address = "";
        try {
          address = transport.getScriptablePeerAddr().address;
        } catch {}
        if (!isPrivateAddress(address)) {
          transport.close(Cr.NS_ERROR_ABORT);
          return;
        }
        this.onConnection?.(transport, address);
      },
      onStopListening: () => {},
    });
    this.#socket = socket;
  }

  stop() {
    try {
      this.#socket?.close();
    } catch {}
    this.#socket = null;
  }
}

// Hosts announce their room every couple of seconds; anyone with the Together
// panel open listens and lists them.
export class TogetherDiscovery {
  #listener = null;
  #senders = [];
  #addresses = [];

  constructor(addresses) {
    this.#addresses = addresses;
  }

  #newSocket(port, reuse) {
    const socket = Cc["@mozilla.org/network/udp-socket;1"].createInstance(
      Ci.nsIUDPSocket
    );
    socket.init(port, false, Services.scriptSecurityManager.getSystemPrincipal(), reuse);
    return socket;
  }

  listen(onFound) {
    if (this.#listener) {
      return;
    }
    try {
      const socket = this.#newSocket(DISCOVERY_PORT, true);
      try {
        socket.joinMulticast(DISCOVERY_GROUP, "");
      } catch {}
      for (const address of this.#addresses) {
        try {
          socket.joinMulticast(DISCOVERY_GROUP, address);
        } catch {}
      }
      socket.asyncListen({
        onPacketReceived: (_socket, message) => {
          let data;
          try {
            data = JSON.parse(new TextDecoder().decode(new Uint8Array(message.rawData)));
          } catch {
            return;
          }
          const from = message.fromAddr?.address;
          if (data?.app !== DISCOVERY_APP || !isPrivateAddress(from)) {
            return;
          }
          onFound({
            name: String(data.name || "").slice(0, 40),
            port: Number(data.port) || DEFAULT_PORT,
            guests: Number(data.guests) || 0,
            address: from,
          });
        },
        onStopListening: () => {},
      });
      this.#listener = socket;
    } catch (e) {
      console.warn("Browse Together: cannot listen for rooms", e);
    }
  }

  announce({ name, port, guests }) {
    const bytes = Array.from(
      encoder.encode(JSON.stringify({ app: DISCOVERY_APP, v: TOGETHER_VERSION, name, port, guests }))
    );
    if (!this.#senders.length) {
      // One sender per network, so the announcement goes out on each one
      // (LAN and VPN), plus one on the system's default route.
      for (const address of [...this.#addresses, ""]) {
        try {
          const socket = this.#newSocket(-1, false);
          if (address) {
            socket.multicastInterface = address;
          }
          this.#senders.push(socket);
        } catch {}
      }
    }
    for (const socket of this.#senders) {
      try {
        socket.send(DISCOVERY_GROUP, DISCOVERY_PORT, bytes);
      } catch {}
    }
  }

  stop() {
    for (const socket of [this.#listener, ...this.#senders]) {
      try {
        socket?.close();
      } catch {}
    }
    this.#listener = null;
    this.#senders = [];
  }
}
