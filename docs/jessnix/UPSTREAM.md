# Upstream: Zen Browser

Jessnix is a fork of [Zen Browser](https://github.com/zen-browser/desktop) (MPL-2.0), which is itself built on Firefox.

| | |
|---|---|
| Zen release | `1.24.2b` |
| Zen commit | `0057b29` (tag `1.24.2b`, branch `stable`) |
| Firefox | 160.0 (from `surfer.json`) |
| Imported | 2026-11-17 |

The Zen code was copied in as a snapshot, not merged with its git history (that history is about 6 GB). Left out of the import: Zen's `.github/` (their CI and release workflows, which would run against this repo), `README.md`, `CODEOWNERS`, `crowdin.yml`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.

## Taking a newer Zen release

Apply the difference between the Zen release recorded above and the new one, so Jessnix's own changes stay in place:

```bash
git clone --filter=blob:none --no-checkout https://github.com/zen-browser/desktop.git /tmp/zen
cd /tmp/zen && git fetch --depth 1 origin tag <old> tag <new>
git diff <old> <new> -- . ':!.github' ':!README.md' > /tmp/zen-update.diff
cd <this repo> && git apply -3 /tmp/zen-update.diff
```

Then fix any conflicts, update the table above, rebuild and test.

## Zen files Jessnix changes

These are the places a Zen update can conflict. Everything else Jessnix adds lives in its own files.

| File | Jessnix change |
|---|---|
| `surfer.json` | name, app ID, binary `jessnix`, brand names, version, own GitHub repo, no update host; Zen's "twilight" brand removed |
| `configs/common/mozconfig` | app basename, distribution ID, source repo, `--disable-updater` |
| `configs/branding/release/` | all images (made by `scripts/jessnix_branding.py`); `configs/branding/twilight/` removed |
| `src/toolkit/moz-configure.patch` | vendor `Jessnix`, profile `jessnix`, distribution ID |
| `src/zen/about/zen-about.inc.xhtml` | GitHub and issue links; donate and privacy-policy links removed |
| `src/zen/common/modules/ZenUpdates.mjs` | donate link removed from the post-update notice |
| `src/browser/installer/windows/nsis/uninstaller-nsi.patch` | uninstall page points to Jessnix's issues |
| `src/browser/installer/package-manifest-in.patch` | packages `distribution/extensions/` (bundled uBlock Origin); Firefox packs it only in Mozilla's own builds |
| `src/zen/common/styles/zen-omnibox.css` | bookmark star shown unless `jessnix.urlbar.show-bookmark-star` is off |
| `prefs/zen/view.yaml`, `prefs/firefox/browser.yaml` | window buttons always shown; bookmarks bar on every page |

## Changing a `.patch` file

surfer re-applies a changed patch on top of the already patched file, which fails. Restore the target file to Firefox's version first, then import:

```powershell
git -C engine checkout -- <path the patch changes>
.\scripts\jessnix.ps1 import
```
