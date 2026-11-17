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
    accent.addEventListener("change", () =>
      Services.prefs.setStringPref(JESSNIX_PREF_ACCENT, accent.value)
    );
    document
      .getElementById("jessnixPersonalizeAccentReset")
      .addEventListener("command", () =>
        Services.prefs.setStringPref(JESSNIX_PREF_ACCENT, JESSNIX_SYSTEM_ACCENT)
      );

    this.initLayoutControls();

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
