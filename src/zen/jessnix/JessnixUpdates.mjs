// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Updates from GitHub Releases. Firefox's own updater is off in this build
// (--disable-updater, so Zen's server can't replace it); instead, once a day
// one window asks GitHub for the latest release of UPDATE_REPO. When it's newer
// than this browser, a bar offers to download its installer and run it (asking
// first), or to read the release notes. Only the request to api.github.com is
// made; nothing is sent.
//
// What may run is kept narrow: the repo is fixed in the code (no pref or
// settings backup can point it elsewhere), the installer must come from that
// repo's own release downloads, and the downloaded file's SHA-256 must match
// the checksum GitHub recorded when the release was uploaded (and the one in the
// release notes, when they give one). Anything else is not run.

const PREF_ENABLED = "jessnix.update.check";
// Where this browser's releases are published. A fork that publishes its own
// builds changes this line.
const UPDATE_REPO = "NamiSwan222/Custom-Browser";
const DOWNLOAD_PREFIX = `https://github.com/${UPDATE_REPO}/releases/download/`;
const PREF_LAST = "jessnix.update.last-check";
const PREF_SKIP = "jessnix.update.skip-version";
const DAY = 24 * 60 * 60 * 1000;
const BAR_ID = "jessnix-update";
const PREF_SEARCH_SET = "jessnix.search.default-set";

// "v0.1.10" -> [0, 1, 10]
function parts(version) {
  return String(version || "")
    .replace(/^v/i, "")
    .split(/[.-]/)
    .map(n => parseInt(n, 10) || 0);
}

export function isNewer(candidate, current) {
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) {
      return (a[i] || 0) > (b[i] || 0);
    }
  }
  return false;
}

class nsJessnixUpdates {
  init() {
    if ([...Services.wm.getEnumerator("navigator:browser")][0] !== window) {
      return;
    }
    this.#searchDefaultOnce();
    setTimeout(() => this.check().catch(e => console.warn("Update check:", e)), 90 * 1000);
  }

