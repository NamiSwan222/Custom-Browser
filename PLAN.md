# Jessnix Browser: Build Plan

A fast, private, Chromium-based browser for daily use, with features that are mine.

The model is **LibreWolf, but for Chromium**: LibreWolf does not rewrite Firefox. It takes upstream Firefox, removes telemetry, applies privacy settings and patches, bundles uBlock Origin, and rebrands it. Jessnix does the same on top of Chromium, starting from [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium), which already strips Google services and background requests.

---

## 1. Base decision

| Option | What it is | Verdict |
|---|---|---|
| **Patch set on ungoogled-chromium** | Keep Chromium source untouched, apply our own patches + branding + default prefs at build time | **Chosen.** Real Chromium speed, real Chrome extensions, and moving to a new Chromium version means re-applying a patch folder, not merging a fork |
| Full Chromium fork | Edit Chromium directly | Every 4-week Chromium release becomes a painful merge. Not maintainable alone |
| Electron / CEF wrapper | A web app that hosts a Chromium view | Fast to prototype, but slower, weak extension support, and not a real browser. Rejected |

The same approach powers Helium, Thorium, Cromite and Brave's patch layer, so there's plenty of prior work to learn from.

---

## 2. What I need on my machine

| Need | Detail |
|---|---|
| Windows 10/11 x64 | Building on Windows produces Windows builds |
| Visual Studio 2022 | "Desktop development with C++" workload + the Windows SDK version Chromium's docs list |
| Disk | ~100 GB free on a fast SSD for source + build output |
| RAM | 32 GB recommended (16 GB works, slowly) |
| Python 3, Git, depot_tools | Chromium's build tooling |
| Time | First full build takes several hours. Later incremental builds take minutes |

Repos to clone next to this one:
- `ungoogled-chromium`: the core patches and domain substitution
- `ungoogled-chromium-windows`: the Windows build scripts that this project's `scripts/` will wrap

---

## 3. Repo layout

```
Jessnix Browser/
├── PLAN.md                  this file
├── README.md
├── branding/                icons (.ico + PNG sizes); later: wordmark, installer art
├── patches/                 Jessnix patches, applied after ungoogled-chromium's
│   └── series               order the patches apply in
├── config/
│   ├── flags.gn             build flags (official release build)
│   ├── initial_preferences  first-run defaults (search engine, homepage, privacy)
│   └── policies/            managed policies
├── scripts/                 fetch → patch → build → package
└── docs/                    one note per feature + how to move to a new Chromium
```

---

## 4. Phases

### Phase 0: First build (goal: a plain ungoogled-chromium I built myself)
- [ ] Install the toolchain (section 2)
- [ ] Build stock `ungoogled-chromium-windows` once, unchanged. Proves the machine works before any of my changes can break it
- [ ] Write `scripts/build.ps1`: fetch → apply patches → build → package

### Phase 1: Rebrand (goal: it says Jessnix everywhere)
- [x] Product name and company name (`patches/jessnix/product-name.patch`)
- [x] Name in all UI text and all 81 translations (`scripts/jessnix_apply.py`)
- [ ] Executable `jessnix.exe` (still `chrome.exe`: the name is wired into the installer, updater and packaging, so it gets its own patch later)
- [x] App icon from `branding/jessnix.ico`, PNG sizes into Chromium's theme resources (`branding/assets.txt`)
- [x] Own user-data folder (`%LOCALAPPDATA%\Jessnix`), own Windows IDs, never collides with Chrome or Chromium (`patches/jessnix/install-identity.patch`)
- [ ] About page and `chrome://version` show Jessnix name + version
- [x] Windows installer + portable ZIP, named `Jessnix_<version>_...` in `dist/`

