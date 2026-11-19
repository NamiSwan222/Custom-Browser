// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Browse Together: browse with friends on the same LAN or virtual LAN (Radmin
// VPN, Hamachi, Tailscale), browser to browser, with no server.
//
// One person hosts a room from the Together button; others find it in the
// list (or type the host's address) and join with the room code, once the
// host accepts them. Then:
// - Shared tabs: the host's shared tabs open in every guest's window and
//   follow the host's navigation; a guest navigating a shared tab moves it for
//   everyone. Only page addresses travel, never cookies or logins: each person
//   loads pages with their own.
// - Follow: guests follow the host's current tab and scrolling, until they
//   pick another tab themselves.
// - Pointers, pings (Alt+click) and chat.
// - Video: play, pause, seek and speed stay in step on shared pages.
// - Live tab view: anyone can show their current tab as a picture stream, for
//   pages the others can't open (a page only they are logged into).
//
// The host only shares tabs it marks (or all, by choice), can pause sharing,
// accepts each guest, and the room only takes connections from private
// networks. Private windows can't use Together.
//
// Network: JessnixTogetherNet.mjs. Page side: JessnixTogetherChild.sys.mjs.

import {
  DEFAULT_PORT,
  TOGETHER_VERSION,
  TogetherConnection,
  TogetherDiscovery,
  TogetherServer,
  isPrivateAddress,
  localAddresses,
} from "chrome://browser/content/zen-components/JessnixTogetherNet.mjs";


const PREF_NAME = "jessnix.together.name";
const PREF_PORT = "jessnix.together.port";
// On while a session runs in any window; the page actor only runs then.
const PREF_ACTIVE = "jessnix.together.active";
// Set once the button has been put on the toolbar, so removing it sticks.
const PREF_BUTTON_PLACED = "jessnix.together.button-placed";
// Remember friends: the last room joined, saved friends, and (host) the same
// room code every time.
const PREF_LAST_ROOM = "jessnix.together.last-room";
const PREF_FRIENDS = "jessnix.together.friends";
const PREF_KEEP_CODE = "jessnix.together.keep-code";
const PREF_SAVED_CODE = "jessnix.together.code";
// Voice: 16 kHz mono 16-bit samples (about 32 KB/s per speaker), played a
// little behind real time to smooth out the network.
const VOICE_RATE = 16000;
const VOICE_DELAY_S = 0.12;
// Refusal reasons travel as an id (for this browser's strings) and as text
// (for older versions).
const REJECT_IDS = {
  version: "jessnix-together-reject-version",
  code: "jessnix-together-reject-code",
  declined: "jessnix-together-reject-declined",
  ended: "jessnix-together-reject-ended",
};

const BUTTON_ID = "jessnix-together-button";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const ACTOR_NAME = "JessnixTogether";

const COLORS = ["#ff6b6b", "#4dabf7", "#51cf66", "#fcc419", "#cc5de8", "#ff922b", "#20c997", "#f06595"];
const KEEPALIVE_MS = 10000;
const PEER_TIMEOUT_MS = 35000;
const ANNOUNCE_MS = 2000;
const FOUND_HOST_TTL_MS = 7000;
const CURSOR_TTL_MS = 8000;
const VIEW_INTERVAL_MS = 400;
const VIEW_MAX_WIDTH = 1280;
// Skip a live view frame while this much is still waiting to go out.
const VIEW_BACKLOG_BYTES = 600 * 1024;
const MAX_CHAT = 200;

// Pages shared by address: web pages, and the new tab page. Anything else
// (settings, local files, extension pages) shows as a blank page to others.
function shareableURL(url) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (url === "about:newtab" || url === "about:home" || url === "about:blank") {
    return url;
  }
  return "about:blank";
}

// Pages the room opens load as if from nowhere (a null principal), except the
// browser's own blank and new tab pages, which a null principal may not open.
function principalFor(url) {
  return url === "about:newtab" || url === "about:home" || url === "about:blank"
    ? Services.scriptSecurityManager.getSystemPrincipal()
    : Services.scriptSecurityManager.createNullPrincipal({});
}

// Addresses a page may be sent to from the room: web pages only.
function isWebURL(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url) && url.length < 8192;
}

// Which network an address is on, as people know them.
function networkName(address) {
  if (/^26\./.test(address)) {
    return "Radmin VPN";
  }
  if (/^25\./.test(address)) {
    return "Hamachi";
  }
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)) {
    return "VPN";
  }
  if (/^127\./.test(address)) {
    return "this PC";
  }
  return "LAN";
}

function randomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }
  return code;
}

function cleanName(name) {
  return String(name || "").replace(/\s+/g, " ").trim().slice(0, 24) || "Friend";
}

// Colours from the network end up in the browser's own styles: only #rrggbb.
function cleanColor(color) {
  return /^#[0-9a-f]{6}$/i.test(String(color)) ? color : "#999999";
}

// What a page process may report, rebuilt from known fields only: a page's
// process is untrusted, so nothing else it sends reaches the room.
const PAGE_KINDS = new Set(["cursor", "cursor-hide", "scroll", "ping", "media"]);
const MEDIA_ACTIONS = new Set(["play", "pause", "seeked", "ratechange"]);

