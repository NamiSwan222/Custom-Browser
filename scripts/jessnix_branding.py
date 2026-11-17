# SPDX-License-Identifier: MIT
# Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.
"""Builds Jessnix's branding images for surfer from the icon in branding/.

Writes configs/branding/release/, the folder surfer turns into Firefox's branding
(app and file icons, Start menu tiles, about-page logos, installer art). Run it
again after changing the icon:

    python scripts/jessnix_branding.py

The wordmarks (the product name drawn as an image) are plain text in the system
font until DESIGN.md sets the real type. firefox.icns and MacOSInstaller.svg are
macOS-only and still Zen's.
"""

import base64
import io
import json
import shutil
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / 'branding'
OUT = REPO / 'configs/branding/release'

# The icon's own deep purple, behind Start menu tiles and the installer art.
DEEP_PURPLE = (0x4C, 0x18, 0x63)
NIGHT = (0x16, 0x06, 0x1D)

ICON = Image.open(SRC / 'png/icon_256.png').convert('RGBA')


def sized(size: int) -> Image.Image:
    """The icon at `size` px: the drawn PNG when there is one, else resized.

    The source art is 256 px, so the 512 and 1024 px files are upscaled and a
    little soft; a larger original would sharpen the about-page logo.
    """
    own = SRC / f'png/icon_{size}.png'
    if own.exists():
        return Image.open(own).convert('RGBA')
    return ICON.resize((size, size), Image.LANCZOS)


def on_canvas(size: int, share: float, background=None) -> Image.Image:
    """The icon centred on a square canvas, filling `share` of its width."""
    canvas = Image.new('RGBA', (size, size), background + (255,) if background else (0, 0, 0, 0))
    inner = round(size * share)
    icon = sized(inner) if inner in (16, 24, 32, 48, 64, 128, 256) else ICON.resize((inner, inner), Image.LANCZOS)
    canvas.alpha_composite(icon, ((size - inner) // 2, (size - inner) // 2))
    return canvas


def png_svg(size: int) -> str:
    """An SVG that shows the icon (Firefox loads some logos only as SVG)."""
    buf = io.BytesIO()
    sized(size).save(buf, 'PNG')
    data = base64.b64encode(buf.getvalue()).decode()
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
            f'viewBox="0 0 {size} {size}"><image width="{size}" height="{size}" '
            f'href="data:image/png;base64,{data}"/></svg>\n')


def brand_name() -> str:
    """The product name people see (surfer.json, release brand)."""
    surfer = json.loads((REPO / 'surfer.json').read_text(encoding='utf-8'))
    return surfer['brands']['release']['brandShortName']


def wordmark(width: int, fill: str) -> str:
    # Placeholder type: system font until DESIGN.md picks one. The viewBox
    # grows with the name (about 22px per character at 40px Segoe UI).
    name = brand_name()
    width = max(width, 24 * len(name))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 56">'
            f'<text x="0" y="42" font-family="Segoe UI, system-ui, sans-serif" '
            f'font-size="40" font-weight="600" fill="{fill}">{name}</text></svg>\n')


def main() -> None:
    content = OUT / 'content'
    for size in (16, 22, 24, 32, 48, 64, 128, 256, 512, 1024):
        sized(size).save(OUT / f'logo{size}.png')
    sized(1024).save(OUT / 'logo.png')
    sized(1024).save(OUT / 'logo-mac.png')

    for name in ('firefox.ico', 'firefox64.ico', 'document.ico', 'document_pdf.ico', 'pbmode.ico'):
        shutil.copyfile(SRC / 'jessnix.ico', OUT / name)

    # Start menu tiles: Windows draws them on the tile colour from surfer.json.
    on_canvas(600, 0.66).save(OUT / 'VisualElements_150.png')
    on_canvas(280, 0.66).save(OUT / 'VisualElements_70.png')
    on_canvas(270, 0.8).save(OUT / 'PrivateBrowsing_150.png')
    on_canvas(126, 0.8).save(OUT / 'PrivateBrowsing_70.png')

    # Installer side panel, 164 x 314.
    panel = Image.new('RGBA', (164, 314), NIGHT + (255,))
    panel.alpha_composite(sized(128), (18, 93))
    panel.convert('RGB').save(OUT / 'wizWatermark.bmp')

    sized(512).save(content / 'about-logo.png')
    sized(1024).save(content / 'about-logo@2x.png')
    sized(256).resize((192, 192), Image.LANCZOS).save(content / 'about-logo-private.png')
    sized(512).resize((384, 384), Image.LANCZOS).save(content / 'about-logo-private@2x.png')
    (content / 'about-logo.svg').write_text(png_svg(256), encoding='utf-8')
    (content / 'about-logo-private.svg').write_text(png_svg(256), encoding='utf-8')
    (content / 'about-wordmark.svg').write_text(wordmark(180, '#fff'), encoding='utf-8')
    (content / 'firefox-wordmark.svg').write_text(wordmark(180, 'context-fill #20123a'), encoding='utf-8')
    print(f'Branding written to {OUT}')


if __name__ == '__main__':
    main()
