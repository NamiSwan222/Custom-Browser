<p align="center"><img src="branding/png/icon_128.png" width="96" alt="Jessnix icon"></p>

# Jessnix Browser

A fast, private browser for daily use, with features of its own.

Jessnix is a fork of [Zen Browser](https://github.com/zen-browser/desktop), which is built on Firefox: vertical tabs, spaces and split view from Zen, LibreWolf-style privacy defaults, and Jessnix's own look and features on top.

**Status:** early. See [PLAN.md](PLAN.md) for the roadmap.

## Building on Windows

Needs MozillaBuild, Git, Node.js, Python, Rust, sccache and 7-Zip (details in PLAN.md), in a folder path without spaces.

```powershell
npm i
.\scripts\jessnix.ps1 init    # first time: downloads Firefox (~1 GB) and prepares it
.\scripts\jessnix.ps1 build   # full build
.\scripts\jessnix.ps1 start   # run it
.\scripts\jessnix.ps1 ui      # after changing only JS/CSS/HTML: fast rebuild
```

## License

Two licences, by file:

- **MIT** ([LICENSE-MIT](LICENSE-MIT)): Jessnix's own files, each marked `SPDX-License-Identifier: MIT` at the top: `src/zen/jessnix/`, `prefs/jessnix/`, the Personalize settings page and its text, and the `scripts/jessnix*` / `fetch_ublock.py` / `jessnix_branding.py` scripts.
- **MPL-2.0** ([LICENSE](LICENSE)): everything that comes from Zen and Firefox, including Jessnix's edits inside those files. The MPL requires that these files stay under the MPL. Zen's code is by the Zen OSS Team.

uBlock Origin is downloaded at build time and is GPL-3.0; it is not stored in this repository.