  // PLAN.md Phase 2: DuckDuckGo as the default search, set once on a profile's
  // first run (the search service keeps no default of its own to configure).
  // Choosing another engine afterwards sticks.
  async #searchDefaultOnce() {
    if (Services.prefs.getBoolPref(PREF_SEARCH_SET, false)) {
      return;
    }
    try {
      const { SearchService } = ChromeUtils.importESModule(
        "moz-src:///toolkit/components/search/SearchService.sys.mjs"
      );
      await SearchService.init();
      const engine = SearchService.getEngineByName("DuckDuckGo");
      if (engine) {
        await SearchService.setDefault(engine, SearchService.CHANGE_REASON.USER);
        await SearchService.setDefaultPrivate?.(engine, SearchService.CHANGE_REASON.USER_PRIVATE_SPLIT);
      }
      Services.prefs.setBoolPref(PREF_SEARCH_SET, true);
    } catch (e) {
      console.warn("Default search:", e);
    }
  }

  get currentVersion() {
    return AppConstants.MOZ_APP_VERSION_DISPLAY || Services.appinfo.version;
  }

  // The latest release: { version, page, installer: { name, url, size } | null }.
  async latest() {
    const response = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      return null;
    }
    const release = await response.json();
    const asset = (release.assets || []).find(a => /-setup\.exe$/i.test(a.name || ""));
    // GitHub's checksum of the uploaded file, and the one the release notes
    // print ("SHA-256 of the installer: `...`"), if any.
    const digest = /^sha256:([0-9a-f]{64})$/i.exec(String(asset?.digest || ""))?.[1]?.toLowerCase() || null;
    const noted = /SHA-256[^`\n]*`([0-9a-f]{64})`/i.exec(String(release.body || ""))?.[1]?.toLowerCase() || null;
    return {
      version: String(release.tag_name || "").replace(/^v/i, ""),
      page: String(release.html_url || ""),
      installer: asset
        ? { name: asset.name, url: asset.browser_download_url, size: asset.size, sha256: digest, notedSha256: noted }
        : null,
    };
  }

  async check({ force = false } = {}) {
    if (!Services.prefs.getBoolPref(PREF_ENABLED, true)) {
      return null;
    }
    // Seconds (a pref int can't hold milliseconds).
    const last = Services.prefs.getIntPref(PREF_LAST, 0) * 1000;
    if (!force && Date.now() - last < DAY) {
      return null;
    }
    Services.prefs.setIntPref(PREF_LAST, Math.floor(Date.now() / 1000));
    const release = await this.latest();
    if (!release?.version || !isNewer(release.version, this.currentVersion)) {
      return release;
    }
    if (!force && Services.prefs.getStringPref(PREF_SKIP, "") === release.version) {
      return release;
    }
    this.#offer(release);
    return release;
  }

  #offer(release) {
    const box = gNotificationBox;
    box.getNotificationWithValue(BAR_ID)?.close();
    const buttons = [];
    if (release.installer && AppConstants.platform === "win") {
      buttons.push({
        label: "Download and install",
        accessKey: "D",
        callback: () => {
          this.install(release);
          return false;
        },
      });
    }
    if (/^https:\/\/github\.com\//.test(release.page)) {
      buttons.push({
        label: "What's new",
        accessKey: "W",
        callback: () => {
          openTrustedLinkIn(release.page, "tab");
          return true;
        },
      });
    }
    buttons.push({
      label: "Skip this version",
      callback: () => {
        Services.prefs.setStringPref(PREF_SKIP, release.version);
      },
    });
    box.appendNotification(
      BAR_ID,
      {
        label: `Custom Browser ${release.version} is out (you have ${this.currentVersion}).`,
        priority: box.PRIORITY_INFO_HIGH,
      },
      buttons
    );
  }

  async install(release) {
    const { installer } = release;
    if (!installer || !installer.url.startsWith(DOWNLOAD_PREFIX) || !/^[\w.-]+$/.test(installer.name)) {
      return;
    }
    if (!installer.sha256 || (installer.notedSha256 && installer.notedSha256 !== installer.sha256)) {
      Services.prompt.alert(
        window,
        "Update",
        "This update can't be checked, so it won't be installed from here. Download it yourself from the release page."
      );
      return;
    }
    const megabytes = Math.round((installer.size || 0) / (1024 * 1024));
    const ok = Services.prompt.confirm(
      window,
      "Install the update?",
      `Download ${installer.name} (${megabytes} MB) from github.com/${UPDATE_REPO} and run it?\n\n` +
        "The installer replaces this version; your profile (logins, bookmarks, settings) is kept. " +
        "Close Custom Browser when the installer asks."
    );
    if (!ok) {
      return;
    }
    const response = await fetch(installer.url, { credentials: "omit" });
    if (!response.ok) {
      Services.prompt.alert(window, "Update", `The download failed (${response.status}).`);
      return;
    }
    // Redirects may only go to GitHub's own download servers.
    if (!/^https:\/\/([\w-]+\.)*(github\.com|githubusercontent\.com)\//.test(response.url)) {
      Services.prompt.alert(window, "Update", "The download came from an unexpected place, so it wasn't run.");
      return;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== installer.sha256) {
      Services.prompt.alert(window, "Update", "The downloaded installer doesn't match the published one, so it wasn't run.");
      return;
    }
    const folder = PathUtils.join(PathUtils.tempDir, "custom-browser-update");
    await IOUtils.makeDirectory(folder, { ignoreExisting: true });
    const path = PathUtils.join(folder, installer.name);
    await IOUtils.write(path, bytes);
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(path);
    const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    process.init(file);
    process.runw(false, [], 0);
  }
}

window.gJessnixUpdates = new nsJessnixUpdates();
window.delayedStartupPromise.then(() => window.gJessnixUpdates.init());
