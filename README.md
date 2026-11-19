<p align="center"><img src="branding/png/icon_128.png" width="96" alt="Custom Browser icon"></p>

# Jessnix Browser

A fast, private browser for daily use, with features of its own.

Jessnix is a fork of [Zen Browser](https://github.com/zen-browser/desktop), which is built on Firefox: vertical tabs, spaces and split view from Zen, LibreWolf-style privacy defaults, and Jessnix's own look and features on top.

**Status:** early. See [PLAN.md](PLAN.md) for the roadmap.

## Install (Windows 10/11, 64-bit)

Download `Custom-Browser-<version>-setup.exe` from [Releases](https://github.com/NamiSwan222/Custom-Browser/releases) and run it. The installer isn't code-signed yet, so Windows SmartScreen may say it "protected your PC": choose **More info**, then **Run anyway**.

From 0.2.0 it checks GitHub once a day and offers new versions; installing over the old one keeps your profile (logins, bookmarks, settings).

What you get:
- **Private by default:** uBlock Origin built in, strict tracking protection, HTTPS-only, saved logins, a bookmarks bar.
- **Tabs on top or in a sidebar** (Settings > Look and Feel > Personalize > Layout, or right-click the tab row).
- **Personalize:** your own browser name, icon, background, colours (or colours from your background), font and size, tab style, a see-through window, light/dark by time of day, the address bar at the bottom. Save looks ("Work", "Gaming"), share them as a file or a code, undo, reset, and back up all settings to a file.
- **Per site and per space:** "Dark mode for this site" and "Style this site…" in the page's right-click menu; a background and font for each space.
- **New tab page:** clock, search, shortcuts and notes; Edit to arrange them.
- **Command palette (Ctrl+K):** tabs, bookmarks, history, settings, looks and actions.
- **Game mode, throwaway tabs** (a site in a temporary container, wiped on close) and **notes per site**.
- **Browse Together:** browse with friends on the same network or Radmin VPN: shared tabs, follow, chat, voice, pointers, a watch party, a shared board, a live tab view. Only page addresses are shared, never logins.
- **Chrome extensions:** on a Chrome Web Store page, "Add to Custom Browser" converts the extension, says what will work, and installs it.

## Building on Windows

Needs MozillaBuild, Git, Node.js, Python, Rust, sccache and 7-Zip (details in PLAN.md), in a folder path without spaces.

```powershell
npm i
.\scripts\jessnix.ps1 init    # first time: downloads Firefox (~1 GB) and prepares it
.\scripts\jessnix.ps1 build   # full build
.\scripts\jessnix.ps1 start   # run it
.\scripts\jessnix.ps1 ui      # after changing only JS/CSS/HTML: fast rebuild
.\scripts\jessnix.ps1 release # optimized build for sharing (~30 min on 32 threads)
.\scripts\jessnix.ps1 package # installer: dist\Custom-Browser-<version>-setup.exe
.\scripts\jessnix.ps1 cpp     # after changing C++/Rust: quick rebuild
```

Signing: set `JESSNIX_SIGN_CERT` (a .pfx code-signing certificate) and `JESSNIX_SIGN_PASSWORD` before `package`. Releases can also be built by `.github/workflows/release.yml` on a self-hosted Windows runner.

## Building on Linux

`./scripts/jessnix.sh` takes the same steps (`init`, `build`, `ui`, `cpp`, `release`, `package`, `start`). Not yet tested on a Linux machine.

## License

Two licences, by file:

- **MIT** ([LICENSE-MIT](LICENSE-MIT)): Jessnix's own files, each marked `SPDX-License-Identifier: MIT` at the top: `src/zen/jessnix/`, `prefs/jessnix/`, the Personalize settings page and its text, and the `scripts/jessnix*` / `fetch_ublock.py` / `jessnix_branding.py` scripts.
- **MPL-2.0** ([LICENSE](LICENSE)): everything that comes from Zen and Firefox, including Jessnix's edits inside those files. The MPL requires that these files stay under the MPL. Zen's code is by the Zen OSS Team.

uBlock Origin is downloaded at build time and is GPL-3.0; it is not stored in this repository.
