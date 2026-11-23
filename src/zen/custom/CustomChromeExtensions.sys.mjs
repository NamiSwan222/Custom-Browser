// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Chrome extensions: installing an extension from the Chrome Web Store.
// Firefox runs the same extension format (WebExtensions, with the chrome.*
// names), so most extensions work once repackaged:
// 1. Download: the .crx package from Google's update service.
// 2. Unwrap: a .crx is a zip with a signature header in front.
// 3. Convert the manifest: a Firefox extension id, the background service
//    worker as a background script, keys Firefox doesn't know removed.
// 4. Add a small compatibility script for Chrome-only APIs (sidePanel,
//    offscreen) in front of the background scripts.
// 5. Check what it uses that Firefox lacks: works / partly / won't work.
// Updates: converted extensions are checked against the Web Store once a day
// (checkForUpdates) and converted again when there's a newer version.
//
// Converted extensions aren't reviewed by Mozilla (it can't sign them), so they
// need unsigned add-ons allowed. The window module asks before that happens,
// and signing is switched back on as soon as no converted extension is left
// (restoreSigning). Every package's signature is checked against the
// extension's own key (verifiedZipFromCrx), and an update that asks for more
// than the installed version is never installed without the person agreeing.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
});

export const ID_SUFFIX = "@chrome-store.custom-browser";
const CHROME_VERSION = "135.0.0.0";
const PREF_KNOWN = "custom.chrome-extensions.converted";
const PREF_LAST_CHECK = "custom.chrome-extensions.last-update-check";
const PREF_SIGNING = "xpinstall.signatures.required";
// Set while signing is off because of converted extensions, so it's only ever
// switched back on when this feature switched it off.
const PREF_SIGNING_OFF_FOR_US = "custom.chrome-extensions.signing-off";
const MAX_CRX_BYTES = 100 * 1024 * 1024;

