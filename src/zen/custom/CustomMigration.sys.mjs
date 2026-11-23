// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Carries over what a profile saved under the browser's earlier working name
// ("jessnix", up to 0.2.x): settings named jessnix.*, the profile's "jessnix"
// folder (chosen images, saved looks) and the Browse Together toolbar button.
// The data folder itself (%APPDATA%\jessnix) is moved before the profile is
// read, by toolkit/xre/CustomProfileMove.h.
//
// Runs before the first window opens (zen/common/Components.manifest), so the
// windows' styles and scripts only ever see the current names. Each step only
// acts on what is still under the old name, so running again does nothing.

const OLD_NAME = "jessnix";
const OLD_PREFS = `${OLD_NAME}.`;
const NEW_PREFS = "custom.";
const NEW_FOLDER = "custom-browser";
const OLD_PATH = new RegExp(`[\\\\/]${OLD_NAME}[\\\\/]([^\\\\/]+)$`);

// "jessnix.look.size" -> "custom.look.size"; any other name is returned as is.
export function currentPrefName(pref) {
  return pref.startsWith(OLD_PREFS) ? NEW_PREFS + pref.slice(OLD_PREFS.length) : pref;
}

// A { "pref.name": value } object from a look or backup made by an earlier
// version, with its names brought up to date.
export function currentPrefNames(prefs) {
  const renamed = {};
  for (const [pref, value] of Object.entries(prefs || {})) {
    renamed[currentPrefName(pref)] = value;
  }
  return renamed;
}

function newFolder() {
  return PathUtils.join(PathUtils.profileDir, NEW_FOLDER);
}

// A path into some profile's old folder -> the same file in this profile's
// folder. The profile itself may have moved too, so only the file name is kept.
function currentPath(value) {
  const match = typeof value === "string" ? OLD_PATH.exec(value) : null;
  return match ? PathUtils.join(newFolder(), match[1]) : value;
}

// Every string inside a parsed JSON value, passed through currentPath; object
// keys that are old pref names are renamed.
function currentJson(value) {
  if (typeof value === "string") {
    return currentPath(value);
  }
  if (Array.isArray(value)) {
    return value.map(currentJson);
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, inner] of Object.entries(value)) {
      result[currentPrefName(key)] = currentJson(inner);
    }
    return result;
  }
  return value;
}

function currentString(text) {
  if (/^\s*[\[{]/.test(text)) {
    try {
      return JSON.stringify(currentJson(JSON.parse(text)));
    } catch {}
  }
  return currentPath(text);
}

function moveFolder() {
  const old = Services.dirsvc.get("ProfD", Ci.nsIFile);
  old.append(OLD_NAME);
  if (!old.exists() || !old.isDirectory()) {
    return;
  }
  const target = Services.dirsvc.get("ProfD", Ci.nsIFile);
  target.append(NEW_FOLDER);
  if (target.exists()) {
    return;
  }
  old.renameTo(null, NEW_FOLDER);
}

function movePrefs() {
  for (const old of Services.prefs.getChildList(OLD_PREFS)) {
    if (!Services.prefs.prefHasUserValue(old)) {
      continue;
    }
    const pref = currentPrefName(old);
    // A value already set under the current name is newer: it wins.
    if (!Services.prefs.prefHasUserValue(pref)) {
      switch (Services.prefs.getPrefType(old)) {
        case Services.prefs.PREF_INT:
          Services.prefs.setIntPref(pref, Services.prefs.getIntPref(old));
          break;
        case Services.prefs.PREF_BOOL:
          Services.prefs.setBoolPref(pref, Services.prefs.getBoolPref(old));
          break;
        case Services.prefs.PREF_STRING:
          Services.prefs.setStringPref(pref, currentString(Services.prefs.getStringPref(old)));
          break;
      }
    }
    Services.prefs.clearUserPref(old);
  }
}

// Where the toolbar buttons sit is saved by button id.
function moveToolbarButtons() {
  for (const pref of Services.prefs.getChildList("browser.uiCustomization.")) {
    if (Services.prefs.getPrefType(pref) !== Services.prefs.PREF_STRING || !Services.prefs.prefHasUserValue(pref)) {
      continue;
    }
    const value = Services.prefs.getStringPref(pref);
    const renamed = value.replaceAll(`"${OLD_NAME}-`, '"custom-');
    if (renamed !== value) {
      Services.prefs.setStringPref(pref, renamed);
    }
  }
}

// Saved looks hold pref names and image paths.
async function moveSavedLooks() {
  const file = PathUtils.join(newFolder(), "looks.json");
  let text;
  try {
    text = await IOUtils.readUTF8(file);
  } catch {
    return;
  }
  if (!text.includes(OLD_NAME)) {
    return;
  }
  await IOUtils.writeUTF8(file, JSON.stringify(currentJson(JSON.parse(text))), {
    tmpPath: `${file}.tmp`,
  });
}

export const CustomMigration = {
  run() {
    for (const step of [moveFolder, movePrefs, moveToolbarButtons]) {
      try {
        step();
      } catch (e) {
        console.error("Custom Browser: carrying over earlier settings:", e);
      }
    }
    moveSavedLooks().catch(e => console.error("Custom Browser: carrying over saved looks:", e));
  },
};
