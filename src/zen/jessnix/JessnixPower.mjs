// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Power features, in each browser window:
// - Command palette (Ctrl+K): open tabs, bookmarks, history, settings pages,
//   saved looks and browser actions, in one box.
// - Game mode: unloads background tabs, pauses their media and frees memory,
//   and switches to compact mode; off brings compact mode back as it was.
// - Throwaway tabs: a site in its own temporary container (cookies, logins and
//   storage of its own), wiped when its last tab closes.
// - Site notes: a small panel of notes for the site in front, kept per site.
// - Screenshot and text direction (Firefox's own commands) in the palette;
//   rebinding shortcuts is Firefox/Zen's about:keyboard.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ContextualIdentityService:
    "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs",
  JessnixLooks: "chrome://browser/content/zen-components/JessnixLooks.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
});

const HTML_NS = "http://www.w3.org/1999/xhtml";
const PREF_GAME_MODE = "jessnix.game-mode";
const PREF_GAME_COMPACT_SAVED = "jessnix.game-mode.saved-compact";
const PREF_NOTES = "jessnix.site-notes";
const THROWAWAY_NAME = "Throwaway";
const MAX_RESULTS = 12;

// Settings pages the palette can open.
const SETTINGS_PAGES = [
  ["Settings: General", "about:preferences#general"],
  ["Settings: Look and Feel (Personalize)", "about:preferences#zenLooks"],
  ["Settings: Tab Management", "about:preferences#zenTabManagement"],
  ["Settings: Search", "about:preferences#search"],
  ["Settings: Privacy and Security", "about:preferences#privacy"],
  ["Settings: Sync", "about:preferences#sync"],
  ["Keyboard shortcuts", "about:keyboard"],
  ["Passwords", "about:logins"],
  ["Add-ons and themes", "about:addons"],
  ["Downloads", "about:downloads"],
];

function matches(text, words) {
  const haystack = String(text || "").toLowerCase();
  return words.every(word => haystack.includes(word));
}

