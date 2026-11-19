// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// More of Personalize, applied to each browser window (jessnix-look.css has
// the styles; JessnixLooks.sys.mjs saves and shares them as looks):
// - Text: the browser's own font and text size, separate from page zoom.
// - See-through window: lets Windows 11's Mica blur show behind the toolbars.
// - Light/dark by time of day.
// - Address bar at the bottom of the window.

const PREF_FONT = "jessnix.look.ui-font";
const PREF_FONT_SIZE = "jessnix.look.ui-font-size";
const PREF_SEE_THROUGH = "jessnix.look.see-through";
const PREF_SCHEDULE = "jessnix.look.schedule";
const PREF_DARK_FROM = "jessnix.look.dark-from";
const PREF_LIGHT_FROM = "jessnix.look.light-from";
const PREF_SCHEME = "zen.view.window.scheme";
const PREF_ADDRESS_BOTTOM = "jessnix.look.address-bar-bottom";

// zen.view.window.scheme: 0 dark, 1 light, 2 follow the system.
const SCHEME_DARK = 0;
const SCHEME_LIGHT = 1;

const PREFS = [PREF_FONT, PREF_FONT_SIZE, PREF_SEE_THROUGH, PREF_SCHEDULE, PREF_DARK_FROM, PREF_LIGHT_FROM, PREF_ADDRESS_BOTTOM];

// "19:30" -> minutes since midnight; anything else -> null.
function minutesOf(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || ""));
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

// Whether "now" falls in the dark part of the day.
export function isDarkTime(now, darkFrom, lightFrom) {
  const dark = minutesOf(darkFrom);
  const light = minutesOf(lightFrom);
  if (dark === null || light === null || dark === light) {
    return false;
  }
  const minute = now.getHours() * 60 + now.getMinutes();
  // Dark across midnight (19:00 -> 07:00), or within one day (01:00 -> 06:00).
  return dark > light ? minute >= dark || minute < light : minute >= dark && minute < light;
}

class nsJessnixLookExtras {
  #scheduleTimer = null;

  init() {
    for (const pref of PREFS) {
      Services.prefs.addObserver(pref, this);
    }
    window.addEventListener(
      "unload",
      () => {
        for (const pref of PREFS) {
          Services.prefs.removeObserver(pref, this);
        }
        clearInterval(this.#scheduleTimer);
      },
      { once: true }
    );
    window.addEventListener("resize", () => this.#placeAddressResults());
    this.#applyText();
    this.#applySeeThrough();
    this.#applySchedule();
    this.#applyAddressBottom();
  }

  observe(_subject, _topic, pref) {
    switch (pref) {
      case PREF_FONT:
      case PREF_FONT_SIZE:
        this.#applyText();
        break;
      case PREF_SEE_THROUGH:
        this.#applySeeThrough();
        break;
      case PREF_SCHEDULE:
      case PREF_DARK_FROM:
      case PREF_LIGHT_FROM:
        this.#applySchedule();
        break;
      case PREF_ADDRESS_BOTTOM:
        this.#applyAddressBottom();
        break;
    }
  }

  #applyText() {
    const root = document.documentElement;
    const font = Services.prefs.getStringPref(PREF_FONT, "").replace(/["\\;{}]/g, "").trim();
    root.toggleAttribute("jessnix-ui-font", !!font);
    if (font) {
      root.style.setProperty("--jessnix-ui-font", `"${font}"`);
    } else {
      root.style.removeProperty("--jessnix-ui-font");
    }
    const size = Services.prefs.getIntPref(PREF_FONT_SIZE, 0);
    const valid = size >= 9 && size <= 28;
    root.toggleAttribute("jessnix-ui-font-size", valid);
    if (valid) {
      root.style.setProperty("--jessnix-ui-font-size", `${size}px`);
    } else {
      root.style.removeProperty("--jessnix-ui-font-size");
    }
  }

  #applySeeThrough() {
    const root = document.documentElement;
    const amount = Math.min(90, Math.max(0, Services.prefs.getIntPref(PREF_SEE_THROUGH, 0)));
    root.toggleAttribute("jessnix-see-through", amount > 0);
    root.style.setProperty("--jessnix-see-through-opacity", String(1 - amount / 100));
  }

  // Light/dark by time: checked now and every minute, while switched on.
  #applySchedule() {
    clearInterval(this.#scheduleTimer);
    this.#scheduleTimer = null;
    if (!Services.prefs.getBoolPref(PREF_SCHEDULE, false)) {
      return;
    }
    const check = () => {
      const dark = isDarkTime(
        new Date(),
        Services.prefs.getStringPref(PREF_DARK_FROM, "19:00"),
        Services.prefs.getStringPref(PREF_LIGHT_FROM, "07:00")
      );
      const wanted = dark ? SCHEME_DARK : SCHEME_LIGHT;
      if (Services.prefs.getIntPref(PREF_SCHEME, 2) !== wanted) {
        Services.prefs.setIntPref(PREF_SCHEME, wanted);
      }
    };
    check();
    this.#scheduleTimer = setInterval(check, 60 * 1000);
  }

  #applyAddressBottom() {
    const on = Services.prefs.getBoolPref(PREF_ADDRESS_BOTTOM, false);
    document.documentElement.toggleAttribute("jessnix-address-bottom", on);
    this.#placeAddressResults();
  }

  // With the address bar at the bottom, its results open upwards: the open bar
  // is anchored to the bottom of the address row.
  #placeAddressResults() {
    const root = document.documentElement;
    if (!root.hasAttribute("jessnix-address-bottom")) {
      root.style.removeProperty("--jessnix-urlbar-bottom");
      return;
    }
    const container = document.getElementById("urlbar-container");
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    root.style.setProperty("--jessnix-urlbar-bottom", `${Math.max(0, Math.round(window.innerHeight - rect.bottom))}px`);
  }
}

window.gJessnixLookExtras = new nsJessnixLookExtras();
window.delayedStartupPromise.then(() => window.gJessnixLookExtras.init());
