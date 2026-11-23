// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Custom Browser: tabs on top, as in Chrome, instead of Zen's sidebar
// (Settings > Look and Feel > Personalize > Layout > Tabs).
//
// Zen's sidebar is Firefox's own toolbar box (#navigator-toolbox) moved to the
// side, and the address bar already sits above the page when Zen's single
// toolbar is off. So this lays that box out as one row across the top
// (custom-top-tabs.css) and keeps the tab lists horizontal.
//
// Two things CSS cannot do, done here:
// - Firefox's built-in sheet forces a column on anything with orient="vertical"
//   or flex="1", and beats any stylesheet. Zen sets orient="vertical" on the tab
//   lists after every layout change, so this sets them back, watching for it.
//   Firefox's own tab code (drag and drop included) reads the same attribute.
// - Zen moves the window buttons (minimize, maximize, close) on every layout
//   change; they go at the end of the tab row instead.

const PREF_TOP = "custom.tabs.top";
// Zen settings that must be a given way while tabs are on top; each one the
// person had otherwise is remembered under custom.tabs.top.saved.<pref> and
// given back when tabs go back to the side.
const ZEN_PREFS_FOR_TOP = {
  // Single toolbar puts the address bar inside the sidebar; off, it sits above
  // the page.
  "zen.view.use-single-toolbar": false,
  // On, new tabs open at the start of the list (the top of the sidebar). Off,
  // at the end: on the right, as in Chrome.
  "zen.view.show-newtab-button-top": false,
  // On, + opens Zen's floating address bar and makes a tab only once
  // something is typed. Off, + opens a new tab at once, as in Chrome.
  "zen.urlbar.replace-newtab": false,
  // Collapsed, Zen shrinks the sidebar to icons, which squashes the tab row to
  // nothing. Kept expanded; a collapse chosen while tabs are on top is
  // remembered for the sidebar.
  "zen.view.sidebar-expanded": true,
  // Zen floats the address bar in the middle of the window while typing.
  // "default" keeps it in place with results dropping down below it, as in
  // Chrome.
  "zen.urlbar.behavior": "default",
};
const SAVED_PREFIX = "custom.tabs.top.saved.";

// The prefs above are booleans or strings.
function getPref(pref, fallback) {
  return typeof fallback === "string"
    ? Services.prefs.getStringPref(pref, fallback)
    : Services.prefs.getBoolPref(pref, fallback);
}

function setPref(pref, value) {
  if (typeof value === "string") {
    Services.prefs.setStringPref(pref, value);
  } else {
    Services.prefs.setBoolPref(pref, value);
  }
}
// Compact mode with tabs on top is an auto-hiding tab row (custom-top-tabs.css).
// An earlier version held compact mode off instead and saved the person's choice
// here; it is still given back when tabs go to the side.
const SAVED_COMPACT = SAVED_PREFIX + "compact-mode";
const MENU_ITEM_IDS = ["custom-tabs-top-toolbar-item", "custom-tabs-top-tab-item"];

const ROOT_ATTRIBUTE = "custom-top-tabs";
// Marks a flex="1" this module removed, so it can be put back.
const REMOVED_FLEX = "custom-removed-flex";

class nsCustomTopTabs {
  #isRunning = false;
  #mutationObserver = null;
  #isApplyQueued = false;

  init() {
    if (this.#isRunning) {
      return;
    }
    this.#isRunning = true;
    // The Zen prefs are watched too: Zen's own buttons and menus can change
    // them while tabs are on top.
    const prefs = [PREF_TOP, ...Object.keys(ZEN_PREFS_FOR_TOP)];
    for (const pref of prefs) {
      Services.prefs.addObserver(pref, this);
    }
    window.addEventListener(
      "unload",
      () => {
        for (const pref of prefs) {
          Services.prefs.removeObserver(pref, this);
        }
      },
      { once: true }
    );
    // Zen ends every layout update by firing "resize" on the window.
    window.addEventListener("resize", () => this.#queueApply());
    this.#addMenuItems();
    this.#update();
  }

  // "Tabs on top" in the right-click menus of the tab row and of a tab.
  #addMenuItems() {
    const menus = [
      [document.getElementById("toolbar-context-menu"), MENU_ITEM_IDS[0]],
      [document.getElementById("tabContextMenu"), MENU_ITEM_IDS[1]],
    ];
    for (const [menu, id] of menus) {
      if (!menu || document.getElementById(id)) {
        continue;
      }
      const separator = document.createXULElement("menuseparator");
      const item = document.createXULElement("menuitem");
      item.id = id;
      item.setAttribute("type", "checkbox");
      item.setAttribute("label", "Tabs on top");
      item.setAttribute("accesskey", "T");
      item.addEventListener("command", () =>
        Services.prefs.setBoolPref(PREF_TOP, item.hasAttribute("checked") || item.getAttribute("checked") === "true")
      );
      menu.addEventListener("popupshowing", event => {
        if (event.target === menu) {
          item.toggleAttribute("checked", this.isOn);
        }
      });
      menu.append(separator, item);
    }
  }

