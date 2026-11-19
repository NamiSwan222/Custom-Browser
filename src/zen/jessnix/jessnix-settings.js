// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

/* global Preferences */

// Settings > Look and Feel > Personalize (jessnixPersonalize.inc.xhtml).
// Choices are prefs; JessnixPersonalize.mjs applies them to every window.

const JESSNIX_PREF_NAME = "jessnix.personalize.name";
const JESSNIX_PREF_ICON = "jessnix.personalize.icon";
const JESSNIX_PREF_BACKGROUND = "jessnix.personalize.background";
const JESSNIX_PREF_ACCENT = "zen.theme.accent-color";
// Zen's accent pref takes a CSS colour; this keyword follows Windows' accent colour.
const JESSNIX_SYSTEM_ACCENT = "AccentColor";

// Chosen images are copied here, so moving or deleting the original is harmless.
const JESSNIX_IMAGE_LIMITS = { icon: 5 * 1024 * 1024, background: 25 * 1024 * 1024 };
const JESSNIX_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico"];

document.l10n.addResourceIds(["browser/preferences/jessnix-preferences.ftl"]);

const { JessnixLooks } = ChromeUtils.importESModule(
  "chrome://browser/content/zen-components/JessnixLooks.sys.mjs"
);
const JESSNIX_PREF_FONT = "jessnix.look.ui-font";
const JESSNIX_PREF_DARK_FROM = "jessnix.look.dark-from";
const JESSNIX_PREF_LIGHT_FROM = "jessnix.look.light-from";
const JESSNIX_PREF_SCHEDULE = "jessnix.look.schedule";

Preferences.addAll([
  { id: "jessnix.personalize.background-strength", type: "int", default: 60 },
]);

