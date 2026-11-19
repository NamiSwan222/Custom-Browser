# SPDX-License-Identifier: MIT
# Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.
"""Downloads the Hebrew language pack and spell-checking dictionary to bundle.

Like fetch_ublock.py: the .xpi files go to src/browser/app/distribution/extensions/,
which surfer copies into Firefox's source; Firefox installs them into each new
profile on first run. Both are Mozilla-signed:
- the Firefox 160.0 Hebrew language pack (Settings > General > Language),
- the Hebrew dictionary from HSpell (right-click a text box > Languages).

The language pack must match the Firefox version in surfer.json: on a Firefox
update, change LANGPACK_URL and its SHA256 (from archive.mozilla.org).
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

DOWNLOADS = [
    {
        "name": "Hebrew language pack 160.0",
        "id": "langpack-he@firefox.mozilla.org",
        "url": "https://archive.mozilla.org/pub/firefox/releases/160.0/win64/xpi/he.xpi",
        "sha256": "ae1bf4fb618abdc93ca475d1d6f3095be332696e53f458044282b76d0ab75730",
    },
    {
        "name": "Hebrew spell-checking dictionary 1.4.2",
        "id": "he@dictionaries.addons.mozilla.org",
        "url": "https://addons.mozilla.org/firefox/downloads/file/4270213/hebrew_spell_checking_dictiona-1.4.2resigned1.xpi",
        "sha256": "25cdee788f3900247fb2afa948c2a76b4c92d280fab8b5c1e95376c621d92c24",
    },
]

REPO = Path(__file__).resolve().parent.parent
FOLDER = REPO / "src/browser/app/distribution/extensions"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    FOLDER.mkdir(parents=True, exist_ok=True)
    for item in DOWNLOADS:
        target = FOLDER / f"{item['id']}.xpi"
        if target.exists() and sha256(target.read_bytes()) == item["sha256"]:
            print(f"{item['name']}: already present")
            continue
        with urllib.request.urlopen(item["url"], timeout=60) as response:
            data = response.read()
        if sha256(data) != item["sha256"]:
            sys.exit(f"{item['name']}: download does not match the pinned checksum: {item['url']}")
        target.write_bytes(data)
        print(f"{item['name']}: downloaded to {target.relative_to(REPO)}")


if __name__ == "__main__":
    main()