  get isOn() {
    return Services.prefs.getBoolPref(PREF_TOP, false);
  }

  observe(_subject, _topic, pref) {
    if (pref === PREF_TOP) {
      this.#update();
    } else if (this.isOn) {
      this.#holdZenPrefs();
    }
  }

  // Sets each Zen pref the way tabs on top need it, remembering the person's
  // own choice to give back later. Setting one calls observe() again, which
  // then finds nothing to change.
  #holdZenPrefs() {
    for (const [pref, value] of Object.entries(ZEN_PREFS_FOR_TOP)) {
      const current = getPref(pref, value);
      if (current !== value) {
        setPref(SAVED_PREFIX + pref, current);
        setPref(pref, value);
      }
    }
  }

  #update() {
    const root = document.documentElement;
    if (this.isOn) {
      this.#holdZenPrefs();
      root.setAttribute(ROOT_ATTRIBUTE, "true");
      this.#watch();
      this.#apply();
    } else {
      if (!root.hasAttribute(ROOT_ATTRIBUTE)) {
        return;
      }
      root.removeAttribute(ROOT_ATTRIBUTE);
      this.#mutationObserver?.disconnect();
      this.#mutationObserver = null;
      this.#restore();
      if (Services.prefs.getBoolPref(SAVED_COMPACT, false)) {
        Services.prefs.clearUserPref(SAVED_COMPACT);
        gZenCompactModeManager.preference = true;
      }
      for (const pref of Object.keys(ZEN_PREFS_FOR_TOP)) {
        const saved = SAVED_PREFIX + pref;
        if (Services.prefs.prefHasUserValue(saved)) {
          setPref(pref, getPref(saved, ZEN_PREFS_FOR_TOP[pref]));
          Services.prefs.clearUserPref(saved);
        }
      }
      // Zen puts the tab lists and window buttons back where it wants them.
      gZenVerticalTabsManager._updateEvent();
    }
  }

  // The tab lists, including each space's own list (spaces come and go).
  get #tabLists() {
    const tabs = gBrowser.tabContainer;
    // Zen points tabs.arrowScrollbox at the current space's list, so the outer
    // one is looked up by id.
    return [
      ...new Set([
        tabs,
        document.getElementById("tabbrowser-arrowscrollbox"),
        tabs.arrowScrollbox,
        ...tabs.querySelectorAll(".workspace-arrowscrollbox"),
      ]),
    ].filter(Boolean);
  }

  get #flexElements() {
    return [
      document.getElementById("zen-sidebar-top-buttons"),
      ...document.querySelectorAll(".zen-essentials-container"),
    ].filter(Boolean);
  }

  #watch() {
    if (this.#mutationObserver) {
      return;
    }
    this.#mutationObserver = new MutationObserver(() => this.#queueApply());
    this.#mutationObserver.observe(gBrowser.tabContainer, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["orient", "flex"],
    });
  }

  #queueApply() {
    if (!this.isOn || this.#isApplyQueued) {
      return;
    }
    this.#isApplyQueued = true;
    requestAnimationFrame(() => {
      this.#isApplyQueued = false;
      if (this.isOn) {
        this.#apply();
      }
    });
  }

  #setOrient(element, orient) {
    if (element && element.getAttribute("orient") !== orient) {
      element.setAttribute("orient", orient);
    }
    const inner = element?.scrollbox;
    if (inner && inner.getAttribute("orient") !== orient) {
      inner.setAttribute("orient", orient);
    }
  }

  #apply() {
    for (const list of this.#tabLists) {
      this.#setOrient(list, "horizontal");
    }
    for (const element of this.#flexElements) {
      if (element.getAttribute("flex") === "1") {
        element.removeAttribute("flex");
        element.setAttribute(REMOVED_FLEX, "true");
      }
    }
    // Window buttons at the end of the tab row, as in Chrome.
    const tabsToolbar = document.getElementById("TabsToolbar");
    const windowButtons = gZenVerticalTabsManager.actualWindowButtons;
    if (tabsToolbar && windowButtons && windowButtons.parentNode !== tabsToolbar) {
      tabsToolbar.append(windowButtons);
    }
  }

  #restore() {
    for (const list of this.#tabLists) {
      this.#setOrient(list, "vertical");
    }
    for (const element of document.querySelectorAll(`[${REMOVED_FLEX}]`)) {
      element.removeAttribute(REMOVED_FLEX);
      element.setAttribute("flex", "1");
    }
  }
}

window.gCustomTopTabs = new nsCustomTopTabs();
window.delayedStartupPromise.then(() =>
  gZenWorkspaces.promiseInitialized.then(() => window.gCustomTopTabs.init())
);
