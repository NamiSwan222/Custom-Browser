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

[MPL-2.0](LICENSE), like Zen and Firefox. Zen's code is by the Zen OSS Team.