// A Web Store page: chromewebstore.google.com/detail/<name>/<id>, or the old
// chrome.google.com/webstore/detail/<name>/<id>.
export function webStoreId(url) {
  const match = /^https:\/\/(?:chromewebstore\.google\.com\/detail|chrome\.google\.com\/webstore\/detail)\/(?:[^/]+\/)?([a-p]{32})(?:[/?#]|$)/.exec(
    String(url || "")
  );
  return match ? match[1] : null;
}

function crxURL(id, mode = "redirect") {
  const x = encodeURIComponent(`id=${id}&uc`);
  return mode === "updatecheck"
    ? `https://clients2.google.com/service/update2/crx?response=updatecheck&prodversion=${CHROME_VERSION}&acceptformat=crx2,crx3&x=${x}`
    : `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${CHROME_VERSION}&acceptformat=crx2,crx3&x=${x}`;
}

// Extension API namespaces Firefox has (chrome.* and browser.*).
const FIREFOX_APIS = new Set([
  "action", "alarms", "bookmarks", "browserAction", "browsingData", "captivePortal", "clipboard",
  "commands", "contentScripts", "contextMenus", "contextualIdentities", "cookies", "declarativeNetRequest",
  "devtools", "dns", "downloads", "events", "extension", "extensionTypes", "find", "history", "i18n",
  "identity", "idle", "management", "menus", "notifications", "omnibox", "pageAction", "permissions",
  "pkcs11", "privacy", "proxy", "runtime", "scripting", "search", "sessions", "sidebarAction", "storage",
  "tabGroups", "tabs", "theme", "topSites", "types", "userScripts", "webNavigation", "webRequest", "windows",
]);
// Chrome-only APIs the compatibility script stands in for.
const POLYFILLED_APIS = new Set(["sidePanel", "offscreen"]);
// Chrome-only APIs with no stand-in.
const MISSING_APIS_NOTE = {
  tts: "speech", ttsEngine: "speech", tabCapture: "tab capture", desktopCapture: "screen capture",
  enterprise: "enterprise", fileSystemProvider: "file systems", gcm: "push messages", instanceID: "push messages",
  debugger: "debugger", system: "system information", printing: "printing", readingList: "reading list",
  fontSettings: "font settings", processes: "processes", tabGroupsChrome: "tab groups", loginState: "ChromeOS",
};
const DROP_PERMISSIONS = new Set(["sidePanel", "offscreen", "background", "fontSettings", "tts", "ttsEngine", "gcm"]);
const DROP_KEYS = ["update_url", "key", "minimum_chrome_version", "differential_fingerprint", "offline_enabled", "side_panel", "export", "import", "oauth2"];

// The compatibility script, first among the background scripts.
const COMPAT_FILE = "custom-browser-chrome-compat.js";
const COMPAT_SCRIPT = `// Added by Custom Browser when converting this Chrome extension.
(() => {
  const api = globalThis.chrome || (globalThis.chrome = globalThis.browser);
  if (!api) return;
  // Side panel -> Firefox's sidebar.
  if (!api.sidePanel && globalThis.browser?.sidebarAction) {
    api.sidePanel = {
      open: () => browser.sidebarAction.open(),
      close: () => browser.sidebarAction.close(),
      setOptions: async ({ path } = {}) => { if (path) await browser.sidebarAction.setPanel({ panel: path }); },
      getOptions: async () => ({ enabled: true, path: await browser.sidebarAction.getPanel({}) }),
      setPanelBehavior: async () => {},
      getPanelBehavior: async () => ({ openPanelOnActionClick: false }),
    };
  }
  // Offscreen documents -> a hidden frame in the background page.
  if (!api.offscreen && typeof document !== "undefined") {
    let frame = null;
    api.offscreen = {
      Reason: new Proxy({}, { get: (_, key) => key }),
      createDocument: async ({ url }) => {
        if (frame) throw new Error("Only one offscreen document may exist.");
        frame = document.createElement("iframe");
        frame.src = url;
        frame.style.display = "none";
        document.documentElement.appendChild(frame);
      },
      closeDocument: async () => { frame?.remove(); frame = null; },
      hasDocument: async () => !!frame,
    };
  }
  // A service worker's importScripts, for scripts that call it at startup.
  if (typeof globalThis.importScripts !== "function" && typeof document !== "undefined") {
    globalThis.importScripts = (...urls) => {
      for (const url of urls) {
        const request = new XMLHttpRequest();
        request.open("GET", url, false);
        request.send();
        (0, eval)(request.responseText);
      }
    };
  }
})();
`;

function binaryString(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  }
  return out;
}

// Reads protobuf fields (field number -> list of byte values) from a message;
// CRX3 headers are protobuf and only use length-delimited fields.
function protobufFields(bytes) {
  const fields = new Map();
  let i = 0;
  const varint = () => {
    let value = 0;
    let shift = 0;
    while (true) {
      if (i >= bytes.length) {
        throw new Error("The package header is cut off.");
      }
      const b = bytes[i++];
      value += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) {
        return value;
      }
      shift += 7;
    }
  };
  while (i < bytes.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 2) {
      const length = varint();
      if (i + length > bytes.length) {
        throw new Error("The package header is cut off.");
      }
      if (!fields.has(field)) {
        fields.set(field, []);
      }
      fields.get(field).push(bytes.subarray(i, i + length));
      i += length;
    } else if (wire === 0) {
      varint();
    } else {
      throw new Error("The package header isn't readable.");
    }
  }
  return fields;
}

// The Chrome extension id of a public key: the first 16 bytes of its SHA-256,
// each half-byte written as a letter a-p.
async function extensionIdOf(publicKey) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", publicKey));
  return [...hash.subarray(0, 16)]
    .map(b => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15)))
    .join("");
}

