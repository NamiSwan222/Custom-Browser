"""Downloads the pinned uBlock Origin release for bundling with Jessnix.

The .xpi goes to src/browser/app/distribution/extensions/, which surfer copies into
Firefox's source; Firefox installs extensions found there into each new profile on
first run. After that, uBlock Origin updates itself from addons.mozilla.org.

To move to a newer release, update VERSION, URL and SHA256 from:
https://addons.mozilla.org/api/v5/addons/addon/ublock-origin/
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

ADDON_ID = 'uBlock0@raymondhill.net'
VERSION = '1.76.4'
URL = 'https://addons.mozilla.org/firefox/downloads/file/5257481/ublock_origin-1.76.4.xpi'
SHA256 = '66d0e3f21ce3b32b1bc0a9399b93cb2c9aa598ef18805d92118c76f66e266c1e'

REPO = Path(__file__).resolve().parent.parent
TARGET = REPO / 'src/browser/app/distribution/extensions' / f'{ADDON_ID}.xpi'


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    if TARGET.exists() and sha256(TARGET.read_bytes()) == SHA256:
        print(f'uBlock Origin {VERSION}: already present')
        return
    with urllib.request.urlopen(URL, timeout=60) as response:
        data = response.read()
    if sha256(data) != SHA256:
        sys.exit(f'uBlock Origin download does not match the pinned checksum: {URL}')
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_bytes(data)
    print(f'uBlock Origin {VERSION}: downloaded to {TARGET.relative_to(REPO)}')


if __name__ == '__main__':
    main()
