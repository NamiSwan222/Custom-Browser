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