// An ECDSA signature from DER (SEQUENCE of two INTEGERs) to the 64-byte r||s
// WebCrypto wants.
function ecdsaRaw(der) {
  let i = 2;
  const part = () => {
    if (der[i] !== 0x02) {
      throw new Error("bad signature");
    }
    const length = der[i + 1];
    let value = der.subarray(i + 2, i + 2 + length);
    i += 2 + length;
    while (value.length > 32 && value[0] === 0) {
      value = value.subarray(1);
    }
    const out = new Uint8Array(32);
    out.set(value, 32 - value.length);
    return out;
  };
  const r = part();
  const s = part();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

// Checks a .crx package and returns its zip. Only CRX3 packages are accepted:
// the header must name `expectedId`, and one of its signatures must be made
// with the key that id belongs to (the extension developer's key), over the
// header and the whole zip. So a package can't be swapped or altered on the
// way, and it can't be another extension's package.
export async function verifiedZipFromCrx(bytes, expectedId) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== "Cr24") {
    throw new Error("That download isn't a Chrome extension package.");
  }
  if (view.getUint32(4, true) !== 3) {
    throw new Error("That Chrome package uses an old format that can't be checked.");
  }
  const headerSize = view.getUint32(8, true);
  if (12 + headerSize > bytes.length) {
    throw new Error("The Chrome package is cut off.");
  }
  const header = protobufFields(bytes.subarray(12, 12 + headerSize));
  const zip = bytes.subarray(12 + headerSize);
  const signedHeader = header.get(10000)?.[0];
  const crxId = signedHeader && protobufFields(signedHeader).get(1)?.[0];
  if (!crxId || crxId.length !== 16) {
    throw new Error("The Chrome package doesn't say which extension it is.");
  }
  const idInHeader = [...crxId]
    .map(b => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15)))
    .join("");
  if (idInHeader !== expectedId) {
    throw new Error("The download is a different extension than the one asked for.");
  }
  // What the signatures cover.
  const prefix = new TextEncoder().encode("CRX3 SignedData\u0000");
  const signed = new Uint8Array(prefix.length + 4 + signedHeader.length + zip.length);
  signed.set(prefix, 0);
  new DataView(signed.buffer).setUint32(prefix.length, signedHeader.length, true);
  signed.set(signedHeader, prefix.length + 4);
  signed.set(zip, prefix.length + 4 + signedHeader.length);

  const proofs = [
    ...(header.get(2) || []).map(proof => ({ proof, kind: "rsa" })),
    ...(header.get(3) || []).map(proof => ({ proof, kind: "ecdsa" })),
  ];
  for (const { proof, kind } of proofs) {
    const parts = protobufFields(proof);
    const publicKey = parts.get(1)?.[0];
    const signature = parts.get(2)?.[0];
    if (!publicKey || !signature || (await extensionIdOf(publicKey)) !== expectedId) {
      continue;
    }
    try {
      const algorithm =
        kind === "rsa" ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } : { name: "ECDSA", namedCurve: "P-256" };
      const key = await crypto.subtle.importKey("spki", publicKey, algorithm, false, ["verify"]);
      const ok = await crypto.subtle.verify(
        kind === "rsa" ? algorithm : { name: "ECDSA", hash: "SHA-256" },
        key,
        kind === "rsa" ? signature : ecdsaRaw(signature),
        signed
      );
      if (ok) {
        return zip;
      }
    } catch {
      // A key or signature that can't be read doesn't count.
    }
  }
  throw new Error("The Chrome package's signature doesn't match the extension. It was not added.");
}

// Every permission and site an extension asks for, for comparing versions.
export function permissionsOf(manifest) {
  const asked = new Set();
  for (const list of [manifest.permissions, manifest.host_permissions]) {
    for (const value of Array.isArray(list) ? list : []) {
      if (typeof value === "string") {
        asked.add(value);
      }
    }
  }
  for (const script of Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []) {
    for (const match of Array.isArray(script?.matches) ? script.matches : []) {
      asked.add(String(match));
    }
  }
  return asked;
}

