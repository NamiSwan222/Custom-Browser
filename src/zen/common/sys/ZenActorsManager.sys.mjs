// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
// Utility to register JSWindowActors

import { ActorManagerParent } from "resource://gre/modules/ActorManagerParent.sys.mjs";

/**
 * Fission-compatible JSProcess implementations.
 * Each actor options object takes the form of a ProcessActorOptions dictionary.
 * Detailed documentation of these options is in dom/docs/ipc/jsactors.rst,
 * available at https://firefox-source-docs.mozilla.org/dom/ipc/jsactors.html
 */
let JSPROCESSACTORS = {};

/**
 * Fission-compatible JSWindowActor implementations.
 * Detailed documentation of these options is in dom/docs/ipc/jsactors.rst,
 * available at https://firefox-source-docs.mozilla.org/dom/ipc/jsactors.html
 */
let JSWINDOWACTORS = {
  ZenModsMarketplace: {
    parent: {
      esModuleURI: "resource:///actors/ZenModsMarketplaceParent.sys.mjs",
    },
    child: {
      esModuleURI: "resource:///actors/ZenModsMarketplaceChild.sys.mjs",
      events: {
        DOMContentLoaded: {},
      },
    },
    safeForUntrustedWebProcess: true,
    matches: [
      ...Services.prefs.getStringPref("zen.injections.match-urls").split(","),
      "about:preferences",
    ],
  },
  ZenGlance: {
    parent: {
      esModuleURI: "resource:///actors/ZenGlanceParent.sys.mjs",
    },
    child: {
      esModuleURI: "resource:///actors/ZenGlanceChild.sys.mjs",
      events: {
        mousedown: {
          capture: true,
        },
        keydown: {
          capture: true,
        },
        click: {
          capture: true,
        },
      },
    },
    remoteTypes: ["web", "file"],
    safeForUntrustedWebProcess: true,
    enablePreference: "zen.glance.enabled",
  },
  ZenWindowDrag: {
    parent: {
      esModuleURI: "resource:///actors/ZenWindowDragParent.sys.mjs",
    },
    child: {
      esModuleURI: "resource:///actors/ZenWindowDragChild.sys.mjs",
      events: {
        mousedown: {
          mozSystemGroup: true,
        },
      },
    },
    messageManagerGroups: ["browsers"],
    remoteTypes: ["web", "file"],
    safeForUntrustedWebProcess: true,
    enablePreference: "zen.view.drag-window-from-content",
  },
};

// Custom Browser: Browse Together's page side (src/zen/custom/CustomTogether*.mjs).
// Registered here, at startup. The browser window starts it in each page while
// a Together session is on (custom.together.active), and the page side adds
// its own listeners then; what pages report is treated as untrusted.
JSWINDOWACTORS.CustomTogether = {
  parent: {
    esModuleURI: "chrome://browser/content/zen-components/CustomTogetherParent.sys.mjs",
  },
  child: {
    esModuleURI: "chrome://browser/content/zen-components/CustomTogetherChild.sys.mjs",
  },
  messageManagerGroups: ["browsers"],
  safeForUntrustedWebProcess: true,
  enablePreference: "custom.together.active",
};

// Custom Browser: Chrome Web Store pages (src/zen/custom/CustomChromeStore*.mjs):
// the store's "Add to Chrome" button becomes "Add to Custom Browser".
JSWINDOWACTORS.CustomChromeStore = {
  parent: {
    esModuleURI: "chrome://browser/content/zen-components/CustomChromeStoreParent.sys.mjs",
  },
  child: {
    esModuleURI: "chrome://browser/content/zen-components/CustomChromeStoreChild.sys.mjs",
    events: {
      DOMContentLoaded: {},
    },
  },
  matches: ["https://chromewebstore.google.com/*", "https://chrome.google.com/webstore/*"],
  messageManagerGroups: ["browsers"],
  safeForUntrustedWebProcess: true,
  enablePreference: "custom.chrome-extensions.enabled",
};

if (!Services.appinfo.inSafeMode) {
  JSWINDOWACTORS.ZenBoosts = {
    parent: {
      esModuleURI: "resource:///actors/ZenBoostsParent.sys.mjs",
    },
    child: {
      esModuleURI: "resource:///actors/ZenBoostsChild.sys.mjs",
    },
    safeForUntrustedWebProcess: true,
    remoteTypes: ["web", "file"],
    enablePreference: "zen.boosts.enabled",
  };
}

export let gZenActorsManager = {
  init() {
    ActorManagerParent.addJSProcessActors(JSPROCESSACTORS);
    ActorManagerParent.addJSWindowActors(JSWINDOWACTORS);
  },
};
