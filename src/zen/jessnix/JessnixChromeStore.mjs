// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Chrome Web Store pages, in each browser window: on an extension's page a bar
// offers "Add to Custom Browser". Adding converts the extension
// (JessnixChromeExtensions.sys.mjs), shows what will and won't work, asks once
// to allow unsigned add-ons (Mozilla can't sign converted extensions), then
// installs through Firefox's own permission prompt. Converted extensions are
// checked for updates once a day.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  JessnixChromeExtensions: "chrome://browser/content/zen-components/JessnixChromeExtensions.sys.mjs",
});

const PREF_ENABLED = "jessnix.chrome-extensions.enabled";
const PREF_SIGNING = "xpinstall.signatures.required";
const BAR_ID = "jessnix-chrome-store";

// Popular extensions known to work once converted (most also have a Firefox
// version on addons.mozilla.org, which is the better choice when it exists).
const KNOWN_GOOD = {
  eimadpbcbfnmbkopoojfekhnkhdbieeh: "Dark Reader",
  gebbhagfogifgggkldgodflihgfeippi: "Return YouTube Dislike",
  mnjggcdmjocbbbhaepdhchncahnbgone: "SponsorBlock",
  nngceckbapebfimnlniiiahkandclblb: "Bitwarden",
  aapbdbdomjkkjkaonfhkkikfgjllcleb: "Google Translate",
  hdokiejnpimakedhajhdlcegeplioahd: "LastPass",
};

class nsJessnixChromeStore {
  init() {
    gBrowser.addTabsProgressListener({
      onLocationChange: (browser, webProgress, _request, location) => {
        if (webProgress.isTopLevel && browser === gBrowser.selectedBrowser) {
          this.#update(location?.spec);
        }
      },
    });
    gBrowser.tabContainer.addEventListener("TabSelect", () => this.#update(gBrowser.currentURI?.spec));
    // One window does the daily update check.
    if ([...Services.wm.getEnumerator("navigator:browser")][0] === window) {
      setTimeout(() => this.checkUpdates(), 60 * 1000);
    }
  }

  get #box() {
    return gBrowser.getNotificationBox(gBrowser.selectedBrowser);
  }

  #update(url) {
    const box = this.#box;
    const existing = box.getNotificationWithValue(BAR_ID);
    const id = lazy.JessnixChromeExtensions.webStoreId(url);
    if (!id || !Services.prefs.getBoolPref(PREF_ENABLED, true)) {
      existing?.close();
      return;
    }
    if (existing?.dataset?.extensionId === id) {
      return;
    }
    existing?.close();
    box
      .appendNotification(
        BAR_ID,
        {
          label: "This is a Chrome extension. Custom Browser can convert it and add it.",
          priority: box.PRIORITY_INFO_HIGH,
        },
        [
          {
            label: "Add to Custom Browser",
            accessKey: "A",
            callback: () => {
              this.add(id);
              return false;
            },
          },
        ]
      )
      .then(bar => {
        if (bar) {
          bar.dataset.extensionId = id;
        }
      });
  }

  #say(message, priority = "PRIORITY_INFO_MEDIUM") {
    const box = this.#box;
    box.getNotificationWithValue(BAR_ID)?.close();
    box.appendNotification(BAR_ID, { label: message, priority: box[priority] }, []);
  }

  async add(id) {
    this.#say("Downloading and converting the extension…");
    let prepared;
    try {
      prepared = await lazy.JessnixChromeExtensions.prepare(id);
    } catch (e) {
      this.#say(`Couldn't add it: ${e.message || e}`, "PRIORITY_WARNING_MEDIUM");
      return;
    }
    const { report, name } = prepared;
    const verdictText = {
      works: "It should work.",
      partly: "It should mostly work, but not everything:",
      wont: "It won't work in Custom Browser:",
    }[report.verdict];
    const lines = [`${name}`, "", verdictText, ...report.notes.map(n => `• ${n}`)];
    if (KNOWN_GOOD[id]) {
      lines.push("", `${KNOWN_GOOD[id]} is known to work once converted.`);
    }
    lines.push(
      "",
      "Converted extensions aren't reviewed by Mozilla, so only add ones you trust. It will be marked “From the Chrome Web Store” in Add-ons."
    );
    const needsUnsigned = Services.prefs.getBoolPref(PREF_SIGNING, true);
    if (needsUnsigned) {
      lines.push(
        "",
        "To add it, Custom Browser has to allow add-ons that Mozilla hasn't signed. Firefox still asks before installing any add-on."
      );
    }
    if (report.verdict === "wont") {
      Services.prompt.alert(window, "Chrome extension", lines.join("\n"));
      this.#box.getNotificationWithValue(BAR_ID)?.close();
      return;
    }
    const ok = Services.prompt.confirm(window, "Add this Chrome extension?", lines.join("\n"));
    if (!ok) {
      this.#box.getNotificationWithValue(BAR_ID)?.close();
      return;
    }
    if (needsUnsigned) {
      Services.prefs.setBoolPref(PREF_SIGNING, false);
    }
    try {
      const install = await lazy.AddonManager.getInstallForFile(prepared.file);
      install.addListener({
        onInstallEnded: () => {
          lazy.JessnixChromeExtensions.remember(id, prepared.version);
          this.#say(`${name} was added.`);
        },
        onInstallFailed: () => this.#say(`Couldn't add ${name}.`, "PRIORITY_WARNING_MEDIUM"),
      });
      // Firefox's own prompt, listing what the extension may do.
      lazy.AddonManager.installAddonFromAOM(gBrowser.selectedBrowser, gBrowser.currentURI, install);
      this.#box.getNotificationWithValue(BAR_ID)?.close();
    } catch (e) {
      this.#say(`Couldn't add it: ${e.message || e}`, "PRIORITY_WARNING_MEDIUM");
    }
  }

  async checkUpdates(options) {
    try {
      const updated = await lazy.JessnixChromeExtensions.checkForUpdates(options);
      return updated;
    } catch (e) {
      console.warn("Chrome extension updates:", e);
      return [];
    }
  }
}

window.gJessnixChromeStore = new nsJessnixChromeStore();
window.delayedStartupPromise.then(() => window.gJessnixChromeStore.init());