### Phase 2: Privacy defaults (the LibreWolf layer)
Most of this comes free from ungoogled-chromium. The checklist makes sure nothing is missed:
- [ ] No telemetry, crash reporting, usage stats, or Google service pings
- [ ] Default search: DuckDuckGo (switchable to Startpage, Brave Search, SearXNG, Google)
- [ ] Third-party cookies blocked; HTTPS-Only mode on
- [ ] WebRTC IP-leak protection on
- [ ] Cross-site referrers trimmed
- [ ] Fingerprinting reductions (ungoogled-chromium's fingerprinting flags)
- [ ] Optional: clear cookies/history on exit, with a per-site keep list
- [ ] No Google sign-in; Google sync off (own sync in Phase 5)

### Phase 3: Speed and daily-use basics
- [ ] Official release build flags: `is_official_build`, ThinLTO, PGO, `symbol_level=0`
- [ ] CPU-targeted build option (AVX2), like Thorium, for a few percent more speed
- [ ] **Bundled uBlock Origin.** Ad blocking is the biggest speed win on real sites. Chrome removed Manifest V2, so this needs either patches that keep MV2 working (as ungoogled-chromium/Helium do) or uBlock Origin Lite as fallback. Check the current state when building
- [ ] Chrome Web Store installs working (ungoogled-chromium needs a small helper for this)
- [ ] Memory Saver / tab sleeping on by default, configurable timeout
- [ ] Hardware video decode and GPU rasterization confirmed on
- [ ] Password manager, autofill, PDF viewer, downloads, bookmark import from Chrome/Edge/Firefox. These come with Chromium; verify they still work after de-Googling
- [ ] Update check: look at GitHub Releases on startup and offer the new version (no background service)

### Phase 4: Jessnix features (what makes it mine)
Build and ship one at a time. Each gets a note in `docs/`.

| Feature | What it does | Effort |
|---|---|---|
| **Jessnix new tab page** | Fast local page: mascot, clock, search, shortcut tiles. No feeds, no ads, no network requests | Low |
| **Mascot theme** | Purple theme drawn from the icon, light + dark | Low |
| **Command palette** (Ctrl+K) | Search tabs, history, bookmarks, settings and actions from one box | Medium |
| **Vertical tabs + spaces** | Side tab strip; save/restore a set of tabs as a "space" (Gamedev, Hebrew projects, Daily…) | Medium–High |
| **Split view** | Two tabs side by side in one window | Medium (Chromium has an upstream base) |
| **Game mode** | One toggle: sleep background tabs, throttle hidden tabs, pause media, free RAM while a game runs | Medium |
| **Hebrew / RTL helpers** | Hebrew spellcheck preinstalled, quick RTL/LTR toggle for text fields | Low |
| **Throwaway site profiles** | Open a site in a temporary profile that's wiped on close | High |
| **Screenshot + notes panel** | Full-page screenshot and a scratchpad side panel | Medium |

Start with the new tab page and theme: visible right away, and they don't touch Chromium internals.

### Phase 5: Later
- [ ] Own sync (bookmarks, settings) through a folder I choose or a small server
- [ ] Linux build
- [ ] Release automation (Chromium is too big for free GitHub runners, so a self-hosted runner on my PC)

---

## 5. Rules for UI work

Every Jessnix UI surface (new tab page, settings pages, theme, side panels) goes through **anti-slop** ([miqdadbadjuber/anti-slop](https://github.com/miqdadbadjuber/anti-slop)):
1. Install it in this repo by running `npx antislop-ai` myself
2. Before any UI is built, I write `DESIGN.md`: identity, personality, palette, typography, mood. anti-slop is a filter, not a source of taste, so the direction has to come from me
3. Every visual choice has a written reason. If a screen would look the same with the Jessnix name swapped out, it gets redone

---

## 6. Keeping up with Chromium

Chromium ships a new stable version every 4 weeks, with security fixes in between. A daily-use browser has to follow:
- Track the ungoogled-chromium release tag for each new Chromium version
- Re-apply `patches/`, fix any that fail, rebuild, release
- Keep patches small, one feature per file, so updates stay cheap
- Never run a build more than one stable version behind: old Chromium means known security holes

---

## 7. Next steps

1. Install the toolchain and do the Phase 0 stock build
2. Write `DESIGN.md` (how Jessnix should look and feel)
3. Phase 1 rebrand, then the first test build
