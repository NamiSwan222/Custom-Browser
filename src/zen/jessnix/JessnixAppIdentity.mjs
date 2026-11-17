// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Makes the app itself carry the name and icon chosen in Settings > Look and
// Feel > Personalize: the Desktop and Start menu shortcuts are renamed to the
// chosen name and drawn with the chosen icon. Windows takes the taskbar icon
// from the Start menu shortcut, so this is also what changes the taskbar.
//
// Only shortcuts that belong to this install are touched: Windows reports them
// by their App User Model ID and target (enumerateInstallShortcuts). The
// all-users Start menu shortcut needs admin rights, so a per-user one is made
// to stand in front of it, the same way Firefox's own custom icons work
// (browser/components/shell/CustomIconManager.sys.mjs).
//
// Loaded once per session as a shared module: the first window imports it
// (JessnixPersonalize.mjs), and it then follows the prefs by itself.

import {
  clearTimeout,
  setTimeout,
} from "resource://gre/modules/Timer.sys.mjs";

const PREF_NAME = "jessnix.personalize.name";
const PREF_ICON = "jessnix.personalize.icon";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AppConstants: "resource://gre/modules/AppConstants.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
  ShellService: "moz-src:///browser/components/shell/ShellService.sys.mjs",
  TaskbarTabsUtils:
    "moz-src:///browser/components/taskbartabs/TaskbarTabsUtils.sys.mjs",
});
ChromeUtils.defineLazyGetter(lazy, "WinShell", () =>
  Cc["@mozilla.org/browser/shell-service;1"].getService(Ci.nsIWindowsShellService)
);
ChromeUtils.defineLazyGetter(lazy, "WinTaskbar", () =>
  Cc["@mozilla.org/windows-taskbar;1"].getService(Ci.nsIWinTaskbar)
);

const MIME_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  ico: "image/vnd.microsoft.icon",
};

// Windows file names can't hold these, or end in a dot or space.
function shortcutName(name) {
  const clean = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 60);
  return clean || null;
}

// Only an installed copy owns shortcuts. A build, test or unzipped copy (not
// registered with Windows) must never add Start menu entries.
async function isSupported() {
  if (
    lazy.AppConstants.platform != "win" ||
    Services.sysinfo.getProperty("hasWinPackageId")
  ) {
    return false;
  }
  return isRegisteredInstall(Services.dirsvc.get("XREExeF", Ci.nsIFile).parent.path);
}

// True when Windows lists this folder as an installed app (Settings > Apps):
// the installer writes InstallLocation under an Uninstall key. An unzipped or
// copied folder has no such entry.
function isRegisteredInstall(folder) {
  const want = folder.replace(/\\+$/, "").toLowerCase();
  const roots = [
    Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER,
    Ci.nsIWindowsRegKey.ROOT_KEY_LOCAL_MACHINE,
  ];
  for (const root of roots) {
    const uninstall = Cc["@mozilla.org/windows-registry-key;1"].createInstance(
      Ci.nsIWindowsRegKey
    );
    try {
      uninstall.open(
        root,
        "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        Ci.nsIWindowsRegKey.ACCESS_READ | Ci.nsIWindowsRegKey.WOW64_64
      );
    } catch {
      continue;
    }
    try {
      for (let i = 0; i < uninstall.childCount; i++) {
        let app;
        try {
          app = uninstall.openChild(uninstall.getChildName(i), Ci.nsIWindowsRegKey.ACCESS_READ);
          if (
            app.hasValue("InstallLocation") &&
            app.readStringValue("InstallLocation").replace(/\\+$/, "").toLowerCase() == want
          ) {
            return true;
          }
        } catch {
          // An entry this account can't read is not ours.
        } finally {
          app?.close();
        }
      }
    } finally {
      uninstall.close();
    }
  }
  return false;
}

