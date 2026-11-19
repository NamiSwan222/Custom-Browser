// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Making it yours per site and per space:
// - Page right-click menu: "Dark mode for this site" and "Style this site…".
//   Both use Zen's Boosts (src/zen/boosts/), which already store per-site
//   colours, dark mode (smart invert), fonts, hidden page parts and custom CSS;
//   this only gives them a quicker way in. Firefox remembers zoom per site
//   (browser.zoom.siteSpecific).
// - Space right-click menu: a background image and a font for just that
//   space. Zen already gives each space its own colours (the space's theme).
//   A space without its own choices uses the normal look (Personalize).

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AboutNewTab: "resource:///modules/AboutNewTab.sys.mjs",
  gZenBoostsManager: "resource:///modules/zen/boosts/ZenBoostsManager.sys.mjs",
});

// Custom Browser's own new tab page (jessnix-newtab.html): clock, search,
// shortcuts and notes, arranged by the person, no network requests.
const PREF_NEWTAB = "jessnix.newtab.enabled";
const NEWTAB_URL = "chrome://browser/content/jessnix-newtab.html";

// { "<space uuid>": { background: "<path>", font: "<family>" } }
const PREF_SPACE_LOOKS = "jessnix.spaces.looks";
const PREF_ACTIVE_SPACE = "zen.workspaces.active";
const PREF_BACKGROUND = "jessnix.personalize.background";
const PREF_FONT = "jessnix.look.ui-font";
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);
const IMAGE_LIMIT = 25 * 1024 * 1024;