var gJessnixPersonalizeSettings = {
  init() {
    if (this._isInitialized) {
      return;
    }
    this._isInitialized = true;

    const nameInput = document.getElementById("jessnixPersonalizeName");
    nameInput.value = Services.prefs.getStringPref(JESSNIX_PREF_NAME, "");
    nameInput.addEventListener("change", () => this.setName(nameInput.value));
    document
      .getElementById("jessnixPersonalizeNameReset")
      .addEventListener("command", () => {
        nameInput.value = "";
        this.setName("");
      });

    document
      .getElementById("jessnixPersonalizeIconChoose")
      .addEventListener("command", () => this.chooseImage("icon", JESSNIX_PREF_ICON));
    document
      .getElementById("jessnixPersonalizeIconReset")
      .addEventListener("command", () => this.clearImage(JESSNIX_PREF_ICON));
    document
      .getElementById("jessnixPersonalizeBackgroundChoose")
      .addEventListener("command", () =>
        this.chooseImage("background", JESSNIX_PREF_BACKGROUND)
      );
    document
      .getElementById("jessnixPersonalizeBackgroundReset")
      .addEventListener("command", () => this.clearImage(JESSNIX_PREF_BACKGROUND));

    const accent = document.getElementById("jessnixPersonalizeAccent");
    accent.addEventListener("change", () => this.setAccent(accent.value));
    document
      .getElementById("jessnixPersonalizeAccentReset")
      .addEventListener("command", () => this.setAccent(JESSNIX_SYSTEM_ACCENT));

    this.initLayoutControls();
    this.initFonts();
    this.initSchedule();
    this.initLooks();

    const watched = [JESSNIX_PREF_ICON, JESSNIX_PREF_BACKGROUND, JESSNIX_PREF_ACCENT];
    for (const pref of watched) {
      Services.prefs.addObserver(pref, this);
    }
    window.addEventListener(
      "unload",
      () => {
        for (const pref of watched) {
          Services.prefs.removeObserver(pref, this);
        }
      },
      { once: true }
    );
    this.updatePreviews();
  },

  observe() {
    this.updatePreviews();
  },

  // Layout controls carry their pref in data-jessnix-pref (and -type, and
  // -inverted for a checkbox that means the opposite of its pref). Some of these
  // prefs are Zen's or Firefox's and may already be bound elsewhere in Settings,
  // so they are read and written directly instead of through Preferences.
  initLayoutControls() {
    const controls = document.querySelectorAll(
      "#jessnixPersonalizeGroup [data-jessnix-pref]"
    );
    const prefs = new Set();
    for (const control of controls) {
      const pref = control.dataset.jessnixPref;
      prefs.add(pref);
      control.addEventListener("command", () => this.writeLayoutControl(control));
    }
    const sync = () => {
      for (const control of controls) {
        this.readLayoutControl(control);
      }
    };
    const observer = { observe: sync };
    for (const pref of prefs) {
      Services.prefs.addObserver(pref, observer);
    }
    window.addEventListener(
      "unload",
      () => {
        for (const pref of prefs) {
          Services.prefs.removeObserver(pref, observer);
        }
      },
      { once: true }
    );
    sync();
  },

  readLayoutControl(control) {
    const { jessnixPref: pref, jessnixType: type, jessnixInverted } = control.dataset;
    let value;
    if (type == "int") {
      value = Services.prefs.getIntPref(pref, 0);
    } else if (type == "bool") {
      value = Services.prefs.getBoolPref(pref, false);
    } else {
      value = Services.prefs.getStringPref(pref, "");
    }
    if (control.localName == "checkbox") {
      control.checked = jessnixInverted ? !value : value;
    } else {
      control.value = String(value);
    }
  },

  writeLayoutControl(control) {
    JessnixLooks.recordUndo();
    const { jessnixPref: pref, jessnixType: type, jessnixInverted } = control.dataset;
    if (control.localName == "checkbox") {
      Services.prefs.setBoolPref(pref, jessnixInverted ? !control.checked : control.checked);
    } else if (type == "int") {
      Services.prefs.setIntPref(pref, parseInt(control.value, 10));
    } else if (type == "bool") {
      Services.prefs.setBoolPref(pref, control.value == "true");
    } else {
      Services.prefs.setStringPref(pref, control.value);
    }
  },

  setAccent(value) {
    JessnixLooks.recordUndo();
    Services.prefs.setStringPref(JESSNIX_PREF_ACCENT, value);
  },

  watchPrefs(prefs, callback) {
    const observer = { observe: callback };
    for (const pref of prefs) {
      Services.prefs.addObserver(pref, observer);
    }
    window.addEventListener(
      "unload",
      () => {
        for (const pref of prefs) {
          Services.prefs.removeObserver(pref, observer);
        }
      },
      { once: true }
    );
  },

  // Text: every font installed on this computer.
  async initFonts() {
    const menulist = document.getElementById("jessnixLookFont");
    const popup = document.getElementById("jessnixLookFontPopup");
    let fonts = [];
    try {
      fonts = await Cc["@mozilla.org/gfx/fontenumerator;1"]
        .createInstance(Ci.nsIFontEnumerator)
        .EnumerateAllFontsAsync();
    } catch (e) {
      console.error("Personalize: cannot list fonts", e);
    }
    for (const font of [...new Set(fonts)].sort((a, b) => a.localeCompare(b))) {
      const item = document.createXULElement("menuitem");
      item.setAttribute("label", font);
      item.setAttribute("value", font);
      item.style.fontFamily = `"${font}"`;
      popup.appendChild(item);
    }
    const sync = () => {
      menulist.value = Services.prefs.getStringPref(JESSNIX_PREF_FONT, "");
    };
    menulist.addEventListener("command", () => {
      JessnixLooks.recordUndo();
      if (menulist.value) {
        Services.prefs.setStringPref(JESSNIX_PREF_FONT, menulist.value);
      } else {
        Services.prefs.clearUserPref(JESSNIX_PREF_FONT);
      }
    });
    this.watchPrefs([JESSNIX_PREF_FONT], sync);
    sync();
  },

  // Light/dark by time: two times, shown while the switch is on.
  initSchedule() {
    const dark = document.getElementById("jessnixLookDarkFrom");
    const light = document.getElementById("jessnixLookLightFrom");
    const times = document.getElementById("jessnixLookScheduleTimes");
    const sync = () => {
      dark.value = Services.prefs.getStringPref(JESSNIX_PREF_DARK_FROM, "19:00");
      light.value = Services.prefs.getStringPref(JESSNIX_PREF_LIGHT_FROM, "07:00");
      times.hidden = !Services.prefs.getBoolPref(JESSNIX_PREF_SCHEDULE, false);
    };
    for (const [input, pref] of [
      [dark, JESSNIX_PREF_DARK_FROM],
      [light, JESSNIX_PREF_LIGHT_FROM],
    ]) {
      input.addEventListener("change", () => {
        if (/^\d{2}:\d{2}$/.test(input.value)) {
          JessnixLooks.recordUndo();
          Services.prefs.setStringPref(pref, input.value);
        }
      });
    }
    this.watchPrefs([JESSNIX_PREF_DARK_FROM, JESSNIX_PREF_LIGHT_FROM, JESSNIX_PREF_SCHEDULE], sync);
    sync();
  },

  // ---- Saved looks, sharing, undo, reset ----

  initLooks() {
    const list = document.getElementById("jessnixLooksList");
    const name = document.getElementById("jessnixLooksName");
    const code = document.getElementById("jessnixLooksCode");
    const on = (id, handler) =>
      document.getElementById(id).addEventListener("command", () => this.looksAction(handler));

    on("jessnixLooksApply", async () => {
      if (list.value && (await JessnixLooks.applySaved(list.value))) {
        return ["jessnix-looks-applied", { name: list.value }];
      }
      return null;
    });
    on("jessnixLooksDelete", async () => {
      if (!list.value) {
        return null;
      }
      const deleted = list.value;
      await JessnixLooks.remove(deleted);
      return ["jessnix-looks-deleted", { name: deleted }];
    });
    on("jessnixLooksSave", async () => {
      const value = name.value.trim();
      await JessnixLooks.save(value);
      name.value = "";
      await this.refreshLooks(value);
      return ["jessnix-looks-saved", { name: value }];
    });
    on("jessnixLooksExport", async () => {
      const path = await this.pickFile("export");
      if (!path) {
        return null;
      }
      await JessnixLooks.exportFile(path);
      return ["jessnix-looks-exported"];
    });
    on("jessnixLooksImport", async () => {
      const path = await this.pickFile("import");
      if (!path) {
        return null;
      }
      await JessnixLooks.importFile(path);
      return ["jessnix-looks-imported"];
    });
    on("jessnixLooksCopyCode", async () => {
      Cc["@mozilla.org/widget/clipboardhelper;1"]
        .getService(Ci.nsIClipboardHelper)
        .copyString(JessnixLooks.toCode());
      return ["jessnix-looks-code-copied"];
    });
    on("jessnixLooksUseCode", async () => {
      JessnixLooks.applyCode(code.value);
      code.value = "";
      return ["jessnix-looks-imported"];
    });
    on("jessnixSettingsExport", async () => {
      const path = await this.pickFile("backup-export", "custom-browser-settings.cbsettings", "*.cbsettings");
      if (!path) {
        return null;
      }
      await JessnixLooks.exportAll(path);
      return ["jessnix-settings-exported"];
    });
    on("jessnixSettingsImport", async () => {
      const path = await this.pickFile("backup-import", null, "*.cbsettings");
      if (!path) {
        return null;
      }
      const result = await JessnixLooks.importAll(path);
      return ["jessnix-settings-imported", result];
    });
    on("jessnixLooksUndo", async () => {
      JessnixLooks.undo();
      return ["jessnix-looks-undone"];
    });
    on("jessnixLooksResetLayout", async () => {
      JessnixLooks.reset("layout");
      JessnixLooks.reset("tabs");
      return ["jessnix-looks-reset-done"];
    });
    on("jessnixLooksResetColors", async () => {
      JessnixLooks.reset("colors");
      JessnixLooks.reset("text");
      return ["jessnix-looks-reset-done"];
    });
    on("jessnixLooksResetAll", async () => {
      JessnixLooks.reset("all");
      return ["jessnix-looks-reset-done"];
    });

    const offChange = JessnixLooks.onChange(() => this.refreshLooks());
    window.addEventListener("unload", offChange, { once: true });
    this.refreshLooks();
  },

  async looksAction(handler) {
    const status = document.getElementById("jessnixLooksStatus");
    try {
      const result = await handler();
      status.hidden = !result;
      if (result) {
        document.l10n.setAttributes(status, result[0], result[1]);
      }
    } catch (e) {
      status.hidden = false;
      document.l10n.setAttributes(status, "jessnix-looks-error", {
        message: e.message || String(e),
      });
    }
  },

  async refreshLooks(select) {
    const list = document.getElementById("jessnixLooksList");
    const popup = document.getElementById("jessnixLooksPopup");
    const looks = await JessnixLooks.list();
    const previous = select || list.value;
    popup.replaceChildren();
    if (!looks.length) {
      const item = document.createXULElement("menuitem");
      document.l10n.setAttributes(item, "jessnix-looks-none");
      item.setAttribute("value", "");
      popup.appendChild(item);
    }
    for (const entry of looks) {
      const item = document.createXULElement("menuitem");
      item.setAttribute("label", entry.name);
      item.setAttribute("value", entry.name);
      popup.appendChild(item);
    }
    list.value = looks.some(l => l.name === previous) ? previous : looks[0]?.name || "";
    document.getElementById("jessnixLooksApply").disabled = !looks.length;
    document.getElementById("jessnixLooksDelete").disabled = !looks.length;
    document.getElementById("jessnixLooksUndo").disabled = !JessnixLooks.canUndo;
  },

  async pickFile(mode, defaultName = "my-look.cblook", filter = "*.cblook") {
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    const title = await document.l10n.formatValue(`jessnix-looks-pick-${mode}`);
    const saving = mode.endsWith("export");
    picker.init(window.browsingContext, title, saving ? Ci.nsIFilePicker.modeSave : Ci.nsIFilePicker.modeOpen);
    picker.appendFilter("Custom Browser", filter);
    picker.appendFilters(Ci.nsIFilePicker.filterAll);
    if (saving && defaultName) {
      picker.defaultString = defaultName;
      picker.defaultExtension = defaultName.split(".").pop();
    }
    const result = await new Promise(resolve => picker.open(resolve));
    if (result == Ci.nsIFilePicker.returnCancel || !picker.file) {
      return null;
    }
    return picker.file.path;
  },

  // Colours from the background image, offered as the accent.
  showSwatches(image) {
    const box = document.getElementById("jessnixPersonalizeSwatchesBox");
    const holder = document.getElementById("jessnixPersonalizeSwatches");
    holder.replaceChildren();
    box.hidden = true;
    if (!image?.src) {
      return;
    }
    const colors = jessnixImageColors(image);
    for (const color of colors) {
      const swatch = document.createElementNS("http://www.w3.org/1999/xhtml", "button");
      swatch.className = "jessnix-swatch";
      // Inline: the Settings page doesn't load the browser window's styles.
      swatch.setAttribute(
        "style",
        `appearance:none;background-color:${color};width:28px;height:28px;border-radius:50%;` +
          "border:2px solid rgba(128,128,128,.45);padding:0;margin:6px 8px 6px 0;min-width:0"
      );
      swatch.title = color;
      swatch.addEventListener("click", () => this.setAccent(color));
      holder.appendChild(swatch);
    }
    box.hidden = !colors.length;
  },

  setName(value) {
    const name = value.trim();
    if (name) {
      Services.prefs.setStringPref(JESSNIX_PREF_NAME, name);
    } else {
      Services.prefs.clearUserPref(JESSNIX_PREF_NAME);
    }
  },

  updatePreviews() {
    const icon = Services.prefs.getStringPref(JESSNIX_PREF_ICON, "");
    document.getElementById("jessnixPersonalizeIconPreview").src = icon
      ? this.fileUrl(icon)
      : "chrome://branding/content/icon64.png";

    const background = Services.prefs.getStringPref(JESSNIX_PREF_BACKGROUND, "");
    const backgroundPreview = document.getElementById(
      "jessnixPersonalizeBackgroundPreview"
    );
    backgroundPreview.hidden = !background;
    backgroundPreview.src = background ? this.fileUrl(background) : "";
    if (background) {
      backgroundPreview.addEventListener("load", () => this.showSwatches(backgroundPreview), {
        once: true,
      });
    } else {
      this.showSwatches(null);
    }
    document.getElementById("jessnixPersonalizeStrength").disabled = !background;

    const accent = Services.prefs.getStringPref(JESSNIX_PREF_ACCENT, "");
    if (/^#[0-9a-f]{6}$/i.test(accent)) {
      document.getElementById("jessnixPersonalizeAccent").value = accent;
    }
  },

  fileUrl(path) {
    return PathUtils.toFileURI(path);
  },

  get imageFolder() {
    return PathUtils.join(PathUtils.profileDir, "jessnix");
  },

  async chooseImage(kind, pref) {
    this.showError(null);
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    const title = await document.l10n.formatValue(`jessnix-personalize-pick-${kind}`);
    picker.init(window.browsingContext, title, Ci.nsIFilePicker.modeOpen);
    picker.appendFilters(Ci.nsIFilePicker.filterImages);
    const result = await new Promise(resolve => picker.open(resolve));
    if (result != Ci.nsIFilePicker.returnOK || !picker.file) {
      return;
    }

    const source = picker.file;
    const extension = source.leafName.split(".").pop().toLowerCase();
    if (!JESSNIX_IMAGE_EXTENSIONS.includes(extension)) {
      this.showError("jessnix-personalize-error-type");
      return;
    }
    if (source.fileSize > JESSNIX_IMAGE_LIMITS[kind]) {
      this.showError("jessnix-personalize-error-size", {
        megabytes: JESSNIX_IMAGE_LIMITS[kind] / (1024 * 1024),
      });
      return;
    }

    // A new file name each time, so windows never show a cached older image.
    await IOUtils.makeDirectory(this.imageFolder, { ignoreExisting: true });
    const copy = PathUtils.join(this.imageFolder, `${kind}-${Date.now()}.${extension}`);
    await IOUtils.copy(source.path, copy);
    JessnixLooks.recordUndo();
    const previous = Services.prefs.getStringPref(pref, "");
    Services.prefs.setStringPref(pref, copy);
    await this.removeOwnCopy(previous);
  },

  async clearImage(pref) {
    this.showError(null);
    const previous = Services.prefs.getStringPref(pref, "");
    Services.prefs.clearUserPref(pref);
    await this.removeOwnCopy(previous);
  },

  // Only ever deletes the copies this page made in the profile's jessnix folder.
  async removeOwnCopy(path) {
    if (path && PathUtils.parent(path) == this.imageFolder) {
      await IOUtils.remove(path, { ignoreAbsent: true });
    }
  },

  showError(l10nId, args) {
    const error = document.getElementById("jessnixPersonalizeError");
    error.hidden = !l10nId;
    if (l10nId) {
      document.l10n.setAttributes(error, l10nId, args);
    }
  },
};

// The main colours of an image, most common first, skipping near-greys,
// near-black and near-white, and colours too close to one already picked.
function jessnixImageColors(image, count = 6) {
  const size = 48;
  const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  try {
    context.drawImage(image, 0, 0, size, size);
  } catch {
    return [];
  }
  const { data } = context.getImageData(0, 0, size, size);
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) {
      continue;
    }
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 40 || min > 225 || max - min < 28) {
      continue;
    }
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const picked = [];
  for (const bucket of [...buckets.values()].sort((a, b) => b.n - a.n)) {
    const color = [bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n].map(Math.round);
    if (picked.some(p => Math.hypot(p[0] - color[0], p[1] - color[1], p[2] - color[2]) < 60)) {
      continue;
    }
    picked.push(color);
    if (picked.length >= count) {
      break;
    }
  }
  return picked.map(c => "#" + c.map(v => v.toString(16).padStart(2, "0")).join(""));
}
