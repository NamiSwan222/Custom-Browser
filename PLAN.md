# Custom Browser: Build Plan

A fast, private browser for daily use, with features that are mine.

Custom Browser is a **fork of [Zen Browser](https://github.com/zen-browser/desktop)**, which is built on Firefox. Zen already has vertical tabs, workspaces, split view and compact mode. Custom Browser adds its own name and look, LibreWolf-style privacy defaults, and its own features on top.

Inside the code it is still called Jessnix (`jessnix.exe`, `scripts/jessnix.ps1`, `src/zen/jessnix/`, `prefs/jessnix/`, `jessnix.*` prefs); those names are paths and identifiers, not the product name.

---

## 1. Base decision

| Option | Verdict |
|---|---|
| **Fork of Zen (Firefox)** | **Chosen.** Firefox's whole interface (tab strip, toolbar, menus, sidebars) is HTML/JS/CSS, so changing it rebuilds in seconds (`scripts/jessnix.ps1 ui`) instead of a C++ compile. Zen's vertical tabs, spaces and split view come for free |
| Patch set on ungoogled-chromium | Tried first (tag `chromium-archive`). The interface is C++: every UI change meant a compile, and patches break on every 4-week Chromium release |
| Own project on plain Firefox (surfer) | Same build speed as the Zen fork, but vertical tabs, spaces and split view would all have to be built from scratch |
| Ladybird / Servo / Electron | Too early for daily use, or not a real browser |

How Zen is built: [surfer](https://github.com/zen-browser/surfer) downloads Firefox's source into `engine/`, applies the `.patch` files and copies the files under `src/`, then runs Firefox's build (`mach`). Where Custom Browser came from in Zen is recorded in [docs/jessnix/UPSTREAM.md](docs/jessnix/UPSTREAM.md).

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
Custom-Browser/
├── PLAN.md, README.md, CLAUDE.md
├── surfer.json        name, version, brands (what surfer builds)
├── src/               files copied into Firefox, and *.patch files applied to it
│   └── zen/           Zen's own features (spaces, split-view, compact-mode, ...)
├── prefs/             default preferences (firefox/, zen/, privatefox/, fastfox/)
├── configs/           build config and branding (configs/branding/<brand>/)
├── branding/          Custom Browser's original icon files
├── scripts/           jessnix.ps1 (Windows wrapper) + Zen's scripts
├── docs/jessnix/      Custom Browser notes: upstream, features
└── engine/            Firefox source, downloaded by `init` (not in git)
```

---

## 4. Phases

### Phase 0: First build (goal: plain Zen, built on my machine)
- [x] Install MozillaBuild, sccache, 7-Zip on PATH
- [x] Import Zen 1.24.2b (Firefox 160)
- [x] `scripts/jessnix.ps1 init`: download Firefox and prepare it
- [x] `scripts/jessnix.ps1 build` (29.7 min first time), then `start`: the browser runs

### Phase 1: Rebrand (goal: it says Custom Browser everywhere)
- [x] `surfer.json`: name, app ID and binary `jessnix.exe`, brand names, version 0.1.0, own GitHub repo
- [x] Icons from `branding/` into `configs/branding/release/` (`scripts/jessnix_branding.py`). The source art is 256 px, so the large about-page logo is upscaled; a bigger original would sharpen it
- [x] **Updater off** (`--disable-updater`), so Zen's server can never replace Custom Browser with Zen
- [x] About page, post-update notice and uninstall page link to the project's GitHub; Zen's donate and privacy-policy links removed
- [x] Own profile name `jessnix` and vendor, so it never shares data with Zen or Firefox
- [ ] Wordmark (the name drawn as an image) in the browser's own type: waits for `DESIGN.md`
- [ ] Remaining Zen services: Zen mods store, `share.zen-browser.app` (review in Phase 2)
- [x] Windows installer (`scripts/jessnix.ps1 package`): `dist/Custom-Browser-<version>-setup.exe`, with uBlock Origin inside. Not code-signed yet (SmartScreen warns)

### Phase 2: Privacy defaults (the LibreWolf + Brave layer)
Zen already turns off Mozilla telemetry, studies and crash-report sending (`prefs/privatefox/`). Custom Browser adds, in `prefs/jessnix/privacy.yaml`:
- [x] Enhanced Tracking Protection: strict; HTTPS-Only mode on
- [x] Cookie banners answered with "reject"
- [x] Tracking parameters stripped from links
- [x] Fingerprinting protection (Firefox's, without the site breakage of full resistFingerprinting)
- [x] WebRTC IP-leak protection, cross-site referrers trimmed to the origin
- [ ] Default search: DuckDuckGo (Firefox only lets a policy or its search config change it; decide which)
- [ ] Optional: clear cookies/history on exit, with a per-site keep list (Firefox has per-site "delete on close" already)

**Brave features, and where they come from in Custom Browser.** Crypto (Rewards, Wallet), the paid VPN, Leo AI and Brave News are left out on purpose.

| Brave | Custom Browser |
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
- [x] Release build (`scripts/jessnix.ps1 release`: Zen release settings, thin LTO; 31 min clean). Switching between dev and release clears the old build output (the wrapper does it)
- [x] Faster dev builds: sccache used locally (Zen only turned it on in CI), no debug symbols and no test code in dev builds, `jessnix.ps1 cpp [dir]` for quick C++/Rust rebuilds, and `start` clears the profile's startup cache so `ui` changes show
- [ ] Hebrew language pack and spellcheck included
- [ ] Tab unloading on, hardware video decode confirmed
- [ ] Bookmark/password import from Chrome/Edge works
- [ ] Updates: own update feed from GitHub Releases (Phase 12)
- [ ] Sync: decide between Firefox Sync (Mozilla account) and none

### Phase 4: Custom Browser features (what makes it mine)
Each feature lives in `src/zen/jessnix/` (or its own folder) and gets a note in `docs/jessnix/`.

| Feature | Status |
|---|---|
| Vertical tabs, spaces (Zen "workspaces") | Comes with Zen |
| Split view | Comes with Zen |
| Compact mode, mods/themes store | Comes with Zen |
| **Personalize** (Settings > Look and Feel): each person sets the browser's name, window icon, a background image and the accent color (`src/zen/jessnix/`) | Built |
| **Layout** (in Personalize): size (compact, comfortable, large), corners, light or dark, sidebar left or right, bookmarks bar, button names, always-visible window buttons (`jessnix-look.css`) | Built |
| **App identity**: the Personalize name and icon also rename and re-icon the installed app's Desktop and Start menu shortcuts and taskbar button (`JessnixAppIdentity.mjs`). All-users shortcuts made by the installer need admin rights, so a per-user Start menu shortcut stands in front of them | Built |
| **Tabs on top** as a choice (Personalize > Layout > Tabs): Chrome-style tab row above the address bar, new tabs on the right, the selected tab joined to the address row, window buttons in the tab row, the window dragged by the row's empty space, address bar results dropping down in place (`JessnixTopTabs.mjs`, `jessnix-top-tabs.css`). Zen's single toolbar, collapsed sidebar, floating address bar and compact mode are held off while it's on, and given back after | Built, stage 1 (drag to reorder tabs untested). Stages 2-3: Phase 6 |
| **Browse Together**: browse with friends on a LAN or Radmin/Hamachi/Tailscale, browser to browser with no server. Host a room (found automatically, joined with a code, each guest accepted), shared tabs, follow the host, chat, pointers, Alt+click pings, scroll and video play/pause/seek in step, live tab view. Only page addresses travel, never cookies or logins (`JessnixTogether*.mjs`, `jessnix-together.css`) | Built; tested between two copies on one PC, not yet between two PCs. More: Phase 10 |
| **Custom Browser new tab page**: mascot, clock, search, shortcut tiles, no network requests | To build (Low); becomes the page builder in Phase 8 |
| **Mascot theme**: purple, from the icon, light + dark | To build (Low) |
| **Command palette** (Ctrl+K): tabs, history, bookmarks, settings, actions | To build (Medium), Phase 9 |
| **Game mode**: one toggle to unload background tabs, pause media, free RAM | To build (Medium), Phase 9 |
| **Hebrew / RTL helpers**: quick RTL/LTR toggle for text fields | To build (Low), Phase 9 |
| **Throwaway site profiles**: open a site in a temporary container, wiped on close | To build (Medium, Firefox containers help), Phase 9 |
| **Screenshot + notes panel** | To build (Medium, Firefox has screenshots), Phase 9 |

---

## 5. Roadmap: what comes next

Each phase is usable on its own. Suggested order: **5 → 7 (presets and sharing first) → 8 (per-site styles) → 9 (command palette first) → 11 → 6 → 10 → 12.**

### Phase 5: Lock in what's built
- [ ] Commit the tabs-on-top, Browse Together and build work on a branch
- [ ] Test Browse Together between two real PCs over Radmin: Windows Firewall prompt (allow on private **and** public networks; Radmin's adapter is often "public"), video in step (a guest may need to click a video once before synced play works)
- [ ] Test drag to reorder tabs in the tab row with a real mouse
- [ ] Installer for friends: `jessnix.ps1 release`, then `package`
- [ ] Write `DESIGN.md` (identity, palette, type, mood): the rules in section 6 need it before more UI

### Phase 6: Finish tabs on top
- [ ] **Stage 2:** pinned and Essentials tabs as small icon tabs at the start of the row; a space switcher button; folders shown as Chrome-style tab groups
- [ ] **Stage 3:** an auto-hiding tab row as the top-tabs version of compact mode; Chrome-style tab right-click menu; many tabs: shrink to icons, then scroll
- [ ] Top / side switch in the tab row's right-click menu

### Phase 7: Personalize 2.0 (the customization core)
- [ ] **Look presets:** save the whole look (Personalize + Layout) as "Work", "Gaming" and so on, and switch in one click
- [ ] **Share a look:** export a preset as a file or a short code, and import a friend's
- [ ] **Accent from wallpaper:** a chosen background image offers its main colours as the accent
- [ ] **Light/dark schedule:** by time of day, or following Windows
- [ ] **Fonts and UI size:** the browser's own font and text size, separate from page zoom
- [ ] **Tab style:** height, rounded or square, favicon-only tabs, when the close button shows
- [ ] **See-through window:** a Windows 11 Mica / blur slider behind the toolbars
- [ ] **Reset and undo:** reset each section, undo the last look change

### Phase 8: Make it yours per site and per space
- [ ] **Per-space look:** each space has its own background, accent and font
- [ ] **Per-site styles:** force dark mode on any site; your own CSS per site (a built-in Stylus); remembered zoom and font per site
- [ ] **New tab page builder:** clock, search, shortcut tiles, notes and background, arranged by dragging (grows from the Phase 4 new tab page)
- [ ] **Address bar at the bottom** as a layout choice

### Phase 9: Power features
- [ ] **Command palette (Ctrl+K):** tabs, history, bookmarks, settings and actions in one box
- [ ] **Shortcut editor:** rebind any shortcut, with clashes flagged
- [ ] **Game mode:** unload background tabs, pause media, free RAM; optionally a minimal look while on
- [ ] **Throwaway site profiles:** a site in its own container, wiped on close
- [ ] **Screenshot + notes panel**
- [ ] **Hebrew / RTL helpers:** RTL/LTR toggle for text boxes, Hebrew language pack and spellcheck

### Phase 10: Browse Together 2.0
- [ ] **Voice chat** in a room (WebRTC, still browser to browser)
- [ ] **Watch party mode:** host-controlled video, a "ready?" check before play
- [ ] **Shared board:** a room's own to-do list and bookmarks
- [ ] **Remember friends:** rejoin the last room, saved friends' addresses
- [ ] **Hand over control:** the host lets a guest drive
- [ ] Translate its texts into the Fluent string files (they are written in English in the code for now)

### Phase 11: Chrome extensions support
Firefox already runs Chrome's extension format (WebExtensions, with the `chrome.*` names), and this build accepts unsigned add-ons (`MOZ_REQUIRE_SIGNING` is empty), so many Chrome extensions can run once repackaged.
- [ ] **Add from Chrome Web Store:** an "Add to Custom Browser" button on Web Store pages; the browser downloads the `.crx` from Google's update service, takes the zip out of it, shows the permission prompt and installs
- [ ] **Automatic conversion:** add the Firefox extension ID (`browser_specific_settings.gecko.id`), turn a background service worker into a background script, drop or replace keys Firefox doesn't know
- [ ] **Missing Chrome APIs:** a small compatibility layer (for example `chrome.sidePanel` to Firefox's sidebar, `chrome.offscreen`), and a list of what each extension uses that has no stand-in
- [ ] **Compatibility check** before installing: works / partly works (and which features don't) / won't work; a list of known-good popular extensions
- [ ] **Updates:** converted extensions check the Web Store for new versions and convert them again
- Won't work: extensions built on Chrome-only internals, ones checking for a Google-signed Chrome, DRM-related ones
- Security: converted extensions skip Mozilla's review, so the permission prompt must be clear and they are marked "from Chrome Web Store" in the add-ons page
- Terms: other browsers (Opera, Kiwi) do this, but it sits in a grey area of the Web Store's terms; it stays a personal-use feature, not one advertised

### Phase 12: Shipping
- [ ] **Updates** from GitHub Releases, so installs update themselves
- [ ] **Code signing,** so Windows SmartScreen stops warning
- [ ] **Settings sync** across my own PCs: export/import first, sync later
- [ ] Linux build
- [ ] Release automation on a self-hosted runner (my PC)

---

## 6. Rules for UI work

Every Custom Browser UI surface (new tab page, theme, panels, settings) goes through **anti-slop** ([miqdadbadjuber/anti-slop](https://github.com/miqdadbadjuber/anti-slop)):
1. Install it in this repo by running `npx antislop-ai` myself
2. Before any UI is built, I write `DESIGN.md`: identity, personality, palette, typography, mood. anti-slop is a filter, not a source of taste, so the direction has to come from me
3. Every visual choice has a written reason. If a screen would look the same with the Custom Browser name swapped out, it gets redone

---

## 7. Keeping up with Zen and Firefox

Firefox ships a new version every 4 weeks, with security fixes in between, and Zen follows within days. A daily-use browser has to follow:
- Take each new Zen release with the steps in [docs/jessnix/UPSTREAM.md](docs/jessnix/UPSTREAM.md)
- Keep Custom Browser changes in their own files where possible (`src/zen/jessnix/`, `prefs/jessnix/`), so Zen updates rarely conflict
- Never ship more than one Firefox version behind: old engines mean known security holes
- Changing a Zen `.patch` file: reset that one file in `engine/` first (`git -C engine checkout -- <file>`), then `import`, or the new patch won't apply over the old one
