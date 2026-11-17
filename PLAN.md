# Jessnix Browser: Build Plan

A fast, private browser for daily use, with features that are mine.

Jessnix is a **fork of [Zen Browser](https://github.com/zen-browser/desktop)**, which is built on Firefox. Zen already has vertical tabs, workspaces, split view and compact mode. Jessnix adds its own name and look, LibreWolf-style privacy defaults, and its own features on top.

---

## 1. Base decision

| Option | Verdict |
|---|---|
| **Fork of Zen (Firefox)** | **Chosen.** Firefox's whole interface (tab strip, toolbar, menus, sidebars) is HTML/JS/CSS, so changing it rebuilds in seconds (`scripts/jessnix.ps1 ui`) instead of a C++ compile. Zen's vertical tabs, spaces and split view come for free |
| Patch set on ungoogled-chromium | Tried first (tag `chromium-archive`). The interface is C++: every UI change meant a compile, and patches break on every 4-week Chromium release |
| Own project on plain Firefox (surfer) | Same build speed as the Zen fork, but vertical tabs, spaces and split view would all have to be built from scratch |
| Ladybird / Servo / Electron | Too early for daily use, or not a real browser |

How Zen is built: [surfer](https://github.com/zen-browser/surfer) downloads Firefox's source into `engine/`, applies the `.patch` files and copies the files under `src/`, then runs Firefox's build (`mach`). Where Jessnix came from in Zen is recorded in [docs/jessnix/UPSTREAM.md](docs/jessnix/UPSTREAM.md).

---

## 2. What I need on my machine

| Need | Detail |
|---|---|
| Windows 10/11 x64 | |
| A path with no spaces | Firefox refuses to build otherwise (the repo is `D:\AIStuff\Jessnix-Browser`) |
| MozillaBuild | `C:\mozilla-build`, Mozilla's build shell and tools |
| Git for Windows, Node.js 21+, Python 3, Rust | surfer and Firefox's build use them |
| sccache, 7-Zip | build cache, packaging |
| Disk | ~40 GB for Firefox source + build |

Everything runs through `scripts/jessnix.ps1 <step>`, which sets up the environment and logs to `.logs/`.

---

## 3. Repo layout

```
Jessnix-Browser/
├── PLAN.md, README.md, CLAUDE.md
├── surfer.json        name, version, brands (what surfer builds)
├── src/               files copied into Firefox, and *.patch files applied to it
│   └── zen/           Zen's own features (spaces, split-view, compact-mode, ...)
├── prefs/             default preferences (firefox/, zen/, privatefox/, fastfox/)
├── configs/           build config and branding (configs/branding/<brand>/)
├── branding/          Jessnix's original icon files
├── scripts/           jessnix.ps1 (Windows wrapper) + Zen's scripts
├── docs/jessnix/      Jessnix notes: upstream, features
└── engine/            Firefox source, downloaded by `init` (not in git)
```

---

## 4. Phases

### Phase 0: First build (goal: plain Zen, built on my machine)
- [x] Install MozillaBuild, sccache, 7-Zip on PATH
- [x] Import Zen 1.24.2b (Firefox 160)
- [x] `scripts/jessnix.ps1 init`: download Firefox and prepare it
- [x] `scripts/jessnix.ps1 build` (29.7 min first time), then `start`: the browser runs

### Phase 1: Rebrand (goal: it says Jessnix everywhere)
- [x] `surfer.json`: name, app ID and binary `jessnix.exe`, brand names, version 0.1.0, own GitHub repo
- [x] Icons from `branding/` into `configs/branding/release/` (`scripts/jessnix_branding.py`). The source art is 256 px, so the large about-page logo is upscaled; a bigger original would sharpen it
- [x] **Updater off** (`--disable-updater`), so Zen's server can never replace Jessnix with Zen
- [x] About page, post-update notice and uninstall page link to Jessnix's GitHub; Zen's donate and privacy-policy links removed
- [x] Own profile name `jessnix` and vendor, so it never shares data with Zen or Firefox
- [ ] Wordmark (the name drawn as an image) in Jessnix's own type: waits for `DESIGN.md`
- [ ] Remaining Zen services: Zen mods store, `share.zen-browser.app` (review in Phase 2)
- [ ] Windows installer (`scripts/jessnix.ps1 package`)

### Phase 2: Privacy defaults (the LibreWolf + Brave layer)
Zen already turns off Mozilla telemetry, studies and crash-report sending (`prefs/privatefox/`). Jessnix adds, in `prefs/jessnix/privacy.yaml`:
- [x] Enhanced Tracking Protection: strict; HTTPS-Only mode on
- [x] Cookie banners answered with "reject"
- [x] Tracking parameters stripped from links
- [x] Fingerprinting protection (Firefox's, without the site breakage of full resistFingerprinting)
- [x] WebRTC IP-leak protection, cross-site referrers trimmed to the origin
- [ ] Default search: DuckDuckGo (Firefox only lets a policy or its search config change it; decide which)
- [ ] Optional: clear cookies/history on exit, with a per-site keep list (Firefox has per-site "delete on close" already)

**Brave features, and where they come from in Jessnix.** Crypto (Rewards, Wallet), the paid VPN, Leo AI and Brave News are left out on purpose.

| Brave | Jessnix |
|---|---|
| Shields: ads and trackers | bundled uBlock Origin + strict tracking protection |
| HTTPS by default | HTTPS-Only mode |
| Fingerprint randomizing | Firefox fingerprinting protection |
| Cookie consent blocking | Firefox cookie-banner handling (reject) |
| Query/debounce link cleaning | Firefox query stripping + uBlock Origin filters |
| Global Privacy Control | on (Zen) |
| Vertical tabs, tab groups | Zen vertical tabs, spaces, folders |
| Split view | Zen split view |
| Password manager, sync | Firefox password manager; Firefox Sync |
| Private window with Tor | not planned (needs the Tor network bundled) |

### Phase 3: Speed and daily-use basics
- [x] **Bundled uBlock Origin 1.76.4** (`scripts/fetch_ublock.py` downloads the pinned, checksummed release; Firefox installs it into each new profile, then it updates itself)
- [x] Logins remembered: password manager on, cookies kept between sessions (`prefs/jessnix/daily.yaml`)
- [x] Bookmarks: the star in the address bar is back (Zen hid it) and the bookmarks bar shows on every page
- [ ] Release build (link-time optimization) for daily use
- [ ] Hebrew language pack and spellcheck included
- [ ] Tab unloading on, hardware video decode confirmed
- [ ] Bookmark/password import from Chrome/Edge works
- [ ] Updates: own update feed from GitHub Releases
- [ ] Sync: decide between Firefox Sync (Mozilla account) and none

### Phase 4: Jessnix features (what makes it mine)
Each feature lives in `src/zen/jessnix/` (or its own folder) and gets a note in `docs/jessnix/`.

| Feature | Status |
|---|---|
| Vertical tabs, spaces (Zen "workspaces") | Comes with Zen |
| Split view | Comes with Zen |
| Compact mode, mods/themes store | Comes with Zen |
| **Personalize** (Settings > Look and Feel): each person sets the browser's name, window icon, a background image and the accent color (`src/zen/jessnix/`) | Built |
| **Layout** (in Personalize): size (compact, comfortable, large), corners, light or dark, sidebar left or right, bookmarks bar, button names, always-visible window buttons (`jessnix-look.css`) | Built |
| **Tabs on top** as a choice | Not possible as a switch: Zen's leftover horizontal-tabs pref does nothing; would need Zen's tab code reworked |
| **Jessnix new tab page**: mascot, clock, search, shortcut tiles, no network requests | To build (Low) |
| **Mascot theme**: purple, from the icon, light + dark | To build (Low) |
| **Command palette** (Ctrl+K): tabs, history, bookmarks, settings, actions | To build (Medium) |
| **Game mode**: one toggle to unload background tabs, pause media, free RAM | To build (Medium) |
| **Hebrew / RTL helpers**: quick RTL/LTR toggle for text fields | To build (Low) |
| **Throwaway site profiles**: open a site in a temporary container, wiped on close | To build (Medium, Firefox containers help) |
| **Screenshot + notes panel** | To build (Medium, Firefox has screenshots) |

Start with the new tab page and theme.

### Phase 5: Later
- [ ] Linux build
- [ ] Release automation on a self-hosted runner (my PC)

---

## 5. Rules for UI work

Every Jessnix UI surface (new tab page, theme, panels, settings) goes through **anti-slop** ([miqdadbadjuber/anti-slop](https://github.com/miqdadbadjuber/anti-slop)):
1. Install it in this repo by running `npx antislop-ai` myself
2. Before any UI is built, I write `DESIGN.md`: identity, personality, palette, typography, mood. anti-slop is a filter, not a source of taste, so the direction has to come from me
3. Every visual choice has a written reason. If a screen would look the same with the Jessnix name swapped out, it gets redone

---

## 6. Keeping up with Zen and Firefox

Firefox ships a new version every 4 weeks, with security fixes in between, and Zen follows within days. A daily-use browser has to follow:
- Take each new Zen release with the steps in [docs/jessnix/UPSTREAM.md](docs/jessnix/UPSTREAM.md)
- Keep Jessnix changes in their own files where possible (`src/zen/jessnix/`, `prefs/jessnix/`), so Zen updates rarely conflict
- Never ship more than one Firefox version behind: old engines mean known security holes
