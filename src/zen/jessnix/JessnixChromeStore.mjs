// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Chrome Web Store pages, in each browser window: on an extension's page the
// store's own button reads "Add to Custom Browser" (JessnixChromeStoreChild
// .sys.mjs); if the store's page has changed so that button can't be found,
// a bar offers it instead. Adding converts the extension
// (JessnixChromeExtensions.sys.mjs), shows what will and won't work, asks to
// allow unsigned add-ons while converted extensions are installed (Mozilla
// can't sign them; it switches back when the last one is removed), then
// installs through Firefox's own permission prompt. Converted extensions are
// checked for updates once a day; one that wants more access waits for a yes.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  JessnixChromeExtensions: "chrome://browser/content/zen-components/JessnixChromeExtensions.sys.mjs",
});

const PREF_ENABLED = "jessnix.chrome-extensions.enabled";
const PREF_SIGNING = "xpinstall.signatures.required";
const BAR_ID = "jessnix-chrome-store";
const ACTOR = "JessnixChromeStore";
// How long the page's own button has to appear before the bar is shown.
const BAR_DELAY_MS = 4000;

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
  // Browsers whose store page shows our button.
  #pageButton = new WeakSet();
  #barTimer = null;

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
    const browser = gBrowser.selectedBrowser;
    try {
      browser.browsingContext?.currentWindowGlobal?.getActor(ACTOR)?.sendAsyncMessage("start");
    } catch {
      // Not a store page the actor runs on (an error page, say).
    }
    if (existing?.dataset?.extensionId === id) {
      return;
    }
    existing?.close();
    clearTimeout(this.#barTimer);
    this.#barTimer = setTimeout(() => {
      if (gBrowser.selectedBrowser === browser && !this.#pageButton.has(browser) &&
          lazy.JessnixChromeExtensions.webStoreId(browser.currentURI?.spec) === id) {
        this.#showBar(id);
      }
    }, BAR_DELAY_MS);
  }

  pageButtonReady(browser) {
    if (!browser) {
      return;
    }
    this.#pageButton.add(browser);
    if (browser === gBrowser.selectedBrowser) {
      const bar = this.#box.getNotificationWithValue(BAR_ID);
      if (bar?.dataset?.extensionId) {
        bar.close();
      }
    }
  }

  async #addon(id) {
    return lazy.AddonManager.getAddonByID(`${id}${lazy.JessnixChromeExtensions.ID_SUFFIX}`);
  }

  async sendState(actor, id, busy = false) {
    try {
      actor?.sendAsyncMessage("state", { installed: !!(await this.#addon(id)), busy });
    } catch {
      // The page went away.
    }
  }

  #showBar(id) {
    const box = this.#box;
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

  async add(id, actor = null) {
    if (actor) {
      this.sendState(actor, id, true);
    }
    try {
      await this.#add(id, actor);
    } catch (e) {
      this.#say(`Couldn't add it: ${e.message || e}`, "PRIORITY_WARNING_MEDIUM");
      this.sendState(actor, id);
    }
  }

  async remove(id, actor = null) {
    const addon = await this.#addon(id);
    if (addon && Services.prompt.confirm(window, "Remove extension", `Remove ${addon.name} from Custom Browser?`)) {
      await addon.uninstall();
    }
    this.sendState(actor, id);
  }

  async #add(id, actor) {
    const done = () => this.sendState(actor, id);
    this.#say("Downloading and converting the extension…");
    let prepared;
    try {
      prepared = await lazy.JessnixChromeExtensions.prepare(id);
    } catch (e) {
      this.#say(`Couldn't add it: ${e.message || e}`, "PRIORITY_WARNING_MEDIUM");
      done();
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
        "To add it, Custom Browser has to accept add-ons that Mozilla hasn't checked. While you have Chrome extensions, that is true for every add-on, so only install add-ons from places you trust. It switches back as soon as you remove your last Chrome extension."
      );
    }
    if (report.verdict === "wont") {
      Services.prompt.alert(window, "Chrome extension", lines.join("\n"));
      this.#box.getNotificationWithValue(BAR_ID)?.close();
      done();
      return;
    }
    const ok = Services.prompt.confirm(window, "Add this Chrome extension?", lines.join("\n"));
    if (!ok) {
      this.#box.getNotificationWithValue(BAR_ID)?.close();
      done();
      return;
    }
    if (needsUnsigned) {
      lazy.JessnixChromeExtensions.allowUnsigned();
    }
    try {
      const install = await lazy.AddonManager.getInstallForFile(prepared.file);
      install.addListener({
        onInstallEnded: () => {
          lazy.JessnixChromeExtensions.remember(id, prepared.version, prepared.manifest);
          this.#say(`${name} was added.`);
          done();
        },
        onInstallFailed: () => {
          this.#say(`Couldn't add ${name}.`, "PRIORITY_WARNING_MEDIUM");
          lazy.JessnixChromeExtensions.restoreSigning();
          done();
        },
        onInstallCancelled: () => {
          lazy.JessnixChromeExtensions.restoreSigning();
          done();
        },
      });
      // Firefox's own prompt, listing what the extension may do.
      lazy.AddonManager.installAddonFromAOM(gBrowser.selectedBrowser, gBrowser.currentURI, install);
      this.#box.getNotificationWithValue(BAR_ID)?.close();
    } catch (e) {
      this.#say(`Couldn't add it: ${e.message || e}`, "PRIORITY_WARNING_MEDIUM");
      done();
    }
  }

  async checkUpdates(options) {
    try {
      const result = await lazy.JessnixChromeExtensions.checkForUpdates(options);
      for (const item of result.needsApproval) {
        this.#askAboutUpdate(item);
      }
      return result.updated;
    } catch (e) {
      console.warn("Chrome extension updates:", e);
      return [];
    }
  }

  // An update that wants more than the installed version: a bar that says what,
  // and installs only through the normal add flow (with Firefox's prompt).
  #askAboutUpdate({ id, name, version, added }) {
    const box = this.#box;
    const what = added.length ? ` It asks for more access: ${added.slice(0, 5).join(", ")}${added.length > 5 ? ", …" : ""}.` : "";
    box.appendNotification(
      `${BAR_ID}-update-${id}`,
      {
        label: `${name} ${version} is available.${what} It won't be installed unless you agree.`,
        priority: box.PRIORITY_INFO_MEDIUM,
      },
      [
        {
          label: "Review and update",
          accessKey: "R",
          callback: () => {
            this.add(id);
            return false;
          },
        },
      ]
    );
  }
}

window.gJessnixChromeStore = new nsJessnixChromeStore();
window.delayedStartupPromise.then(() => window.gJessnixChromeStore.init());
