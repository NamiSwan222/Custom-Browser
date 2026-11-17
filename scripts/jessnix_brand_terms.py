# SPDX-License-Identifier: MIT
# Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.
"""Adds the brand names surfer's branding template leaves out.

surfer writes engine/browser/branding/<brand>/locales/en-US/brand.ftl from a
template that has no -brand-shortcut-name (Firefox uses it to name the
"<name> Private Browsing" shortcut it makes) and sets -brand-product-name to
surfer.json's internal "name". Run after `npm run import` (jessnix.ps1 does).
"""

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def main() -> None:
    surfer = json.loads((REPO / 'surfer.json').read_text(encoding='utf-8'))
    for brand, config in surfer['brands'].items():
        ftl = REPO / 'engine' / 'browser' / 'branding' / brand / 'locales' / 'en-US' / 'brand.ftl'
        if not ftl.exists():
            continue
        text = ftl.read_text(encoding='utf-8')
        name = config['brandShortName']
        text = re.sub(r'(?m)^-brand-product-name = .*$', f'-brand-product-name = {name}', text)
        if not re.search(r'(?m)^-brand-shortcut-name = ', text):
            text = text.replace('-brand-short-name = ', f'-brand-shortcut-name = {name}\n-brand-short-name = ', 1)
        ftl.write_text(text, encoding='utf-8', newline='\n')
        print(f'{ftl.relative_to(REPO)}: shortcut and product name "{name}"')


if __name__ == '__main__':
    main()