function readNotes() {
  try {
    const value = JSON.parse(Services.prefs.getStringPref(PREF_NOTES, "{}"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

class nsJessnixPower {
  #palette = null;
  #results = [];
  #selected = 0;
  #queryId = 0;
  #notesPanel = null;
  #throwawayIds = new Set();

  init() {
    // Capture phase, so Ctrl+K reaches the palette before Firefox's web search.
    window.addEventListener("keydown", event => this.#onKey(event), true);
    gBrowser.tabContainer.addEventListener("TabClose", event => this.#onTabClose(event));
    Services.prefs.addObserver(PREF_GAME_MODE, this);
    window.addEventListener(
      "unload",
      () => Services.prefs.removeObserver(PREF_GAME_MODE, this),
      { once: true }
    );
    this.#addLinkMenu();
    // Firefox's "Switch Text Direction" in text box right-click menus.
    Services.prefs.setBoolPref("bidi.browser.ui", true);
    // Ctrl+K is the palette here; Firefox's own Ctrl+K (focus web search) would
    // otherwise run too and take the focus. Ctrl+E still focuses search.
    document.getElementById("key_search")?.setAttribute("disabled", "true");
  }

  observe() {
    if (Services.prefs.getBoolPref(PREF_GAME_MODE, false)) {
      this.#gameModeOn();
    }
  }

  #onKey(event) {
    const accel = AppConstants.platform == "macosx" ? event.metaKey : event.ctrlKey;
    if (accel && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      event.stopPropagation();
      this.togglePalette();
    } else if (this.isPaletteOpen) {
      this.#onPaletteKey(event);
    }
  }

  // ---- Command palette -----------------------------------------------------

  #el(tag, className, text) {
    const el = document.createElementNS(HTML_NS, tag);
    if (className) {
      el.className = className;
    }
    if (text !== undefined) {
      el.textContent = text;
    }
    return el;
  }

  // A XUL panel: unlike a plain element, a panel takes the keyboard focus from
  // the page reliably when it opens.
  #ensurePalette() {
    if (this.#palette) {
      return this.#palette;
    }
    const panel = document.createXULElement("panel");
    panel.id = "jessnix-palette";
    panel.setAttribute("noautofocus", "true");
    panel.setAttribute("consumeoutsideclicks", "true");
    panel.setAttribute("level", "parent");
    const box = this.#el("div", "jessnix-palette-box");
    const input = this.#el("input", "jessnix-palette-input");
    input.type = "text";
    input.placeholder = "Search tabs, bookmarks, history, settings and actions";
    input.addEventListener("input", () => this.#search(input.value));
    const list = this.#el("div", "jessnix-palette-list");
    box.append(input, list);
    panel.append(box);
    panel.addEventListener("popupshown", () => input.focus());
    (document.getElementById("mainPopupSet") || document.documentElement).appendChild(panel);
    this.#palette = panel;
    return panel;
  }

  get isPaletteOpen() {
    return this.#palette?.state === "open" || this.#palette?.state === "showing";
  }

  togglePalette() {
    const panel = this.#ensurePalette();
    if (this.isPaletteOpen) {
      this.closePalette();
      return;
    }
    const input = panel.querySelector("input");
    input.value = "";
    this.#search("");
    // Centred near the top of the window.
    const width = Math.min(640, window.innerWidth - 32);
    const x = window.mozInnerScreenX + (window.innerWidth - width) / 2;
    const y = window.mozInnerScreenY + window.innerHeight * 0.12;
    panel.querySelector(".jessnix-palette-box").style.width = `${width}px`;
    panel.openPopupAtScreen(x, y, false);
  }

  closePalette() {
    if (this.isPaletteOpen) {
      this.#palette.hidePopup();
    }
  }

  #onPaletteKey(event) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        this.closePalette();
        break;
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (this.#results.length) {
          this.#selected =
            (this.#selected + (event.key === "ArrowDown" ? 1 : -1) + this.#results.length) %
            this.#results.length;
          this.#renderResults();
        }
        break;
      case "Enter":
        event.preventDefault();
        this.#run(this.#results[this.#selected]);
        break;
    }
  }

  // Every action the palette offers.
  get actions() {
    const top = Services.prefs.getBoolPref("jessnix.tabs.top", false);
    const game = Services.prefs.getBoolPref(PREF_GAME_MODE, false);
    return [
      ["New tab", () => BrowserCommands.openTab()],
      ["New window", () => OpenBrowserWindow()],
      ["New private window", () => OpenBrowserWindow({ private: true })],
      ["New throwaway tab", () => this.openThrowaway("about:newtab")],
      ["Close tab", () => gBrowser.removeTab(gBrowser.selectedTab)],
      ["Reopen closed tab", () => SessionWindowUI.undoCloseTab(window)],
      ["Reload page", () => BrowserCommands.reload()],
      [top ? "Tabs in a sidebar" : "Tabs on top", () => Services.prefs.setBoolPref("jessnix.tabs.top", !top)],
      ["Compact mode: switch", () => gZenCompactModeManager.toggle?.() ?? (gZenCompactModeManager.preference = !gZenCompactModeManager.preference)],
      [game ? "Game mode: turn off" : "Game mode: turn on", () => this.setGameMode(!game)],
      ["Dark mode for this site: switch", () => window.gJessnixSiteTools?.toggleSiteDark()],
      ["Style this site", () => window.gJessnixSiteTools?.styleSite()],
      ["Notes for this site", () => this.toggleNotes()],
      ["Take a screenshot", () => document.getElementById("Browser:Screenshot")?.doCommand()],
      ["Switch text direction (right-to-left / left-to-right)", () => goDoCommand("cmd_switchTextDirection")],
      ["Browse Together", () => window.gJessnixTogether?.togglePanel()],
      ["Undo the last look change", () => lazy.JessnixLooks.undo()],
      ["Zoom in", () => FullZoom.enlarge()],
      ["Zoom out", () => FullZoom.reduce()],
      ["Reset zoom", () => FullZoom.reset()],
      ["Bookmark this page", () => PlacesCommandHook.bookmarkPage()],
      ["Full screen", () => BrowserCommands.fullScreen()],
    ].map(([title, run]) => ({ kind: "Action", title, run }));
  }

  async #search(text) {
    const id = ++this.#queryId;
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    const results = [];
    const add = (kind, title, detail, run) => results.push({ kind, title, detail, run });

    for (const action of this.actions) {
      if (matches(action.title, words)) {
        results.push(action);
      }
    }
    for (const tab of gBrowser.tabs) {
      if (tab.hidden && !tab.hasAttribute("zen-workspace-id")) {
        continue;
      }
      const url = tab.linkedBrowser?.currentURI?.spec || "";
      if (words.length && matches(`${tab.label} ${url}`, words)) {
        add("Tab", tab.label, url, () => {
          if (tab.getAttribute("zen-workspace-id") && tab.getAttribute("zen-workspace-id") !== gZenWorkspaces.activeWorkspace) {
            gZenWorkspaces.changeWorkspaceWithID(tab.getAttribute("zen-workspace-id")).then(() => (gBrowser.selectedTab = tab));
          } else {
            gBrowser.selectedTab = tab;
          }
        });
      }
    }
    for (const [title, url] of SETTINGS_PAGES) {
      if (matches(title, words)) {
        add("Settings", title, url, () => switchToTabHavingURI(url, true));
      }
    }
    for (const look of await lazy.JessnixLooks.list()) {
      if (matches(`look ${look.name}`, words)) {
        add("Look", `Use the look “${look.name}”`, "", () => lazy.JessnixLooks.applySaved(look.name));
      }
    }
    if (words.length) {
      try {
        const bookmarks = await lazy.PlacesUtils.bookmarks.search(text.trim());
        for (const bookmark of bookmarks.filter(b => b.url).slice(0, 6)) {
          add("Bookmark", bookmark.title || bookmark.url.href, bookmark.url.href, () => openTrustedLinkIn(bookmark.url.href, "current"));
        }
      } catch {}
      for (const entry of this.#history(text.trim())) {
        add("History", entry.title || entry.url, entry.url, () => openTrustedLinkIn(entry.url, "current"));
      }
    }
    if (id !== this.#queryId) {
      return;
    }
    this.#results = results.slice(0, words.length ? 40 : MAX_RESULTS);
    this.#selected = 0;
    this.#renderResults();
  }

  #history(text) {
    const service = Cc["@mozilla.org/browser/nav-history-service;1"].getService(Ci.nsINavHistoryService);
    const query = service.getNewQuery();
    query.searchTerms = text;
    const options = service.getNewQueryOptions();
    options.maxResults = 6;
    options.sortingMode = options.SORT_BY_FRECENCY_DESCENDING;
    const root = service.executeQuery(query, options).root;
    const entries = [];
    root.containerOpen = true;
    try {
      for (let i = 0; i < root.childCount; i++) {
        const node = root.getChild(i);
        entries.push({ url: node.uri, title: node.title });
      }
    } finally {
      root.containerOpen = false;
    }
    return entries;
  }

  #renderResults() {
    const list = this.#palette.querySelector(".jessnix-palette-list");
    list.replaceChildren();
    if (!this.#results.length) {
      list.append(this.#el("div", "jessnix-palette-empty", "Nothing found"));
      return;
    }
    this.#results.forEach((result, index) => {
      const row = this.#el("div", "jessnix-palette-row");
      row.toggleAttribute("selected", index === this.#selected);
      row.append(this.#el("span", "jessnix-palette-kind", result.kind));
      const text = this.#el("span", "jessnix-palette-text");
      text.append(this.#el("span", "jessnix-palette-title", result.title));
      if (result.detail) {
        text.append(this.#el("span", "jessnix-palette-detail", result.detail));
      }
      row.append(text);
      row.addEventListener("mousedown", event => {
        event.preventDefault();
        this.#run(result);
      });
      list.append(row);
      if (index === this.#selected) {
        row.scrollIntoView({ block: "nearest" });
      }
    });
  }

  #run(result) {
    if (!result) {
      return;
    }
    this.closePalette();
    try {
      result.run();
    } catch (e) {
      console.error("Command palette:", e);
    }
  }

  // ---- Game mode -----------------------------------------------------------

  setGameMode(on) {
    Services.prefs.setBoolPref(PREF_GAME_MODE, on);
    if (!on) {
      this.#gameModeOff();
    }
  }

  async #gameModeOn() {
    for (const tab of gBrowser.tabs) {
      if (tab === gBrowser.selectedTab || tab.pinned) {
        continue;
      }
      const browser = tab.linkedBrowser;
      try {
        browser.pauseMedia?.();
      } catch {}
      if (!tab.soundPlaying && browser.isConnected) {
        try {
          gBrowser.discardBrowser(tab);
        } catch {}
      }
    }
    if (!Services.prefs.prefHasUserValue(PREF_GAME_COMPACT_SAVED)) {
      Services.prefs.setBoolPref(PREF_GAME_COMPACT_SAVED, !!gZenCompactModeManager.preference);
    }
    if (!gZenCompactModeManager.preference) {
      gZenCompactModeManager.preference = true;
    }
    Cc["@mozilla.org/memory-reporter-manager;1"]
      .getService(Ci.nsIMemoryReporterManager)
      .minimizeMemoryUsage(() => {});
  }

  #gameModeOff() {
    if (Services.prefs.prefHasUserValue(PREF_GAME_COMPACT_SAVED)) {
      const was = Services.prefs.getBoolPref(PREF_GAME_COMPACT_SAVED);
      Services.prefs.clearUserPref(PREF_GAME_COMPACT_SAVED);
      if (gZenCompactModeManager.preference !== was) {
        gZenCompactModeManager.preference = was;
      }
    }
  }

  // ---- Throwaway tabs --------------------------------------------------------

  // Opens url in a new container of its own; the container and everything the
  // site stored in it are deleted when its last tab closes.
  openThrowaway(url) {
    const identity = lazy.ContextualIdentityService.create(`${THROWAWAY_NAME} ${new Date().toLocaleTimeString()}`, "fence", "orange");
    this.#throwawayIds.add(identity.userContextId);
    const tab = gBrowser.addTab(url, {
      userContextId: identity.userContextId,
      triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({ userContextId: identity.userContextId }),
    });
    tab.setAttribute("jessnix-throwaway", "true");
    gBrowser.selectedTab = tab;
    return tab;
  }

  #onTabClose(event) {
    const id = event.target.userContextId;
    if (!id || !this.#throwawayIds.has(id)) {
      return;
    }
    // Wait until the tab is gone, then wipe if it was the last one.
    setTimeout(() => {
      const stillOpen = gBrowser.tabs.some(tab => tab.userContextId === id);
      if (!stillOpen) {
        this.#wipeThrowaway(id);
      }
    }, 500);
  }

  #wipeThrowaway(userContextId) {
    this.#throwawayIds.delete(userContextId);
    Services.clearData.deleteDataFromOriginAttributesPattern({ userContextId });
    lazy.ContextualIdentityService.remove(userContextId);
  }

  #addLinkMenu() {
    const menu = document.getElementById("contentAreaContextMenu");
    if (!menu || document.getElementById("jessnix-open-throwaway")) {
      return;
    }
    const item = document.createXULElement("menuitem");
    item.id = "jessnix-open-throwaway";
    item.setAttribute("label", "Open link in a throwaway tab");
    item.addEventListener("command", () => {
      const url = gContextMenu?.linkURL;
      if (url && /^https?:\/\//i.test(url)) {
        this.openThrowaway(url);
      }
    });
    const after = document.getElementById("context-openlinkprivate") || document.getElementById("context-openlinkintab");
    after ? after.after(item) : menu.prepend(item);
    menu.addEventListener("popupshowing", event => {
      if (event.target === menu) {
        item.hidden = !gContextMenu?.onLink;
      }
    });
  }

  // ---- Site notes -------------------------------------------------------------

  get #siteKey() {
    try {
      return gBrowser.currentURI.host || gBrowser.currentURI.spec;
    } catch {
      return "";
    }
  }

  toggleNotes() {
    if (this.#notesPanel && !this.#notesPanel.hidden) {
      this.#notesPanel.hidden = true;
      return;
    }
    if (!this.#notesPanel) {
      const panel = this.#el("div");
      panel.id = "jessnix-notes";
      const bar = this.#el("div", "jessnix-notes-bar");
      const title = this.#el("span", "jessnix-notes-title");
      const close = this.#el("button", "jessnix-notes-close", "✕");
      close.addEventListener("click", () => (panel.hidden = true));
      bar.append(title, close);
      const area = this.#el("textarea", "jessnix-notes-text");
      area.placeholder = "Notes for this site, kept on this computer";
      area.maxLength = 20000;
      let timer = null;
      area.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => this.#saveNote(panel.dataset.site, area.value), 300);
      });
      panel.append(bar, area);
      document.documentElement.appendChild(panel);
      this.#notesPanel = panel;
      gBrowser.tabContainer.addEventListener("TabSelect", () => this.#loadNote());
      gBrowser.addTabsProgressListener({
        onLocationChange: (browser, webProgress) => {
          if (webProgress.isTopLevel && browser === gBrowser.selectedBrowser) {
            this.#loadNote();
          }
        },
      });
    }
    this.#notesPanel.hidden = false;
    this.#loadNote();
    this.#notesPanel.querySelector("textarea").focus();
  }

  #loadNote() {
    const panel = this.#notesPanel;
    if (!panel || panel.hidden) {
      return;
    }
    const site = this.#siteKey;
    panel.dataset.site = site;
    panel.querySelector(".jessnix-notes-title").textContent = `Notes: ${site || "this page"}`;
    panel.querySelector("textarea").value = readNotes()[site] || "";
  }

  #saveNote(site, text) {
    if (!site) {
      return;
    }
    const notes = readNotes();
    if (text.trim()) {
      notes[site] = text.slice(0, 20000);
    } else {
      delete notes[site];
    }
    Services.prefs.setStringPref(PREF_NOTES, JSON.stringify(notes));
  }
}

window.gJessnixPower = new nsJessnixPower();
window.delayedStartupPromise.then(() =>
  gZenWorkspaces.promiseInitialized.then(() => window.gJessnixPower.init())
);
