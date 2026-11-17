<p align="center"><img src="branding/png/icon_128.png" width="96" alt="Jessnix icon"></p>

# Jessnix Browser

A fast, private browser for daily use, with features of its own.

Jessnix is a fork of [Zen Browser](https://github.com/zen-browser/desktop), which is built on Firefox: vertical tabs, spaces and split view from Zen, LibreWolf-style privacy defaults, and Jessnix's own look and features on top.

**Status:** early. See [PLAN.md](PLAN.md) for the roadmap.

## Install (Windows 10/11, 64-bit)

Download `Custom-Browser-<version>-setup.exe` from [Releases](https://github.com/NamiSwan222/Custom-Browser/releases) and run it. The installer isn't code-signed yet, so Windows SmartScreen may say it "protected your PC": choose **More info**, then **Run anyway**.

Jessnix doesn't update itself yet: install a newer release over the old one. Your profile (logins, bookmarks, settings) is kept.

What you get: uBlock Origin built in, strict tracking protection and HTTPS-only, saved logins, a bookmarks bar, and **Settings > Look and Feel > Personalize** to set your own browser name, icon, background, size, corners and colours.

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
```

## License

Two licences, by file:

- **MIT** ([LICENSE-MIT](LICENSE-MIT)): Jessnix's own files, each marked `SPDX-License-Identifier: MIT` at the top: `src/zen/jessnix/`, `prefs/jessnix/`, the Personalize settings page and its text, and the `scripts/jessnix*` / `fetch_ublock.py` / `jessnix_branding.py` scripts.
- **MPL-2.0** ([LICENSE](LICENSE)): everything that comes from Zen and Firefox, including Jessnix's edits inside those files. The MPL requires that these files stay under the MPL. Zen's code is by the Zen OSS Team.

uBlock Origin is downloaded at build time and is GPL-3.0; it is not stored in this repository.
