// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Custom Browser's new tab page (custom-newtab.html): a clock and greeting,
// search with the default engine, shortcut tiles and notes, arranged by the
// person (Edit: drag widgets to reorder, switch them on and off). It makes no
// network requests: tiles show a letter, not a downloaded icon. Everything it
// keeps is in prefs (custom.newtab.*), so it follows the profile.
//
// The page is chrome-privileged (it reads prefs and the search service), so it
// only ever shows text the person typed, as text.

const PREF_LAYOUT = "custom.newtab.layout";
const PREF_TILES = "custom.newtab.tiles";
const PREF_NOTES = "custom.newtab.notes";
const PREF_BACKGROUND = "custom.personalize.background";
const PREF_STRENGTH = "custom.personalize.background-strength";

// Firefox's search service (no longer on Services in this version).
const { SearchService } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/search/SearchService.sys.mjs"
);

const WIDGETS = ["clock", "search", "tiles", "notes"];
const DEFAULT_LAYOUT = [
  { id: "clock", shown: true },
  { id: "search", shown: true },
  { id: "tiles", shown: true },
  { id: "notes", shown: false },
];
const DEFAULT_TILES = [
  { name: "Wikipedia", url: "https://www.wikipedia.org/" },
  { name: "YouTube", url: "https://www.youtube.com/" },
  { name: "GitHub", url: "https://github.com/" },
];
const TILE_COLORS = ["#4FB3A9", "#F2C14E", "#E8835A", "#6C8EEF", "#B37FE0", "#5CB85C"];

let editing = false;

function readJSON(pref, fallback) {
  try {
    const value = JSON.parse(Services.prefs.getStringPref(pref, ""));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(pref, value) {
  Services.prefs.setStringPref(pref, JSON.stringify(value));
}

function layout() {
  const saved = readJSON(PREF_LAYOUT, null);
  const list = Array.isArray(saved) ? saved.filter(w => WIDGETS.includes(w?.id)) : [];
  for (const widget of DEFAULT_LAYOUT) {
    if (!list.some(w => w.id === widget.id)) {
      list.push({ ...widget });
    }
  }
  return list;
}

function tiles() {
  const saved = readJSON(PREF_TILES, null);
  if (!Array.isArray(saved)) {
    return DEFAULT_TILES;
  }
  return saved.filter(t => typeof t?.url === "string" && /^https?:\/\//i.test(t.url)).slice(0, 24);
}

// ---- Widgets --------------------------------------------------------------

function buildClock(section) {
  const time = section.querySelector(".clock-time");
  const greeting = section.querySelector(".clock-greeting");
  const tick = () => {
    const now = new Date();
    time.textContent = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const hour = now.getHours();
    greeting.textContent =
      hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  };
  tick();
  setInterval(tick, 10 * 1000);
}

async function buildSearch(section) {
  const form = section.querySelector("form");
  const input = section.querySelector("input");
  let engine = null;
  try {
    await SearchService.init();
    engine = await SearchService.getDefault();
    input.placeholder = `Search with ${engine.name} or type an address`;
  } catch {
    input.placeholder = "Search or type an address";
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) {
      return;
    }
    let url;
    if (/^https?:\/\//i.test(text)) {
      url = text;
    } else if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(text) && !text.includes(" ")) {
      url = "https://" + text;
    } else if (engine) {
      url = engine.getSubmission(text).uri.spec;
    } else {
      return;
    }
    window.location.href = url;
  });
  if (!editing) {
    setTimeout(() => input.focus(), 50);
  }
}

