# Jessnix Browser

Chromium-based browser built as a patch set on ungoogled-chromium. Roadmap: `PLAN.md`.

- Never edit Chromium source directly; every change is a patch in `patches/`, listed in `patches/series`.
  Two things patches can't carry well are done by `scripts/jessnix_apply.py` instead: images (listed in `branding/assets.txt`) and the product-name rename across the strings files and their translations.
- One feature per patch, so moving to a new Chromium version stays cheap.
- UI work (new tab page, theme, settings, panels) follows anti-slop. Direction comes from `DESIGN.md`, written by the owner. If it doesn't exist yet, ask before building UI.
