// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Updates from GitHub Releases. Firefox's own updater is off in this build
// (--disable-updater, so Zen's server can't replace it); instead, once a day
// one window asks GitHub for the latest release of the repo in
// jessnix.update.repo. When it's newer than this browser, a bar offers to
// download its installer and run it (asking first), or to read the release
// notes. Only the request to api.github.com is made; nothing is sent.

const PREF_ENABLED = "jessnix.update.check";
const PREF_REPO = "jessnix.update.repo";
const PREF_LAST = "jessnix.update.last-check";
const PREF_SKIP = "jessnix.update.skip-version";
const DAY = 24 * 60 * 60 * 1000;
const BAR_ID = "jessnix-update";

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
    setTimeout(() => this.check().catch(e => console.warn("Update check:", e)), 90 * 1000);
  }

  get currentVersion() {
    return AppConstants.MOZ_APP_VERSION_DISPLAY || Services.appinfo.version;
  }

  // The latest release: { version, page, installer: { name, url, size } | null }.
  async latest() {
    const repo = Services.prefs.getStringPref(PREF_REPO, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      return null;
    }
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      return null;
    }
    const release = await response.json();
    const asset = (release.assets || []).find(a => /-setup\.exe$/i.test(a.name || ""));
    return {
      version: String(release.tag_name || "").replace(/^v/i, ""),
      page: String(release.html_url || ""),
      installer: asset
        ? { name: asset.name, url: asset.browser_download_url, size: asset.size }
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
    if (!installer || !/^https:\/\/github\.com\/.+\/releases\/download\//.test(installer.url)) {
      return;
    }
    const megabytes = Math.round((installer.size || 0) / (1024 * 1024));
    const ok = Services.prompt.confirm(
      window,
      "Install the update?",
      `Download ${installer.name} (${megabytes} MB) from GitHub and run it?\n\n` +
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
    const folder = PathUtils.join(PathUtils.tempDir, "custom-browser-update");
    await IOUtils.makeDirectory(folder, { ignoreExisting: true });
    const path = PathUtils.join(folder, installer.name.replace(/[^\w.-]/g, "_"));
    await IOUtils.write(path, new Uint8Array(await response.arrayBuffer()));
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(path);
    const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    process.init(file);
    process.runw(false, [], 0);
  }
}

window.gJessnixUpdates = new nsJessnixUpdates();
window.delayedStartupPromise.then(() => window.gJessnixUpdates.init());
