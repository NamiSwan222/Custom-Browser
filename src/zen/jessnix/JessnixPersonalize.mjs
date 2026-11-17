// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Jessnix personalization, applied to each browser window: the browser's name
// in the window title, its window icon, and a background image behind the tabs
// and toolbars. Each person sets these in Settings > Look and Feel >
// Personalize (jessnix-settings.js); the choices live in prefs, and the chosen
// images are copied into the profile's "jessnix" folder.

const PREF_NAME = "jessnix.personalize.name";
const PREF_ICON = "jessnix.personalize.icon";
const PREF_BACKGROUND = "jessnix.personalize.background";
const PREF_BACKGROUND_STRENGTH = "jessnix.personalize.background-strength";
const PREF_SIZE = "jessnix.look.size";
const PREFS = [PREF_NAME, PREF_ICON, PREF_BACKGROUND, PREF_BACKGROUND_STRENGTH, PREF_SIZE];

// Narrowest sidebar for each Layout size (jessnix-look.css), so the bigger text
// still leaves room for tab names. 0 is Zen's own size, with no minimum.
const SIDEBAR_MIN_WIDTH = { 1: 205, 2: 235 };

// Largest icon size Windows asks for (taskbar and Alt+Tab at high DPI).
const ICON_DECODE_SIZE = 256;

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
  TaskbarTabsUtils:
    "moz-src:///browser/components/taskbartabs/TaskbarTabsUtils.sys.mjs",
});

const MIME_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  ico: "image/vnd.microsoft.icon",
};

export function jessnixImageMime(path) {
  const extension = path.split(".").pop().toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? null;
}

class nsJessnixPersonalize {
  #isRunning = false;

  init() {
    if (this.#isRunning) {
      return;
    }
    this.#isRunning = true;
    this.#wrapWindowTitle();
    for (const pref of PREFS) {
      Services.prefs.addObserver(pref, this);
    }
    window.addEventListener(
      "unload",
      () => {
        for (const pref of PREFS) {
          Services.prefs.removeObserver(pref, this);
        }
      },
      { once: true }
    );
    this.#applyName();
    this.#applyIcon();
    this.#applyBackground();
    this.#applySidebarWidth();
    // Shortcut name and icon: one shared module for the whole session.
    ChromeUtils.importESModule(
      "chrome://browser/content/zen-components/JessnixAppIdentity.mjs"
    );
  }

  observe(_subject, _topic, pref) {
    switch (pref) {
      case PREF_NAME:
        this.#applyName();
        break;
      case PREF_ICON:
        this.#applyIcon();
        break;
      case PREF_BACKGROUND:
      case PREF_BACKGROUND_STRENGTH:
        this.#applyBackground();
        break;
      case PREF_SIZE:
        this.#applySidebarWidth();
        break;
    }
  }

  get #customName() {
    return Services.prefs.getStringPref(PREF_NAME, "").trim();
  }

  // The window title ends with the brand ("Page — Jessnix Browser"). Firefox
  // builds it in one place, so the brand part is swapped there for the chosen
  // name; every other place keeps the real product name.
  #wrapWindowTitle() {
    const original = gBrowser.getWindowTitleForBrowser.bind(gBrowser);
    gBrowser.getWindowTitleForBrowser = browser => {
      const title = original(browser);
      const name = this.#customName;
      const brand = document.getElementById("mainWindowTitle")?.textContent;
      if (!name || !brand) {
        return title;
      }
      const at = title.lastIndexOf(brand);
      return at == -1
        ? title
        : title.slice(0, at) + name + title.slice(at + brand.length);
    };
  }

  #applyName() {
    gBrowser.updateTitlebar();
  }

  async #applyIcon() {
    if (AppConstants.platform != "win") {
      return;
    }
    const utils = Cc["@mozilla.org/windows-ui-utils;1"].getService(
      Ci.nsIWindowsUIUtils
    );
    const path = Services.prefs.getStringPref(PREF_ICON, "");
    const mime = path && jessnixImageMime(path);
    if (!path || !mime || !(await IOUtils.exists(path))) {
      // Back to the icon built into jessnix.exe.
      utils.setWindowIconFromExe(window, Services.dirsvc.get("XREExeF", Ci.nsIFile).path, 0);
      return;
    }
    try {
      // Decoded in a content process, as Firefox does for any image it didn't ship.
      const image = await lazy.TaskbarTabsUtils._remoteDecodeImageFromFile(
        new lazy.FileUtils.File(path),
        ICON_DECODE_SIZE,
        null,
        mime
      );
      utils.setWindowIcon(window, image, image);
    } catch (error) {
      console.error("Jessnix: could not use the chosen icon", path, error);
    }
  }

  // Widens the sidebar to the size's minimum, the same way Zen's own resize
  // handle does; a sidebar already wider, or dragged wider later, is left alone.
  #applySidebarWidth() {
    const minWidth = SIDEBAR_MIN_WIDTH[Services.prefs.getIntPref(PREF_SIZE, 0)];
    const toolbox = document.getElementById("navigator-toolbox");
    if (!minWidth || !toolbox?.hasAttribute("zen-sidebar-expanded")) {
      return;
    }
    const width = parseFloat(toolbox.getAttribute("width") || toolbox.style.width);
    if (width >= minWidth) {
      return;
    }
    const value = `${minWidth}px`;
    toolbox.style.width = value;
    toolbox.style.setProperty("--zen-sidebar-width", value);
    toolbox.setAttribute("width", value);
    window.dispatchEvent(new Event("resize"));
  }

  async #applyBackground() {
    const root = document.documentElement;
    const path = Services.prefs.getStringPref(PREF_BACKGROUND, "");
    if (!path || !jessnixImageMime(path) || !(await IOUtils.exists(path))) {
      root.removeAttribute("jessnix-background");
      root.style.removeProperty("--jessnix-background-image");
      return;
    }
    const url = PathUtils.toFileURI(path);
    const strength = Services.prefs.getIntPref(PREF_BACKGROUND_STRENGTH, 60);
    root.style.setProperty("--jessnix-background-image", `url("${url}")`);
    root.style.setProperty(
      "--jessnix-background-opacity",
      String(Math.min(Math.max(strength, 0), 100) / 100)
    );
    root.setAttribute("jessnix-background", "true");
  }
}

window.gJessnixPersonalize = new nsJessnixPersonalize();
// gBrowser and the title strings exist once the window has finished starting.
window.delayedStartupPromise.then(() => window.gJessnixPersonalize.init());