// The chosen image as an .ico in the profile's jessnix folder (made once per
// chosen image), or null for the icon built into the program.
async function chosenIcon() {
  const source = Services.prefs.getStringPref(PREF_ICON, "");
  const extension = source.split(".").pop().toLowerCase();
  const mime = MIME_BY_EXTENSION[extension];
  if (!source || !mime || !(await IOUtils.exists(source))) {
    return null;
  }
  const folder = PathUtils.parent(source);
  const base = PathUtils.filename(source).replace(/\.[^.]+$/, "");
  const icoPath = PathUtils.join(folder, `${base}-app.ico`);
  if (!(await IOUtils.exists(icoPath))) {
    const image = await lazy.TaskbarTabsUtils._remoteDecodeImageFromFile(
      new lazy.FileUtils.File(source),
      256,
      null,
      mime
    );
    await lazy.ShellService.writeShortcutIcon(new lazy.FileUtils.File(icoPath), image);
  }
  return new lazy.FileUtils.File(icoPath);
}

// Removes .ico files made for earlier choices.
async function removeOldIcons(keep) {
  const folder = PathUtils.join(PathUtils.profileDir, "jessnix");
  if (!(await IOUtils.exists(folder))) {
    return;
  }
  for (const path of await IOUtils.getChildren(folder)) {
    if (path.endsWith("-app.ico") && path != keep) {
      await IOUtils.remove(path, { ignoreAbsent: true });
    }
  }
}

async function syncNow() {
  if (!(await isSupported())) {
    return;
  }
  const brand = lazy.AppConstants.MOZ_APP_DISPLAYNAME_DO_NOT_USE;
  const customName = shortcutName(Services.prefs.getStringPref(PREF_NAME, ""));
  const wanted = `${customName || brand}.lnk`;
  const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile);
  const icon = await chosenIcon();
  const isCustom = !!(customName || icon);
  const aumid = lazy.WinTaskbar.defaultGroupId;

  const [description] = await new Localization(
    ["branding/brand.ftl", "browser/browser.ftl"],
    true
  ).formatValues(["browser-shortcut-description"]);

  const folders = {
    Desktop: Services.dirsvc.get("Desk", Ci.nsIFile).path,
    Programs: Services.dirsvc.get("Progs", Ci.nsIFile).path,
  };
  let entries = await lazy.WinShell.enumerateInstallShortcuts(aumid);

  for (const [location, folderPath] of Object.entries(folders)) {
    const ours = entries.filter(entry => entry.location == location);
    // A Desktop shortcut is only renamed, never added. A per-user Start menu
    // shortcut is added when something is customized, so the taskbar uses it.
    if (!ours.length && (location == "Desktop" || !isCustom)) {
      continue;
    }
    const hasWanted = ours.some(
      entry => PathUtils.filename(entry.path).toLowerCase() == wanted.toLowerCase()
    );
    if (!hasWanted) {
      await lazy.WinShell.createShortcut(
        exe,
        [],
        description,
        icon ?? exe,
        0,
        aumid,
        location,
        wanted
      );
    }
    for (const entry of ours) {
      const fileName = PathUtils.filename(entry.path);
      const inFolderRoot =
        PathUtils.parent(entry.path).toLowerCase() == folderPath.toLowerCase();
      if (inFolderRoot && fileName.toLowerCase() != wanted.toLowerCase()) {
        await lazy.WinShell.deleteShortcut(location, fileName);
      }
    }
  }

  // The icon on every shortcut this person can change, taskbar pins included.
  entries = await lazy.WinShell.enumerateInstallShortcuts(aumid);
  const paths = entries
    .filter(entry => entry.location != "CommonPrograms")
    .map(entry => entry.path);
  if (paths.length) {
    await lazy.WinShell.setShortcutsIcon(paths, (icon ?? exe).path, 0);
  }
  await removeOldIcons(icon?.path);
  // Taskbar buttons re-read their shortcut, so the change shows without a restart.
  lazy.WinTaskbar.refreshTaskbarButtons();
}

let queue = Promise.resolve();
let timer = null;

export const JessnixAppIdentity = {
  // Runs one update at a time; a burst of pref changes becomes one update.
  sync() {
    queue = queue
      .then(syncNow)
      .catch(error => console.error("Jessnix: could not update the app shortcuts", error));
    return queue;
  },

  observe() {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      this.sync();
    }, 500);
  },
};

Services.prefs.addObserver(PREF_NAME, JessnixAppIdentity);
Services.prefs.addObserver(PREF_ICON, JessnixAppIdentity);
// Once per session: keeps the shortcuts right after an install or update, when
// the installer has put back its own "<brand>.lnk".
JessnixAppIdentity.sync();
