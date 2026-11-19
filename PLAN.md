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
- [ ] ✋ Wordmark (the name drawn as an image) in the browser's own type: waits for the owner's `DESIGN.md`
- [x] Remaining Zen services reviewed, both kept: the mods store only downloads `theme.json` of installed mods from `zen-browser.github.io` (every 20 days; nothing sent), and the store page at `zen-browser.app` can install mods only when opened. `share.zen-browser.app` is contacted only when the owner shares something. Zen's donate button in the Library footer removed
- [x] Windows installer (`scripts/jessnix.ps1 package`): `dist/Custom-Browser-<version>-setup.exe`, with uBlock Origin inside. Not code-signed yet (SmartScreen warns)

### Phase 2: Privacy defaults (the LibreWolf + Brave layer)
Zen already turns off Mozilla telemetry, studies and crash-report sending (`prefs/privatefox/`). Custom Browser adds, in `prefs/jessnix/privacy.yaml`:
- [x] Enhanced Tracking Protection: strict; HTTPS-Only mode on
- [x] Cookie banners answered with "reject"
- [x] Tracking parameters stripped from links
- [x] Fingerprinting protection (Firefox's, without the site breakage of full resistFingerprinting)
- [x] WebRTC IP-leak protection, cross-site referrers trimmed to the origin
- [x] Default search: DuckDuckGo, chosen once on a profile's first run (normal and private windows); picking another engine afterwards sticks (`JessnixUpdates.mjs`, pref `jessnix.search.default-set`)
- [x] Clear on exit with a keep list: Firefox's own Settings > Privacy > "Delete cookies and site data when Custom Browser is closed" plus Manage Exceptions (allow) does exactly this; nothing extra built. Off by default, since logins stay remembered

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
- [x] Hebrew language pack and spellcheck included (`scripts/fetch_hebrew.py`)
- [x] Tab unloading on low memory (on by default, also set in `daily.yaml`); hardware video decode on (checked on an RTX 3080 in about:support)
- [x] Import from Chrome/Edge (File > Import): finds both profiles; Edge offers passwords and history. Chrome 127+ encrypts passwords so only Chrome itself can read them: export them from Chrome as a CSV and import that file (Passwords page > ⋯ > Import from a file)
- [x] Updates: from GitHub Releases (Phase 12)
- [ ] ✋ Sync: the owner decides between Firefox Sync (Mozilla account, works today from the account menu) and turning it off

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
| **Custom Browser new tab page**: clock, search, shortcut tiles, notes, arranged by the person, no network requests | Built (Phase 8) |
| **Mascot theme**: purple, from the icon, light + dark | To build (Low); waits for the owner's DESIGN.md |
| **Command palette** (Ctrl+K): tabs, history, bookmarks, settings, actions | Built (Phase 9) |
| **Game mode**: one toggle to unload background tabs, pause media, free RAM | Built (Phase 9) |
| **Hebrew / RTL helpers**: quick RTL/LTR toggle for text fields | Built (Firefox's, switched on; Phase 9) |
| **Throwaway site profiles**: open a site in a temporary container, wiped on close | Built (Phase 9) |
| **Screenshot + notes panel** | Built (Phase 9) |

---

## 5. Roadmap: what comes next

Each phase is usable on its own. ✋ marks what needs the owner (a test on real hardware, an account, a certificate or a decision).

### Phase 5: Lock in what's built
- [x] Commit the tabs-on-top, Browse Together and build work on a branch (`custom-browser-features`)
- [ ] ✋ Test Browse Together between two real PCs over Radmin: Windows Firewall prompt (allow on private **and** public networks; Radmin's adapter is often "public"), video in step (a guest may need to click a video once before synced play works). Tested between two copies on one PC, over the Radmin address
- [ ] ✋ Test drag to reorder tabs in the tab row with a real mouse (automated drags can't finish a native drag)
- [x] Installer for friends: `jessnix.ps1 release`, then `package`
- [x] `DESIGN.md`: a **draft** from the globe icon's colours, for the owner to rewrite (section 6 says the direction is the owner's)

### Phase 6: Finish tabs on top
- [x] **Stage 2:** pinned and Essentials tabs as small icon tabs at the start of the row; Zen's space switcher dots in the row; folders as Chrome-style tab groups (a tinted chip, its tabs beside it, collapsed = chip only)
- [x] **Stage 3:** compact mode with tabs on top is an auto-hiding tab row (a 4px strip, slides down when pointed at); Firefox's tab right-click menu; many tabs shrink to icons, then the row scrolls
- [x] "Tabs on top" in the tab row's and the tabs' right-click menus

### Phase 7: Personalize 2.0 (the customization core)
- [x] **Look presets:** save the whole look as "Work", "Gaming" and so on, switch in one click (`JessnixLooks.sys.mjs`, Settings > Personalize > Saved looks; also in the command palette)
- [x] **Share a look:** a `.cblook` file with the images inside, or a short `CB1-…` code without them
- [x] **Accent from wallpaper:** the background image's main colours offered as accent swatches
- [x] **Light/dark schedule:** by time of day (following Windows was already Zen's "auto")
- [x] **Fonts and UI size:** the browser's own font (any installed) and text size
- [x] **Tab style:** height, rounded/square/pill, icon-only tabs, close button on hover/always/never
- [x] **See-through window:** off / a little / medium / a lot, letting Windows 11's Mica show behind the toolbars (✋ not visible in a hidden test window: check it on screen)
- [x] **Reset and undo:** undo the last look change; reset layout and tabs, colours and window, or everything

### Phase 8: Make it yours per site and per space
- [x] **Per-space look:** a background and a font for one space (the space's right-click menu); Zen already gives each space its own colours
- [x] **Per-site styles:** Zen's Boosts already store per-site colours, dark mode, fonts, hidden page parts and custom CSS; the page's right-click menu now has "Dark mode for this site" and "Style this site…". Firefox remembers zoom per site
- [x] **New tab page:** Custom Browser's own (`jessnix-newtab.html`): clock, search with the default engine, shortcut tiles, notes; Edit to drag widgets around and show or hide them; no network requests
- [x] **Address bar at the bottom** (Personalize > Layout); its results open upwards

### Phase 9: Power features
- [x] **Command palette (Ctrl+K):** open tabs, bookmarks, history, settings pages, saved looks and actions (`JessnixPower.mjs`)
- [x] **Shortcut editor:** already Firefox/Zen's `about:keyboard` (Settings > Keyboard Shortcuts), in the palette
- [x] **Game mode:** background tabs unloaded and paused, memory freed, compact mode on; off puts compact mode back
- [x] **Throwaway tabs:** "Open link in a throwaway tab" and a palette action; each in its own temporary container, deleted with everything it stored when its last tab closes
- [x] **Screenshot + notes:** Firefox's screenshot in the palette; a notes panel per site
- [x] **RTL/LTR:** Firefox's "Switch Text Direction" in text box menus (on), Ctrl+Shift+X, and in the palette
- [x] Hebrew language pack and spellcheck: bundled like uBlock Origin (`scripts/fetch_hebrew.py`, pinned checksums; Mozilla-signed): the Firefox 160.0 language pack (Settings > General > Language) and the HSpell dictionary. Tested: both install, Hebrew is offered as a language and for spellcheck. On a Firefox update, update the language pack in that script

### Phase 10: Browse Together 2.0
- [x] **Voice chat:** the microphone as 16 kHz samples over the room's own connection, played with Web Audio (no WebRTC: nothing to discover through VPNs; streamed media playback in the browser's own process crashed it)
- [x] **Watch party:** "Only I control videos", a ready check with a count, "Play for everyone"
- [x] **Shared board:** the room's to-dos and links
- [x] **Remember friends:** rejoin the last room, saved friends, "Keep the same room code" for hosts
- [x] **Hand over control:** "Let drive": the driver's tab choice and scrolling lead the room
- [x] Its texts are in `locales/en-US/browser/browser/jessnix-together.ftl`

### Phase 11: Chrome extensions support
Firefox already runs Chrome's extension format (WebExtensions, with the `chrome.*` names), so many Chrome extensions run once repackaged (`JessnixChromeExtensions.sys.mjs`, `JessnixChromeStore.mjs`).
- [x] **Add from Chrome Web Store:** an "Add to Custom Browser" bar on Web Store pages; downloads the `.crx` from Google's update service, unwraps it, then Firefox's own permission prompt
- [x] **Automatic conversion:** Firefox extension id, service worker as background scripts, side panel as a sidebar, keys and permissions Firefox doesn't know removed, marked "From the Chrome Web Store"
- [x] **Missing Chrome APIs:** a compatibility script (sidePanel, offscreen, importScripts); the report lists what has no stand-in
- [x] **Compatibility check** before installing: works / partly (which features don't) / won't; a few known-good extensions named
- [x] **Updates:** checked against the Web Store once a day, converted and installed again when newer
- Tested: Dark Reader converted, installed and darkening pages
- Signing: Mozilla can't sign converted extensions, so the first install asks to allow unsigned add-ons (`xpinstall.signatures.required`); Firefox still asks before every install
- Terms: other browsers (Opera, Kiwi) do this, but it sits in a grey area of the Web Store's terms; it stays a personal-use feature, not one advertised

### Phase 12: Shipping
- [x] **Updates** from GitHub Releases: a daily check of `jessnix.update.repo`; a bar offers to download and run the installer (asking first)
- [ ] ✋ **Code signing:** `jessnix.ps1 package` signs the installer when `JESSNIX_SIGN_CERT` points at a code-signing certificate (.pfx); buying one is the owner's
- [x] **Settings backup:** Settings > Personalize > "Back up all my settings" / "Restore settings": every setting, saved looks and images in one `.cbsettings` file. Live sync between PCs is later
- [ ] ✋ **Linux build:** `scripts/jessnix.sh` (init, build, ui, cpp, release, package, start); needs a Linux machine (this PC has no WSL Linux installed) to run and test
- [ ] ✋ **Release automation:** `.github/workflows/release.yml` for a self-hosted Windows runner (release build, installer, optional signing, GitHub release); registering the runner on the owner's PC is the owner's

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