function buildTiles(section) {
  const holder = section.querySelector(".tiles");
  const form = section.querySelector(".tile-add");
  const render = () => {
    holder.replaceChildren();
    tiles().forEach((tile, index) => {
      const link = document.createElement("a");
      link.className = "tile";
      link.href = tile.url;
      const letter = document.createElement("span");
      letter.className = "tile-letter";
      const name = String(tile.name || new URL(tile.url).hostname.replace(/^www\./, ""));
      letter.textContent = name.slice(0, 1).toUpperCase();
      letter.style.backgroundColor = TILE_COLORS[index % TILE_COLORS.length];
      const label = document.createElement("span");
      label.className = "tile-name";
      label.textContent = name;
      link.append(letter, label);
      if (editing) {
        const remove = document.createElement("button");
        remove.className = "tile-remove";
        remove.type = "button";
        remove.textContent = "×";
        remove.title = "Remove";
        remove.addEventListener("click", event => {
          event.preventDefault();
          const list = tiles();
          list.splice(index, 1);
          writeJSON(PREF_TILES, list);
          render();
        });
        link.append(remove);
        link.addEventListener("click", event => event.preventDefault());
      }
      holder.append(link);
    });
  };
  form.hidden = !editing;
  form.addEventListener("submit", event => {
    event.preventDefault();
    let url = form.querySelector(".tile-url").value.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url;
    }
    try {
      new URL(url);
    } catch {
      return;
    }
    const list = tiles();
    list.push({ name: form.querySelector(".tile-name").value.trim().slice(0, 30), url });
    writeJSON(PREF_TILES, list);
    form.reset();
    render();
  });
  render();
}

function buildNotes(section) {
  const area = section.querySelector("textarea");
  area.value = Services.prefs.getStringPref(PREF_NOTES, "");
  let timer = null;
  area.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => Services.prefs.setStringPref(PREF_NOTES, area.value.slice(0, 20000)), 400);
  });
}

const BUILDERS = { clock: buildClock, search: buildSearch, tiles: buildTiles, notes: buildNotes };
const NAMES = { clock: "Clock", search: "Search", tiles: "Shortcuts", notes: "Notes" };

// ---- Board ----------------------------------------------------------------

function render() {
  const board = document.getElementById("board");
  board.replaceChildren();
  board.classList.toggle("editing", editing);
  for (const widget of layout()) {
    if (!widget.shown && !editing) {
      continue;
    }
    const section = document.getElementById(`widget-${widget.id}`).content.firstElementChild.cloneNode(true);
    section.classList.toggle("off", !widget.shown);
    if (editing) {
      section.draggable = true;
      const bar = document.createElement("div");
      bar.className = "widget-bar";
      const handle = document.createElement("span");
      handle.className = "widget-handle";
      handle.textContent = `⠿ ${NAMES[widget.id]}`;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = widget.shown ? "Hide" : "Show";
      toggle.addEventListener("click", () => {
        writeJSON(
          PREF_LAYOUT,
          layout().map(w => (w.id === widget.id ? { ...w, shown: !w.shown } : w))
        );
        render();
      });
      bar.append(handle, toggle);
      section.prepend(bar);
      section.addEventListener("dragstart", event => {
        event.dataTransfer.setData("text/x-custom-widget", widget.id);
        section.classList.add("dragging");
      });
      section.addEventListener("dragend", () => section.classList.remove("dragging"));
      section.addEventListener("dragover", event => {
        if (event.dataTransfer.types.includes("text/x-custom-widget")) {
          event.preventDefault();
        }
      });
      section.addEventListener("drop", event => {
        event.preventDefault();
        moveWidget(event.dataTransfer.getData("text/x-custom-widget"), widget.id);
      });
    }
    board.append(section);
    BUILDERS[widget.id](section);
  }
}

// Puts widget `id` where widget `beforeId` is.
function moveWidget(id, beforeId) {
  if (!id || id === beforeId) {
    return;
  }
  const list = layout();
  const moving = list.find(w => w.id === id);
  const rest = list.filter(w => w.id !== id);
  rest.splice(rest.findIndex(w => w.id === beforeId), 0, moving);
  writeJSON(PREF_LAYOUT, rest);
  render();
}

function applyBackground() {
  const background = document.getElementById("background");
  const path = Services.prefs.getStringPref(PREF_BACKGROUND, "");
  if (!path) {
    background.style.backgroundImage = "";
    document.body.classList.remove("has-background");
    return;
  }
  background.style.backgroundImage = `url("${PathUtils.toFileURI(path)}")`;
  background.style.opacity = String(Services.prefs.getIntPref(PREF_STRENGTH, 60) / 100);
  document.body.classList.add("has-background");
}

document.getElementById("edit").addEventListener("click", () => {
  editing = !editing;
  document.getElementById("edit").textContent = editing ? "Done" : "Edit";
  render();
});

applyBackground();
render();
window.gCustomNewTab = { layout, tiles, moveWidget, render };
