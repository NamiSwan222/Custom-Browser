// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

/* global Preferences */

// Settings > Look and Feel > Personalize (customPersonalize.inc.xhtml).
// Choices are prefs; CustomPersonalize.mjs applies them to every window.

const CUSTOM_PREF_NAME = "custom.personalize.name";
const CUSTOM_PREF_ICON = "custom.personalize.icon";
const CUSTOM_PREF_BACKGROUND = "custom.personalize.background";
const CUSTOM_PREF_ACCENT = "zen.theme.accent-color";
// Zen's accent pref takes a CSS colour; this keyword follows Windows' accent colour.
const CUSTOM_SYSTEM_ACCENT = "AccentColor";

// Chosen images are copied here, so moving or deleting the original is harmless.
const CUSTOM_IMAGE_LIMITS = { icon: 5 * 1024 * 1024, background: 25 * 1024 * 1024 };
const CUSTOM_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico"];

document.l10n.addResourceIds(["browser/preferences/custom-preferences.ftl"]);

const { CustomLooks } = ChromeUtils.importESModule(
  "chrome://browser/content/zen-components/CustomLooks.sys.mjs"
);
const CUSTOM_PREF_FONT = "custom.look.ui-font";
const CUSTOM_PREF_DARK_FROM = "custom.look.dark-from";
const CUSTOM_PREF_LIGHT_FROM = "custom.look.light-from";
const CUSTOM_PREF_SCHEDULE = "custom.look.schedule";

Preferences.addAll([
  { id: "custom.personalize.background-strength", type: "int", default: 60 },
]);

