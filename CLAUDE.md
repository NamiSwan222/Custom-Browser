# Jessnix Browser

Firefox-based browser, a fork of Zen Browser. Roadmap: `PLAN.md`. Where the Zen code came from and how to take newer Zen releases: `docs/jessnix/UPSTREAM.md`.

- Never edit `engine/` (the downloaded Firefox source) directly: changes go in `src/` (files copied in, or `.patch` files) and `prefs/`, which surfer applies. `npm run export` turns an `engine/` edit into a patch.
- Keep Jessnix changes in their own files where possible (`src/zen/jessnix/`, `prefs/jessnix/`), so taking a newer Zen release rarely conflicts.
- Run build steps through `scripts/jessnix.ps1` on Windows: it sets up PATH for surfer and logs to `.logs/`.
- The Firefox source (`engine/`) must sit in a path without spaces (Firefox's build refuses). When the repo path has one, make `engine/` a junction to a folder without spaces.
- UI work (new tab page, theme, settings, panels) follows anti-slop. Direction comes from `DESIGN.md`, written by the owner. If it doesn't exist yet, ask before building UI.