function readSpaceLooks() {
  try {
    const value = JSON.parse(Services.prefs.getStringPref(PREF_SPACE_LOOKS, "{}"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeSpaceLooks(looks) {
  Services.prefs.setStringPref(PREF_SPACE_LOOKS, JSON.stringify(looks));
}

class nsJessnixSiteTools {
  init() {
    this.#setupNewTab();
    Services.prefs.addObserver(PREF_NEWTAB, () => this.#setupNewTab());
    this.#addPageMenu();
    this.#addSpaceMenu();
    window.addEventListener("ZenWorkspacesUIUpdate", () => this.applySpaceLook());
    // Zen records the space switched to in this pref (each window then reads
    // its own active space).
    for (const pref of [PREF_SPACE_LOOKS, PREF_ACTIVE_SPACE]) {
      Services.prefs.addObserver(pref, this);
    }
    window.addEventListener(
      "unload",
      () => {
        for (const pref of [PREF_SPACE_LOOKS, PREF_ACTIVE_SPACE]) {
          Services.prefs.removeObserver(pref, this);
        }
      },
      { once: true }
    );
    this.applySpaceLook();
  }

  observe() {
    this.applySpaceLook();
  }

  // The new tab page is one setting for the whole browser; any window sets it.
  #setupNewTab() {
    const on = Services.prefs.getBoolPref(PREF_NEWTAB, true);
    if (on) {
      if (lazy.AboutNewTab.newTabURL !== NEWTAB_URL) {
        lazy.AboutNewTab.newTabURL = NEWTAB_URL;
      }
      // Like about:newtab: an empty address bar, ready to type in.
      if (!gInitialPages.includes(NEWTAB_URL)) {
        gInitialPages.push(NEWTAB_URL);
      }
    } else if (lazy.AboutNewTab.newTabURL === NEWTAB_URL) {
      lazy.AboutNewTab.resetNewTabURL();
    }
  }

  #menuItem(id, label, onCommand, { checkbox = false } = {}) {
    const item = document.createXULElement("menuitem");
    item.id = id;
    item.setAttribute("label", label);
    if (checkbox) {
      item.setAttribute("type", "checkbox");
    }
    item.addEventListener("command", onCommand);
    return item;
  }

  // ---- Per site ----------------------------------------------------------

  get #siteURI() {
    return gBrowser.currentURI;
  }

  get #canBoost() {
    try {
      return lazy.gZenBoostsManager.canBoostSite(this.#siteURI);
    } catch {
      return false;
    }
  }

  #activeBoost(domain, create) {
    const manager = lazy.gZenBoostsManager;
    let boost = null;
    try {
      boost = manager.loadActiveBoostFromStore(domain);
    } catch {}
    if (!boost && create) {
      boost = manager.createNewBoost(domain);
      boost.boostEntry.boostData.boostName = "Dark mode";
    }
    return boost;
  }

  isSiteDark() {
    if (!this.#canBoost) {
      return false;
    }
    const domain = this.#siteURI.host;
    const manager = lazy.gZenBoostsManager;
    if (!manager.getActiveBoostId?.(domain)) {
      return false;
    }
    return !!this.#activeBoost(domain, false)?.boostEntry?.boostData?.smartInvert;
  }

  toggleSiteDark() {
    if (!this.#canBoost) {
      return;
    }
    const domain = this.#siteURI.host;
    const manager = lazy.gZenBoostsManager;
    const boost = this.#activeBoost(domain, true);
    const data = boost.boostEntry.boostData;
    data.smartInvert = !this.isSiteDark();
    data.changeWasMade = true;
    manager.saveBoostToStore(boost);
    if (manager.getActiveBoostId?.(domain) !== boost.id) {
      manager.makeBoostActiveForDomain(domain, boost.id);
    }
  }

  styleSite() {
    if (!this.#canBoost) {
      return;
    }
    const uri = this.#siteURI;
    const boost = this.#activeBoost(uri.host, false) || lazy.gZenBoostsManager.createNewBoost(uri.host);
    lazy.gZenBoostsManager.openBoostWindow(window, boost, uri);
  }

  #addPageMenu() {
    const menu = document.getElementById("contentAreaContextMenu");
    if (!menu || document.getElementById("jessnix-site-dark")) {
      return;
    }
    const separator = document.createXULElement("menuseparator");
    separator.id = "jessnix-site-separator";
    const dark = this.#menuItem("jessnix-site-dark", "Dark mode for this site", () => this.toggleSiteDark(), {
      checkbox: true,
    });
    const style = this.#menuItem("jessnix-site-style", "Style this site…", () => this.styleSite());
    menu.append(separator, dark, style);
    menu.addEventListener("popupshowing", event => {
      if (event.target !== menu) {
        return;
      }
      const canBoost = this.#canBoost;
      for (const element of [separator, dark, style]) {
        element.hidden = !canBoost;
      }
      dark.toggleAttribute("checked", canBoost && this.isSiteDark());
    });
  }

  // ---- Per space ---------------------------------------------------------

  get #spaceId() {
    return gZenWorkspaces?.activeWorkspace || "";
  }

  // The space whose menu was opened, or the current one.
  #menuSpaceId(menu) {
    const node = menu.triggerNode?.closest?.("zen-workspace, [zen-workspace-id]");
    return node?.id || node?.getAttribute?.("zen-workspace-id") || this.#spaceId;
  }

  #addSpaceMenu() {
    const menu = document.getElementById("zenWorkspaceMoreActions");
    if (!menu || document.getElementById("jessnix-space-background")) {
      return;
    }
    const separator = document.createXULElement("menuseparator");
    const background = this.#menuItem("jessnix-space-background", "Background for this space…", () =>
      this.chooseSpaceBackground(this.#menuSpaceId(menu))
    );
    const font = this.#menuItem("jessnix-space-font", "Font for this space…", () =>
      this.chooseSpaceFont(this.#menuSpaceId(menu))
    );
    const clear = this.#menuItem("jessnix-space-clear", "Use the normal look in this space", () =>
      this.clearSpaceLook(this.#menuSpaceId(menu))
    );
    menu.append(separator, background, font, clear);
    menu.addEventListener("popupshowing", event => {
      if (event.target === menu) {
        clear.disabled = !readSpaceLooks()[this.#menuSpaceId(menu)];
      }
    });
  }

  async chooseSpaceBackground(spaceId) {
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    picker.init(window.browsingContext, "Background for this space", Ci.nsIFilePicker.modeOpen);
    picker.appendFilters(Ci.nsIFilePicker.filterImages);
    const result = await new Promise(resolve => picker.open(resolve));
    if (result !== Ci.nsIFilePicker.returnOK || !picker.file) {
      return;
    }
    await this.setSpaceBackground(spaceId, picker.file.path);
  }

  // Copies the image into the profile, like Personalize does.
  async setSpaceBackground(spaceId, sourcePath) {
    const extension = sourcePath.split(".").pop().toLowerCase();
    const info = await IOUtils.stat(sourcePath);
    if (!IMAGE_EXTENSIONS.has(extension) || info.size > IMAGE_LIMIT) {
      throw new Error("Choose a PNG, JPEG, WebP, GIF or BMP image up to 25 MB.");
    }
    const folder = PathUtils.join(PathUtils.profileDir, "jessnix");
    await IOUtils.makeDirectory(folder, { ignoreExisting: true });
    const copy = PathUtils.join(folder, `space-${Date.now()}.${extension}`);
    await IOUtils.copy(sourcePath, copy);
    const looks = readSpaceLooks();
    const previous = looks[spaceId]?.background;
    looks[spaceId] = { ...looks[spaceId], background: copy };
    writeSpaceLooks(looks);
    if (previous && PathUtils.parent(previous) === folder) {
      await IOUtils.remove(previous, { ignoreAbsent: true });
    }
  }

  async chooseSpaceFont(spaceId) {
    let fonts = [];
    try {
      fonts = await Cc["@mozilla.org/gfx/fontenumerator;1"]
        .createInstance(Ci.nsIFontEnumerator)
        .EnumerateAllFontsAsync();
    } catch {}
    const list = ["(The normal font)", ...[...new Set(fonts)].sort((a, b) => a.localeCompare(b))];
    const selection = { value: 0 };
    const ok = Services.prompt.select(window, "Font for this space", "Pick the browser font for this space:", list, selection);
    if (ok) {
      this.setSpaceFont(spaceId, selection.value === 0 ? "" : list[selection.value]);
    }
  }

  setSpaceFont(spaceId, font) {
    const looks = readSpaceLooks();
    looks[spaceId] = { ...looks[spaceId], font: String(font || "").slice(0, 100) };
    if (!looks[spaceId].font) {
      delete looks[spaceId].font;
    }
    if (!Object.keys(looks[spaceId]).length) {
      delete looks[spaceId];
    }
    writeSpaceLooks(looks);
  }

  clearSpaceLook(spaceId) {
    const looks = readSpaceLooks();
    delete looks[spaceId];
    writeSpaceLooks(looks);
  }

  // The current space's own background and font, or the normal ones.
  applySpaceLook() {
    const look = readSpaceLooks()[this.#spaceId] || {};
    const root = document.documentElement;
    if (look.background) {
      root.style.setProperty("--jessnix-background-image", `url("${PathUtils.toFileURI(look.background)}")`);
      root.style.setProperty(
        "--jessnix-background-opacity",
        String(Services.prefs.getIntPref("jessnix.personalize.background-strength", 60) / 100)
      );
      root.setAttribute("jessnix-background", "true");
      root.setAttribute("jessnix-space-background", "true");
    } else if (root.hasAttribute("jessnix-space-background")) {
      root.removeAttribute("jessnix-space-background");
      window.gJessnixPersonalize?.observe(null, "nsPref:changed", PREF_BACKGROUND);
    }
    if (look.font) {
      root.toggleAttribute("jessnix-ui-font", true);
      root.style.setProperty("--jessnix-ui-font", `"${look.font.replace(/["\\;{}]/g, "")}"`);
      root.setAttribute("jessnix-space-font", "true");
    } else if (root.hasAttribute("jessnix-space-font")) {
      root.removeAttribute("jessnix-space-font");
      window.gJessnixLookExtras?.observe(null, "nsPref:changed", PREF_FONT);
    }
  }
}

window.gJessnixSiteTools = new nsJessnixSiteTools();
window.delayedStartupPromise.then(() =>
  gZenWorkspaces.promiseInitialized.then(() => window.gJessnixSiteTools.init())
);