var gCustomPersonalizeSettings = {
  init() {
    if (this._isInitialized) {
      return;
    }
    this._isInitialized = true;

    const nameInput = document.getElementById("customPersonalizeName");
    nameInput.value = Services.prefs.getStringPref(CUSTOM_PREF_NAME, "");
    nameInput.addEventListener("change", () => this.setName(nameInput.value));
    document
      .getElementById("customPersonalizeNameReset")
      .addEventListener("command", () => {
        nameInput.value = "";
        this.setName("");
      });

    document
      .getElementById("customPersonalizeIconChoose")
      .addEventListener("command", () => this.chooseImage("icon", CUSTOM_PREF_ICON));
    document
      .getElementById("customPersonalizeIconReset")
      .addEventListener("command", () => this.clearImage(CUSTOM_PREF_ICON));
    document
      .getElementById("customPersonalizeBackgroundChoose")
      .addEventListener("command", () =>
        this.chooseImage("background", CUSTOM_PREF_BACKGROUND)
      );
    document
      .getElementById("customPersonalizeBackgroundReset")
      .addEventListener("command", () => this.clearImage(CUSTOM_PREF_BACKGROUND));

    const accent = document.getElementById("customPersonalizeAccent");
    accent.addEventListener("change", () => this.setAccent(accent.value));
    document
      .getElementById("customPersonalizeAccentReset")
      .addEventListener("command", () => this.setAccent(CUSTOM_SYSTEM_ACCENT));

    this.initLayoutControls();
    this.initSearch();
    this.initFonts();
    this.initSchedule();
    this.initLooks();

    const watched = [CUSTOM_PREF_ICON, CUSTOM_PREF_BACKGROUND, CUSTOM_PREF_ACCENT];
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

  // Layout controls carry their pref in data-custom-pref (and -type, and
  // -inverted for a checkbox that means the opposite of its pref). Some of these
  // prefs are Zen's or Firefox's and may already be bound elsewhere in Settings,
  // so they are read and written directly instead of through Preferences.
  initLayoutControls() {
    const controls = document.querySelectorAll(
      "#customPersonalizeGroup [data-custom-pref]"
    );
    const prefs = new Set();
    for (const control of controls) {
      const pref = control.dataset.customPref;
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
    const { customPref: pref, customType: type, customInverted } = control.dataset;
    let value;
    if (type == "int") {
      value = Services.prefs.getIntPref(pref, 0);
    } else if (type == "bool") {
      value = Services.prefs.getBoolPref(pref, false);
    } else {
      value = Services.prefs.getStringPref(pref, "");
    }
    if (control.localName == "checkbox") {
      control.checked = customInverted ? !value : value;
    } else {
      control.value = String(value);
    }
  },

  writeLayoutControl(control) {
    CustomLooks.recordUndo();
    const { customPref: pref, customType: type, customInverted } = control.dataset;
    if (control.localName == "checkbox") {
      Services.prefs.setBoolPref(pref, customInverted ? !control.checked : control.checked);
    } else if (type == "int") {
      Services.prefs.setIntPref(pref, parseInt(control.value, 10));
    } else if (type == "bool") {
      Services.prefs.setBoolPref(pref, control.value == "true");
    } else {
      Services.prefs.setStringPref(pref, control.value);
    }
  },

  setAccent(value) {
    CustomLooks.recordUndo();
    Services.prefs.setStringPref(CUSTOM_PREF_ACCENT, value);
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

  // Search: the default engine, out of the ones the search service has. The
  // choice applies to private windows too. Firefox's own Search pane changes the
  // same setting, so the list follows the service instead of a pref.
  async initSearch() {
    const menulist = document.getElementById("customSearchEngine");
    const popup = document.getElementById("customSearchEnginePopup");
    const { SearchService } = ChromeUtils.importESModule(
      "moz-src:///toolkit/components/search/SearchService.sys.mjs"
    );
    const sync = async () => {
      const engines = await SearchService.getVisibleEngines();
      popup.replaceChildren();
      for (const engine of engines) {
        const item = document.createXULElement("menuitem");
        item.setAttribute("label", engine.name);
        item.setAttribute("value", engine.name);
        popup.appendChild(item);
      }
      menulist.value = SearchService.defaultEngine?.name || "";
    };
    menulist.addEventListener("command", async () => {
      const engine = SearchService.getEngineByName(menulist.value);
      if (!engine) {
        return;
      }
      await SearchService.setDefault(engine, SearchService.CHANGE_REASON.USER);
      // Only differs when private windows have their own engine.
      if (SearchService.defaultPrivateEngine?.name !== engine.name) {
        await SearchService.setDefaultPrivate(engine, SearchService.CHANGE_REASON.USER_PRIVATE_SPLIT);
      }
    });
    const observer = {
      observe: () => sync().catch(e => console.error("Personalize: search engines", e)),
    };
    Services.obs.addObserver(observer, "browser-search-engine-modified");
    window.addEventListener(
      "unload",
      () => Services.obs.removeObserver(observer, "browser-search-engine-modified"),
      { once: true }
    );
    try {
      await SearchService.init();
      await sync();
    } catch (e) {
      console.error("Personalize: cannot list search engines", e);
    }
  },

  // Text: every font installed on this computer.
  async initFonts() {
    const menulist = document.getElementById("customLookFont");
    const popup = document.getElementById("customLookFontPopup");
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
      menulist.value = Services.prefs.getStringPref(CUSTOM_PREF_FONT, "");
    };
    menulist.addEventListener("command", () => {
      CustomLooks.recordUndo();
      if (menulist.value) {
        Services.prefs.setStringPref(CUSTOM_PREF_FONT, menulist.value);
      } else {
        Services.prefs.clearUserPref(CUSTOM_PREF_FONT);
      }
    });
    this.watchPrefs([CUSTOM_PREF_FONT], sync);
    sync();
  },

  // Light/dark by time: two times, shown while the switch is on.
  initSchedule() {
    const dark = document.getElementById("customLookDarkFrom");
    const light = document.getElementById("customLookLightFrom");
    const times = document.getElementById("customLookScheduleTimes");
    const sync = () => {
      dark.value = Services.prefs.getStringPref(CUSTOM_PREF_DARK_FROM, "19:00");
      light.value = Services.prefs.getStringPref(CUSTOM_PREF_LIGHT_FROM, "07:00");
      times.hidden = !Services.prefs.getBoolPref(CUSTOM_PREF_SCHEDULE, false);
    };
    for (const [input, pref] of [
      [dark, CUSTOM_PREF_DARK_FROM],
      [light, CUSTOM_PREF_LIGHT_FROM],
    ]) {
      input.addEventListener("change", () => {
        if (/^\d{2}:\d{2}$/.test(input.value)) {
          CustomLooks.recordUndo();
          Services.prefs.setStringPref(pref, input.value);
        }
      });
    }
    this.watchPrefs([CUSTOM_PREF_DARK_FROM, CUSTOM_PREF_LIGHT_FROM, CUSTOM_PREF_SCHEDULE], sync);
    sync();
  },

  // ---- Saved looks, sharing, undo, reset ----

  initLooks() {
    const list = document.getElementById("customLooksList");
    const name = document.getElementById("customLooksName");
    const code = document.getElementById("customLooksCode");
    const on = (id, handler) =>
      document.getElementById(id).addEventListener("command", () => this.looksAction(handler));

    on("customLooksApply", async () => {
      if (list.value && (await CustomLooks.applySaved(list.value))) {
        return ["custom-looks-applied", { name: list.value }];
      }
      return null;
    });
    on("customLooksDelete", async () => {
      if (!list.value) {
        return null;
      }
      const deleted = list.value;
      await CustomLooks.remove(deleted);
      return ["custom-looks-deleted", { name: deleted }];
    });
    on("customLooksSave", async () => {
      const value = name.value.trim();
      await CustomLooks.save(value);
      name.value = "";
      await this.refreshLooks(value);
      return ["custom-looks-saved", { name: value }];
    });
    on("customLooksExport", async () => {
      const path = await this.pickFile("export");
      if (!path) {
        return null;
      }
      await CustomLooks.exportFile(path);
      return ["custom-looks-exported"];
    });
    on("customLooksImport", async () => {
      const path = await this.pickFile("import");
      if (!path) {
        return null;
      }
      await CustomLooks.importFile(path);
      return ["custom-looks-imported"];
    });
    on("customLooksCopyCode", async () => {
      Cc["@mozilla.org/widget/clipboardhelper;1"]
        .getService(Ci.nsIClipboardHelper)
        .copyString(CustomLooks.toCode());
      return ["custom-looks-code-copied"];
    });
    on("customLooksUseCode", async () => {
      CustomLooks.applyCode(code.value);
      code.value = "";
      return ["custom-looks-imported"];
    });
    on("customSettingsExport", async () => {
      const path = await this.pickFile("backup-export", "custom-browser-settings.cbsettings", "*.cbsettings");
      if (!path) {
        return null;
      }
      await CustomLooks.exportAll(path);
      return ["custom-settings-exported"];
    });
    on("customSettingsImport", async () => {
      const path = await this.pickFile("backup-import", null, "*.cbsettings");
      if (!path) {
        return null;
      }
      const result = await CustomLooks.importAll(path);
      return ["custom-settings-imported", result];
    });
    on("customLooksUndo", async () => {
      CustomLooks.undo();
      return ["custom-looks-undone"];
    });
    on("customLooksResetLayout", async () => {
      CustomLooks.reset("layout");
      CustomLooks.reset("tabs");
      return ["custom-looks-reset-done"];
    });
    on("customLooksResetColors", async () => {
      CustomLooks.reset("colors");
      CustomLooks.reset("text");
      return ["custom-looks-reset-done"];
    });
    on("customLooksResetAll", async () => {
      CustomLooks.reset("all");
      return ["custom-looks-reset-done"];
    });

    const offChange = CustomLooks.onChange(() => this.refreshLooks());
    window.addEventListener("unload", offChange, { once: true });
    this.refreshLooks();
  },

  async looksAction(handler) {
    const status = document.getElementById("customLooksStatus");
    try {
      const result = await handler();
      status.hidden = !result;
      if (result) {
        document.l10n.setAttributes(status, result[0], result[1]);
      }
    } catch (e) {
      status.hidden = false;
      document.l10n.setAttributes(status, "custom-looks-error", {
        message: e.message || String(e),
      });
    }
  },

  async refreshLooks(select) {
    const list = document.getElementById("customLooksList");
    const popup = document.getElementById("customLooksPopup");
    const looks = await CustomLooks.list();
    const previous = select || list.value;
    popup.replaceChildren();
    if (!looks.length) {
      const item = document.createXULElement("menuitem");
      document.l10n.setAttributes(item, "custom-looks-none");
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
    document.getElementById("customLooksApply").disabled = !looks.length;
    document.getElementById("customLooksDelete").disabled = !looks.length;
    document.getElementById("customLooksUndo").disabled = !CustomLooks.canUndo;
  },

  async pickFile(mode, defaultName = "my-look.cblook", filter = "*.cblook") {
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    const title = await document.l10n.formatValue(`custom-looks-pick-${mode}`);
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
    const box = document.getElementById("customPersonalizeSwatchesBox");
    const holder = document.getElementById("customPersonalizeSwatches");
    holder.replaceChildren();
    box.hidden = true;
    if (!image?.src) {
      return;
    }
    const colors = customImageColors(image);
    for (const color of colors) {
      const swatch = document.createElementNS("http://www.w3.org/1999/xhtml", "button");
      swatch.className = "custom-swatch";
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
      Services.prefs.setStringPref(CUSTOM_PREF_NAME, name);
    } else {
      Services.prefs.clearUserPref(CUSTOM_PREF_NAME);
    }
  },

  updatePreviews() {
    const icon = Services.prefs.getStringPref(CUSTOM_PREF_ICON, "");
    document.getElementById("customPersonalizeIconPreview").src = icon
      ? this.fileUrl(icon)
      : "chrome://branding/content/icon64.png";

    const background = Services.prefs.getStringPref(CUSTOM_PREF_BACKGROUND, "");
    const backgroundPreview = document.getElementById(
      "customPersonalizeBackgroundPreview"
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
    document.getElementById("customPersonalizeStrength").disabled = !background;

    const accent = Services.prefs.getStringPref(CUSTOM_PREF_ACCENT, "");
    if (/^#[0-9a-f]{6}$/i.test(accent)) {
      document.getElementById("customPersonalizeAccent").value = accent;
    }
  },

  fileUrl(path) {
    return PathUtils.toFileURI(path);
  },

  get imageFolder() {
    return PathUtils.join(PathUtils.profileDir, "custom-browser");
  },

  async chooseImage(kind, pref) {
    this.showError(null);
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    const title = await document.l10n.formatValue(`custom-personalize-pick-${kind}`);
    picker.init(window.browsingContext, title, Ci.nsIFilePicker.modeOpen);
    picker.appendFilters(Ci.nsIFilePicker.filterImages);
    const result = await new Promise(resolve => picker.open(resolve));
    if (result != Ci.nsIFilePicker.returnOK || !picker.file) {
      return;
    }

    const source = picker.file;
    const extension = source.leafName.split(".").pop().toLowerCase();
    if (!CUSTOM_IMAGE_EXTENSIONS.includes(extension)) {
      this.showError("custom-personalize-error-type");
      return;
    }
    if (source.fileSize > CUSTOM_IMAGE_LIMITS[kind]) {
      this.showError("custom-personalize-error-size", {
        megabytes: CUSTOM_IMAGE_LIMITS[kind] / (1024 * 1024),
      });
      return;
    }

    // A new file name each time, so windows never show a cached older image.
    await IOUtils.makeDirectory(this.imageFolder, { ignoreExisting: true });
    const copy = PathUtils.join(this.imageFolder, `${kind}-${Date.now()}.${extension}`);
    await IOUtils.copy(source.path, copy);
    CustomLooks.recordUndo();
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

  // Only ever deletes the copies this page made in the profile's custom-browser folder.
  async removeOwnCopy(path) {
    if (path && PathUtils.parent(path) == this.imageFolder) {
      await IOUtils.remove(path, { ignoreAbsent: true });
    }
  },

  showError(l10nId, args) {
    const error = document.getElementById("customPersonalizeError");
    error.hidden = !l10nId;
    if (l10nId) {
      document.l10n.setAttributes(error, l10nId, args);
    }
  },
};

// The main colours of an image, most common first, skipping near-greys,
// near-black and near-white, and colours too close to one already picked.
function customImageColors(image, count = 6) {
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