function fraction(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function pageEventFrom(data) {
  const kind = data?.kind;
  if (!PAGE_KINDS.has(kind)) {
    return null;
  }
  switch (kind) {
    case "cursor":
    case "ping":
      return { kind, x: fraction(data.x), y: fraction(data.y) };
    case "scroll":
      return { kind, fx: fraction(data.fx), fy: fraction(data.fy) };
    case "media": {
      const time = Number(data.time);
      const rate = Number(data.rate);
      return {
        kind,
        action: MEDIA_ACTIONS.has(data.action) ? data.action : "seeked",
        time: Number.isFinite(time) && time >= 0 ? time : 0,
        paused: !!data.paused,
        rate: Number.isFinite(rate) && rate > 0 && rate <= 16 ? rate : 1,
      };
    }
    default:
      return { kind };
  }
}

class nsJessnixTogether {
  // null, "host" or "guest".
  role = null;
  // Guest: connected, waiting for the host to accept.
  isWaiting = false;
  me = { id: "", name: "", color: COLORS[0] };
  // Everyone in the room but me: id -> { id, name, color }.
  peers = new Map();
  chat = [];
  status = "";
  unread = 0;

  // Host.
  #server = null;
  #code = "";
  #addresses = [];
  #guests = new Map(); // id -> { conn, name, color, approved }
  #nextGuest = 1;
  #tabIds = new WeakMap();
  #nextTab = 1;
  shareAll = false;
  isPaused = false;
  #tabsTimer = null;

  // Guest.
  #conn = null;
  #mirrors = new Map(); // host tab id -> my tab
  #expectedURL = new WeakMap(); // my mirror tab -> the address the room gave it
  #closedByMe = new Set(); // host tab ids I closed: not opened again
  #removingMirror = false;
  #selectingForFollow = false;
  hostName = "";
  hostActive = null;
  follow = true;

  // Both.
  #discovery = null;
  #announceTimer = null;
  #keepaliveTimer = null;
  foundHosts = new Map(); // "address:port" -> { name, address, port, guests, seen }
  #cursors = new Map(); // peer id -> { tabId, x, y, seen, el }
  #overlay = null;
  #panel = null;
  #viewTimer = null;
  // The one tab live view shows: switching to another tab never sends that one.
  #viewBrowser = null;
  #viewBusy = false;
  isShowingView = false;
  #remoteView = null; // { from, el, img, title }
  #progressListener = null;
  #tabEvents = null;

  // 2.0: voice, watch party, shared board, a guest driving, friends.
  voice = { on: false, muted: false, stream: null, capture: null };
  #voiceIn = new Map(); // speaker id -> { next, received }
  #playContext = null;
  talking = new Set();
  party = false;
  readyCheck = false;
  ready = new Set();
  iAmReady = false;
  board = [];
  #nextBoardId = 1;
  driver = null;
  #joinTarget = null; // { address, port, code } of the room joined

  init() {
    // The page actor is registered at startup (ZenActorsManager.sys.mjs).
    document.l10n.addResourceIds(["browser/jessnix-together.ftl"]);
    this.me.name = cleanName(Services.prefs.getStringPref(PREF_NAME, ""));
    if (!this.#otherWindowSession()) {
      Services.prefs.setBoolPref(PREF_ACTIVE, false);
    }
    this.#createButton();
    window.addEventListener("unload", () => this.leave({ quiet: true }), { once: true });
  }

  get isPrivate() {
    return PrivateBrowsingUtils.isWindowPrivate(window);
  }

  get inSession() {
    return !!this.role;
  }

  get code() {
    return this.#code;
  }

  get addresses() {
    return this.#addresses;
  }

  get port() {
    return Services.prefs.getIntPref(PREF_PORT, DEFAULT_PORT);
  }

  #otherWindowSession() {
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      if (win !== window && win.gJessnixTogether?.inSession) {
        return true;
      }
    }
    return false;
  }

  // ---- Button and panel -------------------------------------------------

  #createButton() {
    const CUI = CustomizableUI;
    if (!CUI.getWidget(BUTTON_ID)?.provider || CUI.getWidget(BUTTON_ID).provider !== CUI.PROVIDER_API) {
      try {
        CUI.createWidget({
          id: BUTTON_ID,
          type: "button",
          l10nId: "jessnix-together-button",
          label: "Browse Together",
          tooltiptext: "Browse Together: browse with friends on your network",
          defaultArea: CUI.AREA_NAVBAR,
          // ownerDocument.defaultView: this runs in CustomizableUI's module,
          // where ownerGlobal isn't reachable.
          onCommand: event => event.target.ownerDocument.defaultView.gJessnixTogether?.togglePanel(event.target),
        });
      } catch (e) {
        if (!String(e).includes("already")) {
          console.error("Browse Together: cannot create the button", e);
        }
      }
    }
    if (!Services.prefs.getBoolPref(PREF_BUTTON_PLACED, false)) {
      Services.prefs.setBoolPref(PREF_BUTTON_PLACED, true);
      if (!CUI.getPlacementOfWidget(BUTTON_ID)) {
        CUI.addWidgetToArea(BUTTON_ID, CUI.AREA_NAVBAR);
      }
    }
  }

  get #button() {
    return document.getElementById(BUTTON_ID);
  }

  #updateButton() {
    const button = this.#button;
    if (!button) {
      return;
    }
    button.toggleAttribute("jessnix-together-active", this.inSession);
    if (this.unread || this.#pendingCount()) {
      button.setAttribute("badge", String(this.unread + this.#pendingCount()));
      button.classList.add("toolbarbutton-badge-stack");
    } else {
      button.removeAttribute("badge");
    }
  }

  #pendingCount() {
    if (this.role !== "host") {
      return 0;
    }
    return [...this.#guests.values()].filter(g => !g.approved).length;
  }

  #ensurePanel() {
    if (this.#panel) {
      return this.#panel;
    }
    const panel = document.createXULElement("panel");
    panel.id = "jessnix-together-panel";
    panel.setAttribute("type", "arrow");
    panel.setAttribute("noautofocus", "true");
    panel.addEventListener("popupshown", () => {
      this.unread = 0;
      this.#updateButton();
      this.#listenForRooms();
    });
    panel.addEventListener("popuphidden", () => {
      if (!this.inSession) {
        this.#stopListeningForRooms();
      }
    });
    const body = document.createElementNS(HTML_NS, "div");
    body.className = "jessnix-together-body";
    panel.appendChild(body);
    (document.getElementById("mainPopupSet") || document.documentElement).appendChild(panel);
    this.#panel = panel;
    return panel;
  }

  togglePanel(anchor) {
    const panel = this.#ensurePanel();
    if (panel.state === "open" || panel.state === "showing") {
      panel.hidePopup();
      return;
    }
    this.render();
    panel.openPopup(anchor || this.#button, "bottomright topright", 0, 0, false);
  }

  #el(tag, props = {}, ...children) {
    const el = document.createElementNS(HTML_NS, tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) {
        continue;
      }
      if (key === "l10n") {
        document.l10n.setAttributes(el, value, props.args || undefined);
      } else if (key === "args") {
        continue;
      } else if (key === "class") {
        el.className = value;
      } else if (key.startsWith("on")) {
        el.addEventListener(key.slice(2), value);
      } else if (key === "text") {
        el.textContent = value;
      } else if (key === "style") {
        el.setAttribute("style", value);
      } else if (value === true) {
        el.setAttribute(key, "");
      } else {
        el.setAttribute(key, value);
      }
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) {
        continue;
      }
      el.append(typeof child === "string" ? child : child);
    }
    return el;
  }

  #toggle(l10n, checked, onChange) {
    const input = this.#el("input", { type: "checkbox" });
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    return this.#el("label", { class: "jessnix-together-toggle" }, input, this.#el("span", { l10n }));
  }

  #person(person, extras = []) {
    return this.#el(
      "div",
      { class: "jessnix-together-person" },
      this.#el("span", { class: "jessnix-together-dot", style: `background:${person.color}` }),
      this.#el("span", { text: person.name }),
      extras
    );
  }

  render() {
    const body = this.#panel?.querySelector(".jessnix-together-body");
    if (!body) {
      return;
    }
    const focused = document.activeElement;
    const drafts = {};
    for (const input of body.querySelectorAll("input[data-keep]")) {
      drafts[input.dataset.keep] = input.value;
    }
    const keepFocus = focused?.dataset?.keep;
    body.replaceChildren(...this.#renderBody().filter(Boolean));
    for (const input of body.querySelectorAll("input[data-keep]")) {
      if (drafts[input.dataset.keep] !== undefined) {
        input.value = drafts[input.dataset.keep];
      }
      if (keepFocus && input.dataset.keep === keepFocus) {
        input.focus();
      }
    }
    const log = body.querySelector(".jessnix-together-chat-log");
    if (log) {
      log.scrollTop = log.scrollHeight;
    }
  }

  #renderBody() {
    const out = [this.#el("h2", { class: "jessnix-together-title", l10n: "jessnix-together-title" })];
    if (this.isPrivate) {
      out.push(this.#el("p", { class: "jessnix-together-muted", l10n: "jessnix-together-private" }));
      return out;
    }
    if (!this.inSession && this.#otherWindowSession()) {
      out.push(this.#el("p", { class: "jessnix-together-muted", l10n: "jessnix-together-other-window" }));
      return out;
    }
    if (this.status) {
      out.push(this.#el("p", { class: "jessnix-together-status", l10n: this.status.id, args: this.status.args }));
    }
    if (!this.inSession) {
      out.push(...this.#renderLobby());
    } else if (this.role === "host") {
      out.push(...this.#renderHost());
    } else {
      out.push(...this.#renderGuest());
    }
    return out;
  }

  #renderLobby() {
    const nameInput = this.#el("input", { type: "text", maxlength: "24", l10n: "jessnix-together-name", "data-keep": "name" });
    nameInput.value = this.me.name === "Friend" ? "" : this.me.name;
    nameInput.addEventListener("change", () => {
      this.me.name = cleanName(nameInput.value);
      Services.prefs.setStringPref(PREF_NAME, this.me.name);
    });
    const address = this.#el("input", { type: "text", l10n: "jessnix-together-address", "data-keep": "address" });
    const code = this.#el("input", { type: "text", maxlength: "4", l10n: "jessnix-together-code", class: "jessnix-together-code", "data-keep": "code" });
    const join = () => this.join(address.value, code.value);
    code.addEventListener("keydown", e => e.key === "Enter" && join());
    const fill = (target, focusCode = true) => {
      address.value = target.port === DEFAULT_PORT ? target.address : `${target.address}:${target.port}`;
      if (target.code) {
        code.value = target.code;
      }
      if (focusCode) {
        code.focus();
      }
    };

    const now = Date.now();
    const rooms = [...this.foundHosts.values()].filter(h => now - h.seen < FOUND_HOST_TTL_MS);
    const last = this.lastRoom;
    const friends = this.friends;
    return [
      this.#el(
        "div",
        { class: "jessnix-together-row" },
        this.#el("span", { class: "jessnix-together-label", l10n: "jessnix-together-name-label" }),
        nameInput
      ),
      this.#el("button", { class: "jessnix-together-primary", l10n: "jessnix-together-host", onclick: () => this.host() }),
      this.#toggle("jessnix-together-keep-code", Services.prefs.getBoolPref(PREF_KEEP_CODE, false), value =>
        Services.prefs.setBoolPref(PREF_KEEP_CODE, value)
      ),
      this.#el("h3", { l10n: "jessnix-together-join-header" }),
      last
        ? this.#el("button", {
            l10n: "jessnix-together-rejoin",
            args: { name: last.name },
            onclick: () => this.join(last.port === DEFAULT_PORT ? last.address : `${last.address}:${last.port}`, last.code),
          })
        : null,
      rooms.length
        ? this.#el(
            "div",
            { class: "jessnix-together-list" },
            rooms.map(room =>
              this.#el(
                "div",
                { class: "jessnix-together-room" },
                this.#el("span", { l10n: "jessnix-together-room-name", args: { name: room.name } }),
                this.#el("span", {
                  class: "jessnix-together-muted",
                  l10n: "jessnix-together-room-details",
                  args: { network: networkName(room.address), address: room.address, guests: room.guests },
                }),
                this.#el("button", { l10n: "jessnix-together-use", onclick: () => fill(room) })
              )
            )
          )
        : this.#el("p", { class: "jessnix-together-muted", l10n: "jessnix-together-looking" }),
      friends.length ? this.#el("h3", { l10n: "jessnix-together-friends-header" }) : null,
      friends.length
        ? this.#el(
            "div",
            { class: "jessnix-together-list" },
            friends.map(friend =>
              this.#el(
                "div",
                { class: "jessnix-together-room" },
                this.#el("span", { text: friend.name }),
                this.#el("span", { class: "jessnix-together-muted", text: friend.address }),
                this.#el("button", { l10n: "jessnix-together-use", onclick: () => fill(friend) }),
                this.#el("button", { l10n: "jessnix-together-remove", onclick: () => this.removeFriend(friend) })
              )
            )
          )
        : null,
      this.#el("div", { class: "jessnix-together-row" }, address, code, this.#el("button", { l10n: "jessnix-together-join", onclick: join })),
      this.#el("p", { class: "jessnix-together-muted", l10n: "jessnix-together-privacy-note" }),
    ];
  }

  #peopleList() {
    const extras = person => {
      const out = [];
      if (person.id === this.me.id) {
        out.push(this.#el("span", { class: "jessnix-together-muted", l10n: this.role === "host" ? "jessnix-together-you-host" : "jessnix-together-you" }));
      } else if (person.isHost) {
        out.push(this.#el("span", { class: "jessnix-together-muted", l10n: "jessnix-together-host-label" }));
      }
      if (this.talking.has(person.id)) {
        out.push(this.#el("span", { l10n: "jessnix-together-talking" }));
      }
      if (this.driver && this.driver === person.id) {
        out.push(this.#el("span", { class: "jessnix-together-muted", l10n: "jessnix-together-driving" }));
      }
      if (this.role === "host" && person.id !== this.me.id) {
        out.push(
          this.driver === person.id
            ? this.#el("button", { class: "jessnix-together-small", l10n: "jessnix-together-take-back", onclick: () => this.setDriver(null) })
            : this.#el("button", { class: "jessnix-together-small", l10n: "jessnix-together-let-drive", onclick: () => this.setDriver(person.id) })
        );
      }
      return out;
    };
    const list = [this.#person(this.me, extras(this.me))];
    for (const peer of this.peers.values()) {
      list.push(this.#person(peer, extras(peer)));
    }
    return this.#el("div", { class: "jessnix-together-list" }, list);
  }

  #renderChat() {
    const log = this.#el(
      "div",
      { class: "jessnix-together-chat-log" },
      this.chat.map(line =>
        line.system
          ? this.#el("div", { class: "jessnix-together-chat-system", l10n: line.id, args: line.args })
          : this.#el(
              "div",
              { class: "jessnix-together-chat-line" },
              this.#el("b", { style: `color:${line.color}`, text: `${line.name}: ` }),
              line.text
            )
      )
    );
    const input = this.#el("input", {
      type: "text",
      class: "jessnix-together-chat-input",
      l10n: "jessnix-together-message",
      maxlength: "500",
      "data-keep": "chat",
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && input.value.trim()) {
        this.sendChat(input.value);
        input.value = "";
      }
    });
    return [this.#el("h3", { l10n: "jessnix-together-chat" }), log, input];
  }

  #renderVoice() {
    return [
      this.#el("h3", { l10n: "jessnix-together-voice-header" }),
      this.#el(
        "div",
        { class: "jessnix-together-row" },
        this.#el("button", {
          l10n: this.voice.on ? "jessnix-together-voice-leave" : "jessnix-together-voice-join",
          onclick: () => (this.voice.on ? this.stopVoice() : this.startVoice()),
        }),
        this.voice.on
          ? this.#el("button", {
              l10n: this.voice.muted ? "jessnix-together-unmute" : "jessnix-together-mute",
              onclick: () => this.setMuted(!this.voice.muted),
            })
          : null
      ),
    ];
  }

  #renderParty() {
    const out = [this.#el("h3", { l10n: "jessnix-together-party-header" })];
    if (this.role === "host") {
      out.push(this.#toggle("jessnix-together-party-toggle", this.party, value => this.setParty(value)));
      out.push(
        this.#el(
          "div",
          { class: "jessnix-together-row" },
          this.#el("button", { l10n: "jessnix-together-ready-check", onclick: () => this.startReadyCheck() }),
          this.readyCheck
            ? this.#el("span", {
                class: "jessnix-together-muted",
                l10n: "jessnix-together-ready-count",
                args: { ready: this.ready.size, total: this.peers.size },
              })
            : null,
          this.#el("button", { l10n: "jessnix-together-play-all", onclick: () => this.playForEveryone() })
        )
      );
    } else {
      if (this.party) {
        out.push(this.#el("p", { class: "jessnix-together-muted", l10n: "jessnix-together-party-on" }));
      }
      if (this.readyCheck) {
        out.push(this.#el("p", { l10n: "jessnix-together-ready-asked" }));
        out.push(this.#el("button", { class: "jessnix-together-primary", l10n: "jessnix-together-im-ready", disabled: this.iAmReady || null, onclick: () => this.sendReady() }));
      }
    }
    return out.length > 1 ? out : [];
  }

  #renderBoard() {
    const input = this.#el("input", { type: "text", maxlength: "300", l10n: "jessnix-together-board-input", "data-keep": "board" });
    const add = () => {
      if (input.value.trim()) {
        this.boardOp({ op: "add", kind: "todo", text: input.value.trim() });
        input.value = "";
      }
    };
    input.addEventListener("keydown", e => e.key === "Enter" && add());
    return [
      this.#el("h3", { l10n: "jessnix-together-board" }),
      this.board.length
        ? this.#el(
            "div",
            { class: "jessnix-together-list jessnix-together-board" },
            this.board.map(item => {
              const check =
                item.kind === "todo"
                  ? (() => {
                      const box = this.#el("input", { type: "checkbox" });
                      box.checked = !!item.done;
                      box.addEventListener("change", () => this.boardOp({ op: "toggle", id: item.id }));
                      return box;
                    })()
                  : null;
              const label =
                item.kind === "link"
                  ? this.#el("a", {
                      class: "jessnix-together-link",
                      text: item.text || item.url,
                      href: item.url,
                      onclick: event => {
                        event.preventDefault();
                        if (isWebURL(item.url)) {
                          openTrustedLinkIn(item.url, "tab");
                        }
                      },
                    })
                  : this.#el("span", { class: item.done ? "jessnix-together-done" : "", text: item.text });
              return this.#el(
                "div",
                { class: "jessnix-together-board-item" },
                check,
                label,
                this.#el("span", { class: "jessnix-together-muted", text: item.by || "" }),
                this.#el("button", { class: "jessnix-together-small", text: "×", onclick: () => this.boardOp({ op: "remove", id: item.id }) })
              );
            })
          )
        : this.#el("p", { class: "jessnix-together-muted", l10n: "jessnix-together-board-empty" }),
      this.#el(
        "div",
        { class: "jessnix-together-row" },
        input,
        this.#el("button", { l10n: "jessnix-together-add-todo", onclick: add })
      ),
      this.#el("button", {
        l10n: "jessnix-together-add-page",
        onclick: () => {
          const tab = gBrowser.selectedTab;
          const url = tab.linkedBrowser.currentURI?.spec;
          if (isWebURL(url)) {
            this.boardOp({ op: "add", kind: "link", text: String(tab.label || "").slice(0, 200), url });
          }
        },
      }),
    ];
  }

  #renderShareControls() {
    const tab = gBrowser.selectedTab;
    const out = [];
    if (this.role === "host") {
      const shared = tab.hasAttribute("jessnix-together-shared");
      out.push(
        this.#el("button", {
          l10n: shared ? "jessnix-together-stop-share-tab" : "jessnix-together-share-tab",
          disabled: this.shareAll || null,
          onclick: () => this.setTabShared(tab, !shared),
        }),
        this.#toggle("jessnix-together-share-all", this.shareAll, value => {
          this.shareAll = value;
          this.#scheduleTabs();
          this.render();
        }),
        this.#toggle("jessnix-together-pause", this.isPaused, value => {
          this.isPaused = value;
          this.#scheduleTabs();
          this.render();
        })
      );
    } else {
      out.push(
        this.#toggle("jessnix-together-follow", this.follow, value => this.setFollow(value)),
        this.#el("button", { l10n: "jessnix-together-guest-share", onclick: () => this.shareTabAsGuest(tab) })
      );
    }
    out.push(
      this.#el("button", {
        l10n: this.isShowingView ? "jessnix-together-stop-live" : "jessnix-together-show-live",
        onclick: () => (this.isShowingView ? this.stopView() : this.startView()),
      })
    );
    return this.#el("div", { class: "jessnix-together-stack" }, out);
  }

  #renderHost() {
    const pending = [...this.#guests.entries()].filter(([, g]) => !g.approved);
    return [
      this.#el(
        "div",
        { class: "jessnix-together-roominfo" },
        this.#el("div", { l10n: "jessnix-together-room-code" }),
        this.#el("div", { class: "jessnix-together-bigcode", text: this.#code }),
        this.#addresses.length
          ? this.#el("div", {
              class: "jessnix-together-muted",
              l10n: "jessnix-together-your-address",
              args: { addresses: this.#addresses.map(a => (this.port === DEFAULT_PORT ? a : `${a}:${this.port}`)).join("  /  ") },
            })
          : this.#el("div", { class: "jessnix-together-muted", l10n: "jessnix-together-no-address" })
      ),
      pending.length
        ? this.#el(
            "div",
            { class: "jessnix-together-list jessnix-together-pending" },
            pending.map(([id, guest]) =>
              this.#el(
                "div",
                { class: "jessnix-together-room" },
                this.#el("span", { l10n: "jessnix-together-wants-to-join", args: { name: guest.name } }),
                this.#el("span", { class: "jessnix-together-muted", text: guest.conn.peerAddress }),
                this.#el("button", { class: "jessnix-together-primary", l10n: "jessnix-together-accept", onclick: () => this.approve(id) }),
                this.#el("button", { l10n: "jessnix-together-decline", onclick: () => this.decline(id) })
              )
            )
          )
        : null,
      this.#el("h3", { l10n: "jessnix-together-people" }),
      this.#peopleList(),
      this.#renderShareControls(),
      ...this.#renderVoice(),
      ...this.#renderParty(),
      ...this.#renderBoard(),
      ...this.#renderChat(),
      this.#el("button", { class: "jessnix-together-danger", l10n: "jessnix-together-end-room", onclick: () => this.leave() }),
    ];
  }

  #renderGuest() {
    if (this.isWaiting) {
      return [
        this.#el("p", { l10n: "jessnix-together-waiting" }),
        this.#el("button", { l10n: "jessnix-together-cancel", onclick: () => this.leave() }),
      ];
    }
    const isFriend = this.friends.some(f => f.address === this.#joinTarget?.address);
    return [
      this.#el("p", { l10n: "jessnix-together-in-room", args: { name: this.hostName } }),
      this.driver === this.me.id ? this.#el("p", { class: "jessnix-together-status", l10n: "jessnix-together-you-drive" }) : null,
      this.#el("h3", { l10n: "jessnix-together-people" }),
      this.#peopleList(),
      this.#renderShareControls(),
      ...this.#renderVoice(),
      ...this.#renderParty(),
      ...this.#renderBoard(),
      ...this.#renderChat(),
      isFriend
        ? null
        : this.#el("button", { l10n: "jessnix-together-save-friend", args: { name: this.hostName }, onclick: () => this.saveFriend() }),
      this.#el("button", { class: "jessnix-together-danger", l10n: "jessnix-together-leave", onclick: () => this.leave() }),
    ];
  }

  // ---- Finding rooms -----------------------------------------------------

  async #listenForRooms() {
    if (this.#discovery || this.isPrivate) {
      return;
    }
    this.#addresses = await localAddresses();
    this.#discovery = new TogetherDiscovery(this.#addresses);
    this.#discovery.listen(room => {
      if (this.role === "host" && this.#addresses.includes(room.address)) {
        return;
      }
      const key = `${room.address}:${room.port}`;
      const isNew = !this.foundHosts.has(key);
      this.foundHosts.set(key, { ...room, seen: Date.now() });
      if (isNew && !this.inSession) {
        this.render();
      }
    });
  }

  #stopListeningForRooms() {
    if (this.role === "host") {
      return;
    }
    this.#discovery?.stop();
    this.#discovery = null;
  }

  // ---- Hosting -----------------------------------------------------------

  async host() {
    if (this.inSession || this.isPrivate || this.#otherWindowSession()) {
      return;
    }
    this.status = "";
    this.#addresses = await localAddresses();
    this.#server = new TogetherServer({
      port: this.port,
      onConnection: transport => this.#onGuestConnection(transport),
    });
    try {
      this.#server.start();
    } catch (e) {
      this.#server = null;
      this.status = { id: "jessnix-together-status-port", args: { port: this.port } };
      this.render();
      return;
    }
    this.role = "host";
    const saved = Services.prefs.getStringPref(PREF_SAVED_CODE, "");
    this.#code =
      Services.prefs.getBoolPref(PREF_KEEP_CODE, false) && /^[A-Z2-9]{4}$/.test(saved) ? saved : randomCode();
    Services.prefs.setStringPref(PREF_SAVED_CODE, this.#code);
    this.board = [];
    this.party = false;
    this.driver = null;
    this.me = { id: "h", name: this.me.name, color: COLORS[0] };
    this.peers.clear();
    this.chat = [];
    this.#startSession();
    if (!this.#discovery) {
      await this.#listenForRooms();
    }
    this.#announceTimer = setInterval(() => {
      this.#discovery?.announce({
        name: this.me.name,
        port: this.port,
        guests: [...this.#guests.values()].filter(g => g.approved).length,
      });
    }, ANNOUNCE_MS);
    // Start by sharing the tab in front.
    this.setTabShared(gBrowser.selectedTab, true);
    this.#systemLine("jessnix-together-line-open", { code: this.#code });
    this.render();
  }

  #onGuestConnection(transport) {
    const id = `g${this.#nextGuest++}`;
    const guest = { id, name: "", color: COLORS[(this.#nextGuest - 1) % COLORS.length], approved: false, conn: null };
    guest.conn = new TogetherConnection(transport, {
      onMessage: message => this.#onGuestMessage(guest, message),
      onClose: () => this.#onGuestGone(guest),
    });
    // A connection that never says hello is dropped.
    setTimeout(() => {
      if (!guest.name && !guest.conn.isClosed) {
        guest.conn.close("no hello");
      }
    }, 10000);
  }

  #onGuestMessage(guest, message) {
    if (message.t === "hello") {
      if (guest.name) {
        return;
      }
      if (message.v !== TOGETHER_VERSION) {
        guest.conn.send({ t: "reject", reasonId: "version", reason: "Your browser's Together version doesn't match the host's." });
        guest.conn.close("version");
        return;
      }
      if (String(message.code || "").toUpperCase() !== this.#code) {
        guest.conn.send({ t: "reject", reasonId: "code", reason: "Wrong room code." });
        guest.conn.close("code");
        return;
      }
      guest.name = cleanName(message.name);
      this.#guests.set(guest.id, guest);
      this.#notify("jessnix-together-toast-wants", { name: guest.name });
      this.#updateButton();
      this.render();
      return;
    }
    if (!guest.approved) {
      return;
    }
    switch (message.t) {
      case "chat":
        this.#onChat({ from: guest.id, text: message.text });
        this.#relay(guest.id, { t: "chat", from: guest.id, text: String(message.text).slice(0, 500) });
        break;
      case "nav":
        this.#onGuestNavigation(message);
        break;
      case "open":
        if (isWebURL(message.url)) {
          const tab = gBrowser.addTab(message.url, {
            triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
            inBackground: true,
          });
          this.setTabShared(tab, true);
          this.#systemLine("jessnix-together-line-shared", { name: guest.name });
        }
        break;
      case "page":
        // Watch party: only the host (or the driver) controls videos.
        if (message.kind === "media" && this.party && guest.id !== this.driver) {
          break;
        }
        this.#onPage({ ...message, from: guest.id });
        this.#relay(guest.id, { ...message, from: guest.id });
        break;
      case "voice":
        this.#playVoice(guest.id, message.data);
        this.#relay(guest.id, { t: "voice", from: guest.id, data: message.data });
        break;
      case "voice-state":
        this.#onVoiceState(guest.id, !!message.on);
        this.#relay(guest.id, { t: "voice-state", from: guest.id, on: !!message.on });
        break;
      case "ready":
        if (this.readyCheck) {
          this.ready.add(guest.id);
          this.render();
        }
        break;
      case "board-op":
        this.#applyBoardOp(message.op, guest.name);
        break;
      case "select":
        if (guest.id === this.driver) {
          const tab = this.#tabById(message.tabId);
          if (tab && this.#isShared(tab)) {
            gBrowser.selectedTab = tab;
          }
        }
        break;
      case "view":
      case "viewstop":
        this.#onView({ ...message, from: guest.id });
        this.#relay(guest.id, { ...message, from: guest.id });
        break;
      case "bye":
        guest.conn.close("left");
        break;
    }
  }

  approve(id) {
    const guest = this.#guests.get(id);
    if (!guest || guest.approved) {
      return;
    }
    guest.approved = true;
    this.peers.set(id, { id, name: guest.name, color: guest.color });
    guest.conn.send({
      t: "welcome",
      you: { id, color: guest.color },
      host: { id: this.me.id, name: this.me.name, color: this.me.color },
      peers: this.#peerList(),
      ...this.#tabsState(),
      board: this.board,
      party: this.party,
      driver: this.driver,
      talking: [...this.talking],
    });
    this.#broadcast({ t: "peers", list: this.#peerList() });
    // Speakers restart their recording so the newcomer gets a stream header.
    this.#broadcast({ t: "voice-restart" });
    this.#restartVoice();
    this.#systemLine("jessnix-together-line-joined", { name: guest.name });
    this.#updateButton();
    this.render();
  }

  decline(id) {
    const guest = this.#guests.get(id);
    if (!guest) {
      return;
    }
    guest.conn.send({ t: "reject", reasonId: "declined", reason: "The host declined." });
    guest.conn.close("declined");
  }

  #onGuestGone(guest) {
    this.#guests.delete(guest.id);
    if (this.peers.delete(guest.id)) {
      this.#systemLine("jessnix-together-line-left", { name: guest.name });
      this.#broadcast({ t: "peers", list: this.#peerList() });
    }
    if (this.talking.delete(guest.id)) {
      this.#relay(guest.id, { t: "voice-state", from: guest.id, on: false });
    }
    this.#stopVoiceIn(guest.id);
    this.ready.delete(guest.id);
    if (this.driver === guest.id) {
      this.setDriver(null);
    }
    this.#removeCursor(guest.id);
    if (this.#remoteView?.from === guest.id) {
      this.#closeRemoteView();
    }
    this.#updateButton();
    this.render();
  }

  // Everyone the guests should list: the host and approved guests.
  #peerList() {
    return [
      { id: this.me.id, name: this.me.name, color: this.me.color, isHost: true },
      ...[...this.#guests.values()].filter(g => g.approved).map(g => ({ id: g.id, name: g.name, color: g.color })),
    ];
  }

  #broadcast(message, exceptId = null) {
    for (const guest of this.#guests.values()) {
      if (guest.approved && guest.id !== exceptId) {
        guest.conn.send(message);
      }
    }
  }

  #relay(fromId, message) {
    this.#broadcast(message, fromId);
  }

  // ---- Shared tabs (host) --------------------------------------------------

  #tabId(tab) {
    let id = this.#tabIds.get(tab);
    if (!id) {
      id = `t${this.#nextTab++}`;
      this.#tabIds.set(tab, id);
    }
    return id;
  }

  #tabById(id) {
    return gBrowser.tabs.find(tab => this.#tabIds.get(tab) === id);
  }

  #isShared(tab) {
    if (this.isPaused || !tab?.linkedBrowser || tab.closing) {
      return false;
    }
    if (tab.hasAttribute("zen-empty-tab") || tab.hasAttribute("zen-glance-tab")) {
      return false;
    }
    return this.shareAll || tab.hasAttribute("jessnix-together-shared");
  }

  setTabShared(tab, shared) {
    if (this.role !== "host" || !tab) {
      return;
    }
    tab.toggleAttribute("jessnix-together-shared", shared);
    this.#scheduleTabs();
    this.render();
  }

  #tabsState() {
    const tabs = gBrowser.tabs
      .filter(tab => this.#isShared(tab))
      .map(tab => ({
        id: this.#tabId(tab),
        url: shareableURL(tab.linkedBrowser.currentURI?.spec || "about:blank"),
        title: String(tab.label || "").slice(0, 200),
      }));
    const selected = gBrowser.selectedTab;
    return { tabs, active: this.#isShared(selected) ? this.#tabId(selected) : null };
  }

  #scheduleTabs() {
    if (this.role !== "host" || this.#tabsTimer) {
      return;
    }
    this.#tabsTimer = setTimeout(() => {
      this.#tabsTimer = null;
      if (this.role === "host") {
        this.#broadcast({ t: "tabs", ...this.#tabsState() });
      }
    }, 150);
  }

  #onGuestNavigation({ tabId, url }) {
    const tab = this.#tabById(tabId);
    if (!tab || !this.#isShared(tab) || !isWebURL(url)) {
      return;
    }
    if (tab.linkedBrowser.currentURI?.spec === url) {
      return;
    }
    tab.linkedBrowser.fixupAndLoadURIString(url, {
      triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
    });
  }

  // ---- Joining (guest) -----------------------------------------------------

  join(addressText, codeText) {
    if (this.inSession || this.isPrivate || this.#otherWindowSession()) {
      return;
    }
    const text = String(addressText || "").trim();
    const code = String(codeText || "").trim().toUpperCase();
    const match = text.match(/^\[?([^\]\s]+?)\]?(?::(\d{1,5}))?$/);
    if (!match || !code) {
      this.status = { id: "jessnix-together-status-address" };
      this.render();
      return;
    }
    const host = match[1];
    const port = Number(match[2]) || DEFAULT_PORT;
    if (/^[\d.]+$/.test(host) && !isPrivateAddress(host)) {
      this.status = { id: "jessnix-together-status-internet" };
      this.render();
      return;
    }
    this.role = "guest";
    this.isWaiting = true;
    this.status = "";
    this.#joinTarget = { address: host, port, code };
    this.board = [];
    this.party = false;
    this.readyCheck = false;
    this.iAmReady = false;
    this.driver = null;
    this.talking = new Set();
    this.peers.clear();
    this.chat = [];
    this.#mirrors.clear();
    this.#closedByMe.clear();
    this.follow = true;
    try {
      this.#conn = TogetherConnection.connect(host, port, {
        onMessage: message => this.#onHostMessage(message),
        onClose: reason => this.#onHostGone(reason),
      });
    } catch (e) {
      this.role = null;
      this.isWaiting = false;
      this.status = { id: "jessnix-together-status-connect" };
      this.render();
      return;
    }
    this.#conn.send({ t: "hello", v: TOGETHER_VERSION, name: this.me.name, code });
    this.render();
  }

  #onHostMessage(message) {
    switch (message.t) {
      case "reject":
        this.#rejectReason = REJECT_IDS[message.reasonId] || "jessnix-together-reject-declined";
        break;
      case "welcome":
        this.isWaiting = false;
        this.me = { id: message.you.id, name: this.me.name, color: cleanColor(message.you.color) };
        this.hostName = cleanName(message.host.name);
        this.#setPeers(message.peers);
        this.#startSession();
        this.#systemLine("jessnix-together-line-you-joined", { name: this.hostName });
        this.#setBoard(message.board);
        this.party = !!message.party;
        this.driver = typeof message.driver === "string" ? message.driver : null;
        this.talking = new Set((message.talking || []).filter(id => typeof id === "string"));
        Services.prefs.setStringPref(
          PREF_LAST_ROOM,
          JSON.stringify({ name: this.hostName, ...this.#joinTarget })
        );
        this.#onTabs(message);
        this.render();
        break;
      case "voice":
        this.#playVoice(message.from, message.data);
        break;
      case "voice-state":
        this.#onVoiceState(message.from, !!message.on);
        break;
      case "voice-restart":
        this.#restartVoice();
        break;
      case "party":
        this.party = !!message.on;
        this.#systemLine(this.party ? "jessnix-together-line-party-on" : "jessnix-together-line-party-off");
        this.render();
        break;
      case "ready-check":
        this.readyCheck = true;
        this.iAmReady = false;
        this.#notify("jessnix-together-ready-asked");
        this.render();
        break;
      case "ready-done":
        this.readyCheck = false;
        this.render();
        break;
      case "board":
        this.#setBoard(message.items);
        this.render();
        break;
      case "driver": {
        this.driver = typeof message.id === "string" ? message.id : null;
        const name = this.driver === this.me.id ? this.me.name : this.peers.get(this.driver)?.name;
        this.#systemLine(this.driver ? "jessnix-together-line-driving" : "jessnix-together-line-host-drives", { name: name || "" });
        this.render();
        break;
      }
      case "peers":
        this.#setPeers(message.list);
        this.render();
        break;
      case "tabs":
        this.#onTabs(message);
        break;
      case "chat":
        this.#onChat(message);
        break;
      case "page":
        this.#onPage(message);
        break;
      case "view":
      case "viewstop":
        this.#onView(message);
        break;
    }
  }

  #rejectReason = null;

  #setPeers(list) {
    this.peers.clear();
    for (const peer of list || []) {
      if (peer.id !== this.me.id) {
        this.peers.set(peer.id, { id: peer.id, name: cleanName(peer.name), color: cleanColor(peer.color), isHost: !!peer.isHost });
      }
    }
  }

  #onHostGone(reason) {
    if (this.role !== "guest") {
      return;
    }
    const wasWaiting = this.isWaiting;
    const id = this.#rejectReason
      ? this.#rejectReason
      : reason === "unreachable" && wasWaiting
        ? "jessnix-together-status-unreachable"
        : "jessnix-together-status-closed";
    this.#rejectReason = null;
    this.#endSession();
    this.status = { id };
    if (!wasWaiting) {
      this.#notify(id);
    }
    this.render();
  }

  #onTabs({ tabs = [], active = null }) {
    if (this.role !== "guest" || this.isWaiting) {
      return;
    }
    const ids = new Set();
    for (const remote of tabs) {
      ids.add(remote.id);
      const url = shareableURL(String(remote.url || "about:blank"));
      let tab = this.#mirrors.get(remote.id);
      if (tab && !tab.isConnected) {
        this.#mirrors.delete(remote.id);
        tab = null;
      }
      if (!tab) {
        if (this.#closedByMe.has(remote.id)) {
          continue;
        }
        tab = gBrowser.addTab(url, {
          triggeringPrincipal: principalFor(url),
          inBackground: true,
        });
        tab.setAttribute("jessnix-together-mirror", remote.id);
        this.#mirrors.set(remote.id, tab);
        this.#expectedURL.set(tab, url);
        continue;
      }
      if (this.#expectedURL.get(tab) !== url) {
        this.#expectedURL.set(tab, url);
        if (tab.linkedBrowser.currentURI?.spec !== url) {
          tab.linkedBrowser.fixupAndLoadURIString(url, {
            triggeringPrincipal: principalFor(url),
          });
        }
      }
    }
    for (const [id, tab] of [...this.#mirrors]) {
      if (!ids.has(id)) {
        this.#mirrors.delete(id);
        if (tab.isConnected) {
          this.#removingMirror = true;
          try {
            gBrowser.removeTab(tab, { animate: false });
          } finally {
            this.#removingMirror = false;
          }
        }
      }
    }
    this.hostActive = active;
    this.#followHost();
  }

  #followHost() {
    if (this.role !== "guest" || !this.follow || !this.hostActive) {
      return;
    }
    const tab = this.#mirrors.get(this.hostActive);
    if (tab?.isConnected && gBrowser.selectedTab !== tab) {
      this.#selectingForFollow = true;
      try {
        gBrowser.selectedTab = tab;
      } finally {
        this.#selectingForFollow = false;
      }
    }
  }

  setFollow(value) {
    this.follow = value;
    this.#followHost();
    this.render();
  }

  shareTabAsGuest(tab) {
    const url = tab?.linkedBrowser?.currentURI?.spec;
    if (this.role !== "guest" || !isWebURL(url)) {
      this.status = { id: "jessnix-together-status-web-only" };
      this.render();
      return;
    }
    this.status = "";
    this.#conn.send({ t: "open", url });
    // The host's copy comes back as a shared tab; this one stays private.
    this.#systemLine("jessnix-together-line-sent");
  }

  #mirrorId(tab) {
    for (const [id, mirror] of this.#mirrors) {
      if (mirror === tab) {
        return id;
      }
    }
    return null;
  }

  // ---- Session plumbing (both) -----------------------------------------------

  #startSession() {
    Services.prefs.setBoolPref(PREF_ACTIVE, true);
    this.#progressListener = {
      onLocationChange: (browser, webProgress, _request, location) => {
        if (webProgress?.isTopLevel) {
          this.#onLocationChange(browser, location);
          this.#startPage(browser);
        }
      },
      onStateChange: (browser, webProgress, _request, flags) => {
        const done = Ci.nsIWebProgressListener.STATE_STOP | Ci.nsIWebProgressListener.STATE_IS_WINDOW;
        if (webProgress?.isTopLevel && (flags & done) === done) {
          this.#startPage(browser);
        }
      },
    };
    gBrowser.addTabsProgressListener(this.#progressListener);
    this.#tabEvents = event => this.#onTabEvent(event);
    for (const type of ["TabOpen", "TabClose", "TabSelect", "TabAttrModified", "TabMove"]) {
      gBrowser.tabContainer.addEventListener(type, this.#tabEvents);
    }
    this.#keepaliveTimer = setInterval(() => this.#keepalive(), KEEPALIVE_MS);
    for (const tab of gBrowser.tabs) {
      this.#startPage(tab.linkedBrowser);
    }
    this.#updateButton();
  }

  // Starts the page side (JessnixTogetherChild.sys.mjs) in a tab's current
  // page; pages it can't run in (settings, not loaded yet) are skipped.
  #startPage(browser) {
    try {
      browser?.browsingContext?.currentWindowGlobal?.getActor(ACTOR_NAME)?.sendAsyncMessage("start");
    } catch {}
  }

  #endSession() {
    clearInterval(this.#announceTimer);
    clearInterval(this.#keepaliveTimer);
    clearTimeout(this.#tabsTimer);
    this.#announceTimer = this.#keepaliveTimer = this.#tabsTimer = null;
    this.stopView({ quiet: true });
    this.#closeRemoteView();
    this.stopVoice();
    for (const id of [...this.#voiceIn.keys()]) {
      this.#stopVoiceIn(id);
    }
    this.talking = new Set();
    this.readyCheck = false;
    this.ready = new Set();
    this.driver = null;
    for (const id of [...this.#cursors.keys()]) {
      this.#removeCursor(id);
    }
    if (this.#progressListener) {
      gBrowser.removeTabsProgressListener(this.#progressListener);
      this.#progressListener = null;
    }
    if (this.#tabEvents) {
      for (const type of ["TabOpen", "TabClose", "TabSelect", "TabAttrModified", "TabMove"]) {
        gBrowser.tabContainer.removeEventListener(type, this.#tabEvents);
      }
      this.#tabEvents = null;
    }
    for (const tab of gBrowser.tabs) {
      tab.removeAttribute("jessnix-together-shared");
      tab.removeAttribute("jessnix-together-mirror");
    }
    this.#server?.stop();
    this.#server = null;
    this.#discovery?.stop();
    this.#discovery = null;
    this.#guests.clear();
    this.#mirrors.clear();
    this.peers.clear();
    this.role = null;
    this.isWaiting = false;
    this.#conn = null;
    this.#code = "";
    this.shareAll = false;
    this.isPaused = false;
    if (!this.#otherWindowSession()) {
      Services.prefs.setBoolPref(PREF_ACTIVE, false);
    }
    this.#updateButton();
  }

  leave({ quiet = false } = {}) {
    if (!this.role) {
      return;
    }
    if (this.role === "host") {
      for (const guest of [...this.#guests.values()]) {
        guest.conn.send({ t: "reject", reasonId: "ended", reason: "The host ended the room." });
        guest.conn.close("ended");
      }
    } else if (this.#conn) {
      const conn = this.#conn;
      this.#conn = null;
      this.role = null; // so its close isn't reported as the room closing
      conn.send({ t: "bye" });
      conn.close("left");
      this.role = "guest";
    }
    this.#endSession();
    if (!quiet) {
      this.status = "";
      this.render();
    }
  }

  #keepalive() {
    const now = Date.now();
    if (this.role === "host") {
      for (const guest of [...this.#guests.values()]) {
        if (now - guest.conn.lastHeard > PEER_TIMEOUT_MS) {
          guest.conn.close("timeout");
        } else {
          guest.conn.send({ t: "ka" });
        }
      }
    } else if (this.#conn) {
      if (now - this.#conn.lastHeard > PEER_TIMEOUT_MS) {
        this.#conn.close("timeout");
      } else {
        this.#conn.send({ t: "ka" });
      }
    }
    for (const [id, cursor] of this.#cursors) {
      if (now - cursor.seen > CURSOR_TTL_MS) {
        this.#removeCursor(id);
      }
    }
  }

  #send(message) {
    if (this.role === "host") {
      this.#broadcast({ ...message, from: this.me.id });
    } else if (this.#conn && !this.isWaiting) {
      this.#conn.send(message);
    }
  }

  #onTabEvent(event) {
    const tab = event.target;
    if (this.role === "host") {
      if (event.type !== "TabAttrModified" || event.detail?.changed?.includes("label")) {
        this.#scheduleTabs();
      }
      if (event.type === "TabSelect") {
        this.#renderCursors();
        this.render();
      }
      return;
    }
    // Guest.
    if (event.type === "TabClose" && !this.#removingMirror) {
      const id = tab.getAttribute("jessnix-together-mirror");
      if (id) {
        this.#mirrors.delete(id);
        this.#closedByMe.add(id);
      }
    }
    if (event.type === "TabSelect" && this.driver === this.me.id && !this.#selectingForFollow) {
      const id = this.#mirrorId(tab);
      if (id) {
        this.#conn?.send({ t: "select", tabId: id });
      }
    }
    if (event.type === "TabSelect") {
      if (!this.#selectingForFollow && this.follow && this.driver !== this.me.id) {
        const id = this.#mirrorId(tab);
        if (id !== this.hostActive) {
          // Picking another tab yourself stops following, until turned back on.
          this.follow = false;
          this.render();
        }
      }
      this.#renderCursors();
    }
  }

  #onLocationChange(browser, location) {
    const tab = gBrowser.getTabForBrowser(browser);
    if (!tab) {
      return;
    }
    if (this.role === "host") {
      if (this.#isShared(tab)) {
        this.#scheduleTabs();
      }
      return;
    }
    const id = this.#mirrorId(tab);
    const url = location?.spec;
    if (!id || this.isWaiting || !isWebURL(url)) {
      return;
    }
    if (this.#expectedURL.get(tab) !== url) {
      // The person went somewhere in a shared tab: move it for everyone.
      this.#expectedURL.set(tab, url);
      this.#conn?.send({ t: "nav", tabId: id, url });
    }
  }

  // ---- Chat ----------------------------------------------------------------

  sendChat(text) {
    const clean = String(text).trim().slice(0, 500);
    if (!clean) {
      return;
    }
    this.#onChat({ from: this.me.id, text: clean });
    if (this.role === "host") {
      this.#broadcast({ t: "chat", from: this.me.id, text: clean });
    } else {
      this.#conn?.send({ t: "chat", text: clean });
    }
  }

  #person_of(id) {
    if (id === this.me.id) {
      return this.me;
    }
    return this.peers.get(id) || { name: "Someone", color: "#999" };
  }

  #onChat({ from, text }) {
    const person = this.#person_of(from);
    this.chat.push({ name: person.name, color: person.color, text: String(text).slice(0, 500) });
    this.chat = this.chat.slice(-MAX_CHAT);
    if (from !== this.me.id && this.#panel?.state !== "open") {
      this.unread++;
      this.#updateButton();
      this.#notify("jessnix-together-toast-chat", { name: person.name, text: String(text).slice(0, 80) });
    }
    this.render();
  }

  #systemLine(id, args) {
    this.chat.push({ system: true, id, args });
    this.chat = this.chat.slice(-MAX_CHAT);
  }

  // A short message near the Together button.
  #notify(id, args) {
    let toast = document.getElementById("jessnix-together-toast");
    if (!toast) {
      toast = this.#el("div", { id: "jessnix-together-toast" });
      document.documentElement.appendChild(toast);
    }
    document.l10n.setAttributes(toast, id, args);
    toast.setAttribute("shown", "true");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.removeAttribute("shown"), 4500);
  }

  // ---- Page events: pointers, pings, scrolling, video -----------------------

  // From this window's pages (JessnixTogetherParent.sys.mjs).
  onPageMessage(browser, rawData) {
    const data = pageEventFrom(rawData);
    if (!this.role || this.isWaiting || !data) {
      return;
    }
    const tab = gBrowser.getTabForBrowser(browser);
    const tabId = this.role === "host" ? (this.#isShared(tab) ? this.#tabId(tab) : null) : this.#mirrorId(tab);
    if (!tabId) {
      return;
    }
    // Only the host's (or the driver's) scrolling leads; followers scroll with it.
    if (data.kind === "scroll" && this.role !== "host" && this.driver !== this.me.id) {
      return;
    }
    const message = { t: "page", tabId, ...data };
    if (data.kind === "ping") {
      this.#onPage({ ...message, from: this.me.id });
    }
    this.#send(message);
  }

  #localTabFor(tabId) {
    return this.role === "host" ? this.#tabById(tabId) : this.#mirrors.get(tabId);
  }

  #actorFor(tab) {
    try {
      return tab?.linkedBrowser?.browsingContext?.currentWindowGlobal?.getActor(ACTOR_NAME);
    } catch {
      return null;
    }
  }

  #onPage(incoming) {
    const event = pageEventFrom(incoming);
    if (!event || typeof incoming.tabId !== "string") {
      return;
    }
    const message = { ...event, tabId: incoming.tabId, from: incoming.from };
    const tab = this.#localTabFor(message.tabId);
    if (!tab) {
      return;
    }
    switch (message.kind) {
      case "cursor":
        this.#cursors.set(message.from, {
          ...(this.#cursors.get(message.from) || {}),
          tabId: message.tabId,
          x: Number(message.x) || 0,
          y: Number(message.y) || 0,
          seen: Date.now(),
          hidden: false,
        });
        this.#renderCursors();
        break;
      case "cursor-hide": {
        const cursor = this.#cursors.get(message.from);
        if (cursor) {
          cursor.hidden = true;
          this.#renderCursors();
        }
        break;
      }
      case "ping":
        if (tab === gBrowser.selectedTab) {
          this.#showPing(message.from, Number(message.x) || 0, Number(message.y) || 0);
        }
        break;
      case "scroll":
        if ((this.role === "guest" && this.follow) || (this.role === "host" && message.from === this.driver)) {
          this.#actorFor(tab)?.sendAsyncMessage("apply-scroll", { fx: Number(message.fx) || 0, fy: Number(message.fy) || 0 });
        }
        break;
      case "media":
        if (this.role === "host" && this.party && message.from !== this.driver) {
          break;
        }
        this.#actorFor(tab)?.sendAsyncMessage("apply-media", {
          time: Number(message.time),
          paused: !!message.paused,
          rate: Number(message.rate) || 1,
        });
        break;
    }
  }

  get #overlayBox() {
    if (!this.#overlay?.isConnected) {
      this.#overlay = this.#el("div", { id: "jessnix-together-overlay" });
      document.documentElement.appendChild(this.#overlay);
    }
    return this.#overlay;
  }

  // Positions in a page are fractions of its visible area; shown over this
  // window's view of the same tab.
  #pagePoint(x, y) {
    const rect = gBrowser.selectedBrowser.getBoundingClientRect();
    return { left: rect.left + x * rect.width, top: rect.top + y * rect.height, rect };
  }

  #currentTabId() {
    const tab = gBrowser.selectedTab;
    return this.role === "host" ? (this.#isShared(tab) ? this.#tabId(tab) : null) : this.#mirrorId(tab);
  }

  #renderCursors() {
    const current = this.#currentTabId();
    for (const [id, cursor] of this.#cursors) {
      const person = this.#person_of(id);
      if (!cursor.el) {
        cursor.el = this.#el(
          "div",
          { class: "jessnix-together-cursor" },
          this.#el("div", { class: "jessnix-together-cursor-arrow" }),
          this.#el("div", { class: "jessnix-together-cursor-name" })
        );
        this.#overlayBox.appendChild(cursor.el);
      }
      cursor.el.style.setProperty("--jessnix-peer-color", person.color);
      cursor.el.lastChild.textContent = person.name;
      const visible = !cursor.hidden && cursor.tabId === current;
      cursor.el.hidden = !visible;
      if (visible) {
        const { left, top } = this.#pagePoint(cursor.x, cursor.y);
        cursor.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      }
    }
  }

  #removeCursor(id) {
    this.#cursors.get(id)?.el?.remove();
    this.#cursors.delete(id);
  }

  #showPing(from, x, y) {
    const person = this.#person_of(from);
    const { left, top } = this.#pagePoint(x, y);
    const ping = this.#el(
      "div",
      { class: "jessnix-together-ping", style: `--jessnix-peer-color:${person.color}; transform: translate(${Math.round(left)}px, ${Math.round(top)}px)` },
      this.#el("div", { class: "jessnix-together-ping-ring" }),
      this.#el("div", { class: "jessnix-together-cursor-name", text: person.name })
    );
    this.#overlayBox.appendChild(ping);
    setTimeout(() => ping.remove(), 1800);
  }

  // ---- Live tab view -------------------------------------------------------

  startView() {
    if (!this.role || this.isWaiting || this.isShowingView) {
      return;
    }
    this.isShowingView = true;
    this.#viewBrowser = gBrowser.selectedBrowser;
    this.#viewTimer = setInterval(() => this.#sendViewFrame(), VIEW_INTERVAL_MS);
    this.#systemLine("jessnix-together-line-live");
    this.render();
  }

  stopView({ quiet = false } = {}) {
    if (!this.isShowingView) {
      return;
    }
    this.isShowingView = false;
    clearInterval(this.#viewTimer);
    this.#viewTimer = null;
    this.#viewBrowser = null;
    this.#send({ t: "viewstop" });
    if (!quiet) {
      this.render();
    }
  }

  #connectionBacklog() {
    if (this.role === "host") {
      return Math.max(0, ...[...this.#guests.values()].filter(g => g.approved).map(g => g.conn.queuedBytes));
    }
    return this.#conn?.queuedBytes || 0;
  }

  async #sendViewFrame() {
    if (this.#viewBusy || this.#connectionBacklog() > VIEW_BACKLOG_BYTES) {
      return;
    }
    const browser = this.#viewBrowser;
    if (!browser?.isConnected) {
      // The shown tab was closed.
      this.stopView();
      return;
    }
    // Only while the shown tab is the one in front (a hidden tab can't be
    // drawn); other tabs are never sent.
    if (browser !== gBrowser.selectedBrowser) {
      return;
    }
    const global = browser.browsingContext?.currentWindowGlobal;
    if (!global) {
      return;
    }
    this.#viewBusy = true;
    try {
      const width = browser.clientWidth || 1;
      const scale = Math.min(1, VIEW_MAX_WIDTH / width);
      const bitmap = await global.drawSnapshot(null, scale, "white");
      const canvas = document.createElementNS(HTML_NS, "canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
      const img = canvas.toDataURL("image/jpeg", 0.6);
      if (this.isShowingView) {
        this.#send({ t: "view", title: String(gBrowser.getTabForBrowser(browser)?.label || "").slice(0, 120), img });
      }
    } catch (e) {
      // A page that can't be drawn (still loading, or a special page): skip.
    } finally {
      this.#viewBusy = false;
    }
  }

  #onView(message) {
    if (message.t === "viewstop") {
      if (this.#remoteView?.from === message.from) {
        this.#closeRemoteView();
      }
      return;
    }
    if (typeof message.img !== "string" || !message.img.startsWith("data:image/jpeg;base64,")) {
      return;
    }
    const person = this.#person_of(message.from);
    if (!this.#remoteView || this.#remoteView.from !== message.from) {
      this.#closeRemoteView();
      const img = this.#el("img", { class: "jessnix-together-view-image", alt: "" });
      const title = this.#el("span", { class: "jessnix-together-view-title" });
      const el = this.#el(
        "div",
        { id: "jessnix-together-view" },
        this.#el(
          "div",
          { class: "jessnix-together-view-bar" },
          this.#el("span", { class: "jessnix-together-dot", style: `background:${person.color}` }),
          title,
          this.#el("button", { class: "jessnix-together-view-close", text: "✕", l10n: "jessnix-together-view-hide", onclick: () => this.#closeRemoteView({ dismissed: true }) })
        ),
        img
      );
      document.documentElement.appendChild(el);
      this.#remoteView = { from: message.from, el, img, title, dismissed: false };
    }
    if (this.#remoteView.dismissed) {
      return;
    }
    document.l10n.setAttributes(this.#remoteView.title, "jessnix-together-view-title", {
      name: person.name,
      title: String(message.title || ""),
    });
    this.#remoteView.img.src = message.img;
  }

  #closeRemoteView({ dismissed = false } = {}) {
    if (!this.#remoteView) {
      return;
    }
    if (dismissed) {
      // Hidden until that person starts showing again.
      this.#remoteView.el.remove();
      this.#remoteView.dismissed = true;
      return;
    }
    this.#remoteView.el.remove();
    this.#remoteView = null;
  }

  // ---- Remember friends ----------------------------------------------------

  get lastRoom() {
    try {
      const room = JSON.parse(Services.prefs.getStringPref(PREF_LAST_ROOM, ""));
      return room?.address ? room : null;
    } catch {
      return null;
    }
  }

  get friends() {
    try {
      const list = JSON.parse(Services.prefs.getStringPref(PREF_FRIENDS, "[]"));
      return Array.isArray(list) ? list.filter(f => f?.address) : [];
    } catch {
      return [];
    }
  }

  saveFriend() {
    const target = this.#joinTarget;
    if (!target) {
      return;
    }
    const list = this.friends.filter(f => f.address !== target.address);
    list.push({ name: this.hostName, address: target.address, port: target.port });
    Services.prefs.setStringPref(PREF_FRIENDS, JSON.stringify(list.slice(-20)));
    this.render();
  }

  removeFriend(friend) {
    Services.prefs.setStringPref(
      PREF_FRIENDS,
      JSON.stringify(this.friends.filter(f => f.address !== friend.address || f.port !== friend.port))
    );
    this.render();
  }

  // ---- Hand over control ---------------------------------------------------

  // Host: a guest drives (their tab choice and scrolling lead), or null.
  setDriver(id) {
    if (this.role !== "host") {
      return;
    }
    this.driver = id && this.peers.has(id) ? id : null;
    this.#broadcast({ t: "driver", id: this.driver });
    if (this.driver) {
      this.#systemLine("jessnix-together-line-driving", { name: this.peers.get(this.driver).name });
    } else {
      this.#systemLine("jessnix-together-line-host-drives");
    }
    this.render();
  }

  // ---- Watch party -----------------------------------------------------------

  setParty(on) {
    if (this.role !== "host") {
      return;
    }
    this.party = !!on;
    this.#broadcast({ t: "party", on: this.party });
    this.#systemLine(this.party ? "jessnix-together-line-party-on" : "jessnix-together-line-party-off");
    this.render();
  }

  startReadyCheck() {
    if (this.role !== "host") {
      return;
    }
    this.readyCheck = true;
    this.ready = new Set();
    this.#broadcast({ t: "ready-check" });
    this.render();
  }

  sendReady() {
    this.iAmReady = true;
    this.#conn?.send({ t: "ready" });
    this.render();
  }

  // Plays the host's video in front; the play goes out to everyone like any
  // other play (relay: the page side doesn't hold it back as an echo).
  playForEveryone() {
    const tab = gBrowser.selectedTab;
    this.#actorFor(tab)?.sendAsyncMessage("apply-media", { paused: false, relay: true });
    this.readyCheck = false;
    this.#broadcast({ t: "ready-done" });
    this.render();
  }

  // ---- Shared board ----------------------------------------------------------

  boardOp(op) {
    if (this.role === "host") {
      this.#applyBoardOp(op, this.me.name);
    } else {
      this.#conn?.send({ t: "board-op", op });
    }
  }

  #applyBoardOp(op, byName) {
    if (!op || typeof op !== "object") {
      return;
    }
    switch (op.op) {
      case "add": {
        const kind = op.kind === "link" ? "link" : "todo";
        const text = String(op.text || "").slice(0, 300);
        const url = kind === "link" && isWebURL(op.url) ? op.url : "";
        if ((kind === "todo" && !text) || (kind === "link" && !url) || this.board.length >= 100) {
          return;
        }
        this.board.push({ id: `b${this.#nextBoardId++}`, kind, text, url, done: false, by: byName });
        break;
      }
      case "toggle": {
        const item = this.board.find(i => i.id === op.id);
        if (item) {
          item.done = !item.done;
        }
        break;
      }
      case "remove":
        this.board = this.board.filter(i => i.id !== op.id);
        break;
      default:
        return;
    }
    this.#broadcast({ t: "board", items: this.board });
    this.render();
  }

  #setBoard(items) {
    this.board = (Array.isArray(items) ? items : []).slice(0, 100).map(i => ({
      id: String(i.id || ""),
      kind: i.kind === "link" ? "link" : "todo",
      text: String(i.text || "").slice(0, 300),
      url: isWebURL(i.url) ? i.url : "",
      done: !!i.done,
      by: cleanName(i.by),
    }));
  }

  // ---- Voice chat --------------------------------------------------------------
  //
  // The microphone is captured with Web Audio as 16 kHz samples, sent in short
  // chunks over the room's own connection, and each listener schedules each
  // speaker's chunks back to back. No WebRTC: nothing to discover or punch
  // through, it works wherever the room works.

  async startVoice() {
    if (!this.role || this.isWaiting || this.voice.on) {
      return;
    }
    try {
      this.voice.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      this.status = { id: "jessnix-together-status-mic", args: { error: e.message || String(e) } };
      this.render();
      return;
    }
    this.voice.on = true;
    this.voice.muted = false;
    this.#startRecorder();
    this.#sendVoiceState(true);
    this.talking.add(this.me.id);
    this.render();
  }

  stopVoice() {
    if (!this.voice.on) {
      return;
    }
    this.voice.on = false;
    this.#stopCapture();
    for (const track of this.voice.stream?.getTracks() || []) {
      track.stop();
    }
    this.voice.stream = null;
    this.talking.delete(this.me.id);
    this.#sendVoiceState(false);
    this.render();
  }

  setMuted(muted) {
    this.voice.muted = !!muted;
    for (const track of this.voice.stream?.getAudioTracks() || []) {
      track.enabled = !this.voice.muted;
    }
    this.render();
  }

  #startRecorder() {
    this.#stopCapture();
    if (!this.voice.on || !this.voice.stream) {
      return;
    }
    // Web Audio, not MediaRecorder + MediaSource: streamed media playback in
    // the browser's own process crashed it; plain Web Audio works there.
    const context = new AudioContext();
    const source = context.createMediaStreamSource(this.voice.stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const step = context.sampleRate / VOICE_RATE;
    processor.addEventListener("audioprocess", event => {
      if (!this.voice.on || this.voice.muted) {
        return;
      }
      const input = event.inputBuffer.getChannelData(0);
      const samples = new Int16Array(Math.floor(input.length / step));
      for (let i = 0; i < samples.length; i++) {
        const value = Math.max(-1, Math.min(1, input[Math.floor(i * step)]));
        samples[i] = value * 32767;
      }
      const bytes = new Uint8Array(samples.buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 32768) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
      }
      this.#send({ t: "voice", data: btoa(binary) });
    });
    // The processor's own output stays silent; it only has to run.
    source.connect(processor);
    processor.connect(context.destination);
    this.voice.capture = { context, source, processor };
  }

  #stopCapture() {
    const capture = this.voice.capture;
    this.voice.capture = null;
    if (capture) {
      try {
        capture.source.disconnect();
        capture.processor.disconnect();
        capture.context.close();
      } catch {}
    }
  }

  #sendVoiceState(on) {
    this.#send({ t: "voice-state", on });
  }

  #onVoiceState(from, on) {
    const person = this.#person_of(from);
    if (on) {
      this.talking.add(from);
    } else {
      this.talking.delete(from);
      this.#stopVoiceIn(from);
    }
    this.#systemLine(on ? "jessnix-together-line-voice-on" : "jessnix-together-line-voice-off", { name: person.name });
    this.render();
  }

  // Raw samples need no stream header, so a newcomer just starts hearing.
  #restartVoice() {}

  // 16-bit samples at VOICE_RATE, scheduled one after another per speaker,
  // a little ahead of now, and never more than a second behind.
  #playVoice(from, data) {
    if (typeof data !== "string" || data.length > 200000) {
      return;
    }
    let samples;
    try {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length - (binary.length % 2));
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      samples = new Int16Array(bytes.buffer);
    } catch {
      return;
    }
    if (!samples.length) {
      return;
    }
    if (!this.#playContext || this.#playContext.state === "closed") {
      this.#playContext = new AudioContext();
    }
    const context = this.#playContext;
    let stream = this.#voiceIn.get(from);
    if (!stream) {
      stream = { next: 0, received: 0 };
      this.#voiceIn.set(from, stream);
    }
    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      floats[i] = samples[i] / 32768;
    }
    const buffer = context.createBuffer(1, floats.length, VOICE_RATE);
    buffer.copyToChannel(floats, 0);
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(context.destination);
    const now = context.currentTime;
    if (stream.next < now + 0.03 || stream.next > now + 1) {
      stream.next = now + VOICE_DELAY_S;
    }
    node.start(stream.next);
    stream.next += buffer.duration;
    stream.received += samples.length * 2;
  }

  #stopVoiceIn(from) {
    this.#voiceIn.delete(from);
    if (!this.#voiceIn.size && this.#playContext && !this.voice.on) {
      this.#playContext.close().catch(() => {});
      this.#playContext = null;
    }
  }

  get voiceDebug() {
    const now = this.#playContext?.currentTime || 0;
    return [...this.#voiceIn.entries()].map(([from, s]) => ({
      from,
      received: s.received,
      aheadSeconds: Number((s.next - now).toFixed(2)),
    }));
  }


}

window.gJessnixTogether = new nsJessnixTogether();
window.delayedStartupPromise.then(() => window.gJessnixTogether.init());
