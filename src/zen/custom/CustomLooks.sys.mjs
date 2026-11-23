// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Looks: everything Personalize and Layout set, as one object that can be saved
// under a name ("Work", "Gaming"), switched to in one click, shared with a
// friend (a file with the images inside, or a short code without them), undone,
// or reset section by section.
//
// A look is { prefs: { "pref.name": value, ... }, images: { icon, background } }.
// Prefs left out of a look are reset to their default when it is applied, so
// applying a look always gives the same result. Images are paths to copies in
// the profile's "custom-browser" folder.
//
// Used by Settings (custom-settings.js) and the command palette.

import { currentPrefNames } from "chrome://browser/content/zen-components/CustomMigration.sys.mjs";

// Every setting that makes up a look, by section (for "Reset this section").
export const LOOK_SECTIONS = {
  layout: [
    ["custom.look.size", "int"],
    ["custom.look.roundness", "int"],
    ["custom.tabs.top", "bool"],
    ["zen.tabs.vertical.right-side", "bool"],
    ["browser.toolbars.bookmarks.visibility", "string"],
    ["custom.look.button-labels", "bool"],
    ["zen.view.hide-window-controls", "bool"],
    ["custom.look.address-bar-bottom", "bool"],
  ],
  colors: [
    ["zen.view.window.scheme", "int"],
    ["zen.theme.accent-color", "string"],
    ["custom.personalize.background-strength", "int"],
    ["custom.look.see-through", "int"],
    ["custom.look.schedule", "bool"],
    ["custom.look.dark-from", "string"],
    ["custom.look.light-from", "string"],
  ],
  text: [
    ["custom.look.ui-font", "string"],
    ["custom.look.ui-font-size", "int"],
  ],
  tabs: [
    ["custom.tabs.style.height", "int"],
    ["custom.tabs.style.shape", "int"],
    ["custom.tabs.style.favicon-only", "bool"],
    ["custom.tabs.style.close", "int"],
  ],
  identity: [["custom.personalize.name", "string"]],
};

const IMAGE_PREFS = {
  icon: "custom.personalize.icon",
  background: "custom.personalize.background",
};

const ALL_PREFS = Object.values(LOOK_SECTIONS).flat();
const PREF_TYPES = new Map(ALL_PREFS);

const CODE_PREFIX = "CB1-";

// Left out of settings backups, both when saving and when restoring: values for
// this computer or this run only, and anything about updates, add-ons or Browse
// Together. Backups are files people share, so one must never be able to change
// where updates come from, allow add-ons, or pre-fill room codes, ports or
// remembered friends.
const BACKUP_SKIP = [
  "custom.update.",
  "custom.together.",
  "custom.chrome-extensions.",
  "custom.search.",
  "custom.tabs.top.saved.",
  "custom.game-mode",
  "custom.personalize.icon",
  "custom.personalize.background",
  "custom.spaces.looks",
];
const MAX_UNDO = 30;
const MAX_IMPORT_BYTES = 40 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico"]);

function readPref(pref, type) {
  if (!Services.prefs.prefHasUserValue(pref)) {
    return undefined;
  }
  switch (type) {
    case "int":
      return Services.prefs.getIntPref(pref);
    case "bool":
      return Services.prefs.getBoolPref(pref);
    default:
      return Services.prefs.getStringPref(pref);
  }
}

function writePref(pref, type, value) {
  if (value === undefined || value === null) {
    if (Services.prefs.prefHasUserValue(pref)) {
      Services.prefs.clearUserPref(pref);
    }
    return;
  }
  switch (type) {
    case "int": {
      const n = Number(value);
      if (Number.isInteger(n)) {
        Services.prefs.setIntPref(pref, n);
      }
      break;
    }
    case "bool":
      Services.prefs.setBoolPref(pref, !!value);
      break;
    default:
      Services.prefs.setStringPref(pref, String(value).slice(0, 500));
  }
}