function readEntry(reader, name) {
  const stream = reader.getInputStream(name);
  const binary = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);
  binary.setInputStream(stream);
  const bytes = new Uint8Array(binary.readByteArray(stream.available()));
  stream.close();
  return bytes;
}

function streamOf(text) {
  const stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
  stream.setByteStringData(binaryString(new TextEncoder().encode(text)));
  return stream;
}

// Chrome manifests may carry // comments; JSON doesn't.
function parseManifest(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/^\uFEFF/, "").replace(/(^|[^:"\\])\/\/.*$/gm, "$1"));
  }
}

function resolveMessage(value, messages) {
  const match = /^__MSG_(.+)__$/.exec(String(value || ""));
  return match ? messages?.[match[1].toLowerCase()]?.message || value : value;
}

// What the extension uses that Firefox lacks: "works", "partly" (with the
// features that won't work) or "wont" (with why).
export function analyze(manifest, sourceText) {
  const notes = [];
  let verdict = "works";
  if (manifest.manifest_version !== 2 && manifest.manifest_version !== 3) {
    return { verdict: "wont", notes: ["It uses an extension format Firefox doesn't run."] };
  }
  const used = new Set();
  for (const match of sourceText.matchAll(/\b(?:chrome|browser)\.([a-zA-Z]+)\b/g)) {
    used.add(match[1]);
  }
  for (const permission of [...(manifest.permissions || []), ...(manifest.optional_permissions || [])]) {
    if (typeof permission === "string" && /^[a-zA-Z]+$/.test(permission)) {
      used.add(permission);
    }
  }
  for (const name of used) {
    if (FIREFOX_APIS.has(name) || ["webRequestBlocking", "unlimitedStorage", "activeTab", "clipboardRead", "clipboardWrite", "geolocation", "nativeMessaging", "declarativeNetRequestWithHostAccess", "declarativeNetRequestFeedback"].includes(name)) {
      continue;
    }
    if (POLYFILLED_APIS.has(name)) {
      notes.push(`Uses Chrome's ${name}; a stand-in is added.`);
      continue;
    }
    if (MISSING_APIS_NOTE[name]) {
      verdict = "partly";
      notes.push(`Its ${MISSING_APIS_NOTE[name]} features won't work (Chrome's ${name}).`);
    }
  }
  if (manifest.background?.service_worker && /\bimportScripts\s*\(/.test(sourceText)) {
    notes.push("Its background script loads more scripts; this usually works.");
  }
  if (/chrome\.identity\.getAuthToken/.test(sourceText)) {
    verdict = "partly";
    notes.push("Signing in with a Google account inside the extension won't work.");
  }
  if (/\bnavigator\.userAgentData\b.*Chrome|chrome\.runtime\.getPlatformInfo.*chrome/i.test(sourceText)) {
    notes.push("It may check for Chrome and refuse to run.");
  }
  return { verdict, notes };
}

export const CustomChromeExtensions = {
  webStoreId,
  ID_SUFFIX,

  // Downloads the store's package for id, converts it, and returns
  // { file, manifest, name, version, report } without installing.
  async prepare(id) {
    const response = await fetch(crxURL(id), { credentials: "omit", cache: "no-store" });
    if (!response.ok) {
      throw new Error(`The Web Store answered ${response.status}.`);
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_CRX_BYTES) {
      throw new Error("The Web Store sent no package (it may be a paid or region-locked extension).");
    }
    const zipBytes = await verifiedZipFromCrx(buffer, id);
    const folder = PathUtils.join(PathUtils.tempDir, "custom-browser-chrome-extensions");
    await IOUtils.makeDirectory(folder, { ignoreExisting: true });
    const path = PathUtils.join(folder, `${id}-${Date.now()}.xpi`);
    await IOUtils.write(path, zipBytes);
    const file = new lazy.FileUtils.File(path);
    return this._convert(id, file);
  },

  _convert(id, file) {
    const reader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(Ci.nsIZipReader);
    reader.open(file);
    let manifest;
    let sourceText = "";
    let messages = null;
    try {
      if (!reader.hasEntry("manifest.json")) {
        throw new Error("The package has no manifest.");
      }
      manifest = parseManifest(new TextDecoder().decode(readEntry(reader, "manifest.json")));
      const locale = manifest.default_locale;
      if (locale && reader.hasEntry(`_locales/${locale}/messages.json`)) {
        try {
          const raw = JSON.parse(new TextDecoder().decode(readEntry(reader, `_locales/${locale}/messages.json`)));
          messages = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
        } catch {}
      }
      for (const entry of reader.findEntries("*.js")) {
        if (sourceText.length < 8 * 1024 * 1024) {
          sourceText += new TextDecoder().decode(readEntry(reader, entry)) + "\n";
        }
      }
    } finally {
      reader.close();
    }

    const report = analyze(manifest, sourceText);
    const name = resolveMessage(manifest.name, messages) || id;
    const original = { ...manifest };

    // Firefox's id, and a note in the description so it's clearly marked.
    manifest.browser_specific_settings = {
      gecko: { id: `${id}${ID_SUFFIX}`, strict_min_version: "128.0" },
    };
    const description = resolveMessage(manifest.description, messages) || "";
    manifest.description = `From the Chrome Web Store, converted by Custom Browser. ${description}`.slice(0, 132);
    for (const key of DROP_KEYS) {
      delete manifest[key];
    }
    // Side panel -> sidebar.
    if (original.side_panel?.default_path) {
      manifest.sidebar_action = { default_panel: original.side_panel.default_path, default_title: name };
    }
    // Service worker -> background script(s), the compatibility script first.
    if (manifest.background?.service_worker) {
      const scripts = [COMPAT_FILE, manifest.background.service_worker];
      manifest.background = { scripts, ...(manifest.background.type === "module" ? { type: "module" } : {}) };
    } else if (Array.isArray(manifest.background?.scripts)) {
      manifest.background.scripts = [COMPAT_FILE, ...manifest.background.scripts];
    } else if (!manifest.background) {
      manifest.background = { scripts: [COMPAT_FILE] };
    }
    for (const listName of ["permissions", "optional_permissions"]) {
      if (Array.isArray(manifest[listName])) {
        manifest[listName] = manifest[listName].filter(p => !DROP_PERMISSIONS.has(p));
      }
    }

    const writer = Cc["@mozilla.org/zipwriter;1"].createInstance(Ci.nsIZipWriter);
    writer.open(file, 0x04 /* PR_RDWR */);
    try {
      writer.removeEntry("manifest.json", false);
      writer.addEntryStream("manifest.json", Date.now() * 1000, Ci.nsIZipWriter.COMPRESSION_DEFAULT, streamOf(JSON.stringify(manifest, null, 2)), false);
      if (writer.hasEntry(COMPAT_FILE)) {
        writer.removeEntry(COMPAT_FILE, false);
      }
      writer.addEntryStream(COMPAT_FILE, Date.now() * 1000, Ci.nsIZipWriter.COMPRESSION_DEFAULT, streamOf(COMPAT_SCRIPT), false);
      // Chrome packages may carry signatures over the original files.
      for (const signed of ["_metadata/verified_contents.json", "_metadata/computed_hashes.json"]) {
        if (writer.hasEntry(signed)) {
          writer.removeEntry(signed, false);
        }
      }
    } finally {
      writer.close();
    }
    return { file, manifest, name, version: String(original.version || ""), report, id };
  },

  // Remembers what was converted, and what it may do, for update checks.
  remember(id, version, manifest) {
    const known = this.converted;
    known[id] = { version, checked: Date.now(), permissions: [...permissionsOf(manifest || {})] };
    Services.prefs.setStringPref(PREF_KNOWN, JSON.stringify(known));
  },

  // Switches unsigned add-ons off for converted extensions; restoreSigning
  // switches them back on.
  allowUnsigned() {
    if (Services.prefs.getBoolPref(PREF_SIGNING, true)) {
      Services.prefs.setBoolPref(PREF_SIGNING, false);
      Services.prefs.setBoolPref(PREF_SIGNING_OFF_FOR_US, true);
    }
  },

  // Once no converted extension is installed, add-ons must be signed again.
  async restoreSigning() {
    if (!Services.prefs.getBoolPref(PREF_SIGNING_OFF_FOR_US, false)) {
      return;
    }
    const addons = await lazy.AddonManager.getAddonsByTypes(["extension"]);
    if (addons.some(addon => addon.id.endsWith(ID_SUFFIX))) {
      return;
    }
    Services.prefs.clearUserPref(PREF_SIGNING);
    Services.prefs.clearUserPref(PREF_SIGNING_OFF_FOR_US);
    const known = this.converted;
    for (const id of Object.keys(known)) {
      delete known[id];
    }
    Services.prefs.setStringPref(PREF_KNOWN, JSON.stringify(known));
  },

  get converted() {
    try {
      const value = JSON.parse(Services.prefs.getStringPref(PREF_KNOWN, "{}"));
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  },

  // Latest Web Store version of id, or null.
  async latestVersion(id) {
    const response = await fetch(crxURL(id, "updatecheck"), { credentials: "omit", cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const text = await response.text();
    const match = /<updatecheck[^>]*\bversion="([^"]+)"/.exec(text);
    return match ? match[1] : null;
  },

  // Once a day: re-converts converted extensions that have a newer version.
  // An update that asks for nothing new is installed; one that asks for more
  // permissions or sites is left for the person to approve (returned in
  // `needsApproval`), the way Chrome holds such updates back.
  async checkForUpdates({ force = false } = {}) {
    // Seconds (a pref int can't hold milliseconds).
    const last = Services.prefs.getIntPref(PREF_LAST_CHECK, 0) * 1000;
    const result = { updated: [], needsApproval: [] };
    if (!force && Date.now() - last < 24 * 60 * 60 * 1000) {
      return result;
    }
    Services.prefs.setIntPref(PREF_LAST_CHECK, Math.floor(Date.now() / 1000));
    for (const [id, info] of Object.entries(this.converted)) {
      const addon = await lazy.AddonManager.getAddonByID(`${id}${ID_SUFFIX}`);
      if (!addon) {
        continue;
      }
      try {
        const latest = await this.latestVersion(id);
        if (!latest || Services.vc.compare(latest, info.version) <= 0) {
          continue;
        }
        const prepared = await this.prepare(id);
        const before = new Set(info.permissions || []);
        const added = [...permissionsOf(prepared.manifest)].filter(p => !before.has(p));
        // No record of what the installed version asked for (added before this
        // check existed): treat everything as new.
        if (added.length || !Array.isArray(info.permissions)) {
          result.needsApproval.push({ id, name: prepared.name, version: prepared.version, added });
          continue;
        }
        const install = await lazy.AddonManager.getInstallForFile(prepared.file);
        await install.install();
        this.remember(id, prepared.version, prepared.manifest);
        result.updated.push({ id, name: prepared.name, version: prepared.version });
      } catch (e) {
        console.warn("Chrome extension update failed for", id, e);
      }
    }
    return result;
  },
};

// Signing goes back on when the last converted extension is removed, and is
// checked once each session in case one was removed while the browser was closed.
lazy.AddonManager.addAddonListener({
  onUninstalled(addon) {
    if (addon.id.endsWith(ID_SUFFIX)) {
      CustomChromeExtensions.restoreSigning();
    }
  },
});
CustomChromeExtensions.restoreSigning();