function imageFolder() {
  return PathUtils.join(PathUtils.profileDir, "custom-browser");
}

function looksFile() {
  return PathUtils.join(imageFolder(), "looks.json");
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  }
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const undoStack = [];
const listeners = new Set();

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (e) {
      console.error(e);
    }
  }
}

export const CustomLooks = {
  LOOK_SECTIONS,

  onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  // The current look.
  current() {
    const prefs = {};
    for (const [pref, type] of ALL_PREFS) {
      const value = readPref(pref, type);
      if (value !== undefined) {
        prefs[pref] = value;
      }
    }
    const images = {};
    for (const [kind, pref] of Object.entries(IMAGE_PREFS)) {
      const path = Services.prefs.getStringPref(pref, "");
      if (path) {
        images[kind] = path;
      }
    }
    return { prefs, images };
  },

  // Applies a look; every look setting it leaves out goes back to its default.
  apply(look, { recordUndo = true } = {}) {
    if (recordUndo) {
      this.recordUndo();
    }
    const prefs = look?.prefs || {};
    for (const [pref, type] of ALL_PREFS) {
      writePref(pref, type, prefs[pref]);
    }
    for (const [kind, pref] of Object.entries(IMAGE_PREFS)) {
      const path = look?.images?.[kind];
      if (path) {
        Services.prefs.setStringPref(pref, path);
      } else if (Services.prefs.prefHasUserValue(pref)) {
        Services.prefs.clearUserPref(pref);
      }
    }
    notify();
  },

  // ---- Undo and reset -----------------------------------------------------

  // Called before any look change, so it can be undone.
  recordUndo() {
    const now = JSON.stringify(this.current());
    if (undoStack.at(-1) !== now) {
      undoStack.push(now);
      if (undoStack.length > MAX_UNDO) {
        undoStack.shift();
      }
    }
    notify();
  },

  get canUndo() {
    return undoStack.length > 0;
  },

  undo() {
    const previous = undoStack.pop();
    if (previous) {
      this.apply(JSON.parse(previous), { recordUndo: false });
    }
    notify();
  },

  // Section: a key of LOOK_SECTIONS, "images", or "all".
  reset(section) {
    this.recordUndo();
    const sections = section === "all" ? Object.keys(LOOK_SECTIONS) : [section];
    for (const name of sections) {
      for (const [pref, type] of LOOK_SECTIONS[name] || []) {
        writePref(pref, type, undefined);
      }
    }
    if (section === "all" || section === "images" || section === "colors") {
      for (const pref of Object.values(IMAGE_PREFS)) {
        if (section !== "colors" && Services.prefs.prefHasUserValue(pref)) {
          Services.prefs.clearUserPref(pref);
        }
      }
    }
    notify();
  },

  // ---- Saved looks (presets) -------------------------------------------------

  async list() {
    try {
      const data = await IOUtils.readJSON(looksFile());
      return Array.isArray(data?.looks) ? data.looks : [];
    } catch {
      return [];
    }
  },

  async _writeList(looks) {
    await IOUtils.makeDirectory(imageFolder(), { ignoreExisting: true });
    await IOUtils.writeJSON(looksFile(), { version: 1, looks });
    notify();
  },

  async save(name) {
    const clean = String(name || "").trim().slice(0, 40);
    if (!clean) {
      throw new Error("A look needs a name.");
    }
    const looks = (await this.list()).filter(l => l.name !== clean);
    looks.push({ name: clean, look: await this._keepImages(this.current()), saved: Date.now() });
    looks.sort((a, b) => a.name.localeCompare(b.name));
    await this._writeList(looks);
  },

  async remove(name) {
    await this._writeList((await this.list()).filter(l => l.name !== name));
  },

  async applySaved(name) {
    const entry = (await this.list()).find(l => l.name === name);
    if (entry) {
      this.apply(entry.look);
    }
    return !!entry;
  },

  // A saved look keeps its own copies of its images, so changing the current
  // background later doesn't change the saved look.
  async _keepImages(look) {
    const images = {};
    for (const [kind, path] of Object.entries(look.images || {})) {
      try {
        const extension = path.split(".").pop().toLowerCase();
        const copy = PathUtils.join(imageFolder(), `look-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${extension}`);
        await IOUtils.copy(path, copy);
        images[kind] = copy;
      } catch {}
    }
    return { prefs: { ...look.prefs }, images };
  },

  // ---- Sharing ---------------------------------------------------------------

  // A file with the images inside: a whole look, ready to send.
  async exportFile(path, look = this.current()) {
    const images = {};
    for (const [kind, imagePath] of Object.entries(look.images || {})) {
      try {
        const bytes = await IOUtils.read(imagePath);
        images[kind] = { extension: imagePath.split(".").pop().toLowerCase(), data: bytesToBase64(bytes) };
      } catch {}
    }
    const prefs = { ...look.prefs };
    await IOUtils.writeJSON(path, { app: "custom-browser-look", version: 1, prefs, images });
  },

  async importFile(path) {
    const info = await IOUtils.stat(path);
    if (info.size > MAX_IMPORT_BYTES) {
      throw new Error("That file is too big to be a look.");
    }
    const data = await IOUtils.readJSON(path);
    if (data?.app !== "custom-browser-look") {
      throw new Error("That file isn't a Custom Browser look.");
    }
    await IOUtils.makeDirectory(imageFolder(), { ignoreExisting: true });
    const images = {};
    for (const [kind, image] of Object.entries(data.images || {})) {
      if (!(kind in IMAGE_PREFS) || !IMAGE_EXTENSIONS.has(image?.extension)) {
        continue;
      }
      const copy = PathUtils.join(imageFolder(), `${kind}-${Date.now()}.${image.extension}`);
      await IOUtils.write(copy, base64ToBytes(image.data));
      images[kind] = copy;
    }
    const look = { prefs: this._onlyLookPrefs(data.prefs), images };
    this.apply(look);
    return look;
  },

  // A short code without images, for chat messages.
  toCode(look = this.current()) {
    const json = JSON.stringify(this._onlyLookPrefs(look.prefs));
    return CODE_PREFIX + bytesToBase64(new TextEncoder().encode(json)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },

  applyCode(code) {
    const text = String(code || "").trim();
    if (!text.startsWith(CODE_PREFIX)) {
      throw new Error("That isn't a Custom Browser look code.");
    }
    let body = text.slice(CODE_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    body += "=".repeat((4 - (body.length % 4)) % 4);
    const prefs = JSON.parse(new TextDecoder().decode(base64ToBytes(body)));
    // A code carries no images: keep the current ones.
    const look = { prefs: this._onlyLookPrefs(prefs), images: this.current().images };
    this.apply(look);
    return look;
  },

  // ---- Backing up all settings (the first step of settings sync) -----------
  //
  // Every Custom Browser setting (custom.*), the look settings that live in
  // Zen's and Firefox's prefs, the saved looks and their images, in one file.
  // Values that only make sense on this computer or this run are left out.

  async exportAll(path) {
    const prefs = {};
    const add = pref => {
      if (BACKUP_SKIP.some(prefix => pref.startsWith(prefix)) || !Services.prefs.prefHasUserValue(pref)) {
        return;
      }
      switch (Services.prefs.getPrefType(pref)) {
        case Services.prefs.PREF_INT:
          prefs[pref] = { type: "int", value: Services.prefs.getIntPref(pref) };
          break;
        case Services.prefs.PREF_BOOL:
          prefs[pref] = { type: "bool", value: Services.prefs.getBoolPref(pref) };
          break;
        case Services.prefs.PREF_STRING:
          prefs[pref] = { type: "string", value: Services.prefs.getStringPref(pref) };
          break;
      }
    };
    for (const pref of Services.prefs.getChildList("custom.")) {
      add(pref);
    }
    for (const [pref] of ALL_PREFS) {
      add(pref);
    }
    const files = {};
    for (const [kind, pref] of Object.entries(IMAGE_PREFS)) {
      const imagePath = Services.prefs.getStringPref(pref, "");
      if (imagePath && (await IOUtils.exists(imagePath))) {
        files[`current-${kind}`] = { name: PathUtils.filename(imagePath), data: bytesToBase64(await IOUtils.read(imagePath)) };
      }
    }
    const looks = await this.list();
    for (const look of looks) {
      for (const [kind, imagePath] of Object.entries(look.look?.images || {})) {
        if (await IOUtils.exists(imagePath)) {
          files[`look-${look.name}-${kind}`] = { name: PathUtils.filename(imagePath), data: bytesToBase64(await IOUtils.read(imagePath)) };
        }
      }
    }
    await IOUtils.writeJSON(path, { app: "custom-browser-settings", version: 1, saved: Date.now(), prefs, looks, files });
  },

  async importAll(path) {
    const info = await IOUtils.stat(path);
    if (info.size > 200 * 1024 * 1024) {
      throw new Error("That file is too big to be a settings backup.");
    }
    const data = await IOUtils.readJSON(path);
    if (data?.app !== "custom-browser-settings") {
      throw new Error("That file isn't a Custom Browser settings backup.");
    }
    this.recordUndo();
    await IOUtils.makeDirectory(imageFolder(), { ignoreExisting: true });
    // Images first, so prefs can point at their new copies.
    const restored = {};
    for (const [key, file] of Object.entries(data.files || {})) {
      const extension = String(file?.name || "").split(".").pop().toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) {
        continue;
      }
      const copy = PathUtils.join(imageFolder(), `restored-${Date.now()}-${Object.keys(restored).length}.${extension}`);
      await IOUtils.write(copy, base64ToBytes(file.data));
      restored[key] = copy;
    }
    let count = 0;
    // A backup from before the settings were renamed is taken too.
    for (const [pref, entry] of Object.entries(currentPrefNames(data.prefs))) {
      const known = pref.startsWith("custom.") || PREF_TYPES.has(pref);
      if (!known || BACKUP_SKIP.some(prefix => pref.startsWith(prefix)) || !entry || !["int", "bool", "string"].includes(entry.type)) {
        continue;
      }
      writePref(pref, entry.type, entry.value);
      count++;
    }
    for (const [kind, pref] of Object.entries(IMAGE_PREFS)) {
      if (restored[`current-${kind}`]) {
        Services.prefs.setStringPref(pref, restored[`current-${kind}`]);
      }
    }
    const looks = (Array.isArray(data.looks) ? data.looks : [])
      .map(look => {
        const images = {};
        for (const kind of Object.keys(IMAGE_PREFS)) {
          if (restored[`look-${look.name}-${kind}`]) {
            images[kind] = restored[`look-${look.name}-${kind}`];
          }
        }
        return {
          name: String(look.name || "").slice(0, 40),
          saved: look.saved,
          look: { prefs: this._onlyLookPrefs(look.look?.prefs), images },
        };
      })
      .filter(l => l.name);
    if (looks.length) {
      await this._writeList(looks);
    }
    notify();
    return { prefs: count, looks: looks.length };
  },

  // Only known look settings, with values of the right type, get in. Looks and
  // codes shared from before the settings were renamed are taken too.
  _onlyLookPrefs(prefs) {
    const clean = {};
    for (const [pref, value] of Object.entries(currentPrefNames(prefs))) {
      const type = PREF_TYPES.get(pref);
      if (
        (type === "int" && Number.isInteger(value)) ||
        (type === "bool" && typeof value === "boolean") ||
        (type === "string" && typeof value === "string")
      ) {
        clean[pref] = type === "string" ? value.slice(0, 500) : value;
      }
    }
    return clean;
  },
};
