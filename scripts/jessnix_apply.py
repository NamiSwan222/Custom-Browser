"""Turns a prepared ungoogled-chromium source tree into Jessnix.

Runs after ungoogled-chromium's own patches and domain substitution, before the
compile. Every step checks what is already done, so running it twice is safe.

  1. patches/series     source patches, applied with the patch.exe Chromium ships
  2. branding/assets.txt  images copied over Chromium's own
  3. product name       "Chromium" becomes "Jessnix" in the browser's text, with
                        every translation kept (see rename_product)

Usage: python scripts/jessnix_apply.py <chromium src dir>
"""

import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
NAME = 'Jessnix'

# Strings files whose text names the product. Their translations are listed in
# each file's <translations> block.
STRINGS_FILES = (
    'chrome/app/chromium_strings.grd',
    'components/components_chromium_strings.grd',
)

# "Chromium" as the product's name. Left alone: ChromiumOS, the copyright
# holder ("The Chromium Authors"), and the Chromium project itself, which the
# About page still credits ("made possible by the Chromium open source project").
PRODUCT = re.compile(
    r'(?<!The )\bChromium\b'
    r'(?!OS| OS\b| Authors| developers| open source| project|<ph name="END_LINK_CHROMIUM")'
)

# The grit variables chromium_strings.grd reads, as the Windows build sets them.
GRIT_DEFINES = {
    '_google_chrome': False,
    '_is_chrome_for_testing_branded': False,
    'reven': False,
    'toolkit_views': True,
    'use_aura': True,
    'use_ozone': False,
    'use_titlecase': False,
    'is_desktop_android': False,
    'enable_extensions': True,
    'enable_extensions_core': True,
    'enable_printing': True,
    'enable_pdf': True,
    'enable_print_preview': True,
    'enable_supervised_users': True,
    'enable_dice_support': True,
    'enable_compose': True,
    'enable_vr': True,
    'enable_webui_ntp': True,
    'is_official_build': True,
    'safe_browsing_mode': 0,
}


def apply_patches(src: Path) -> None:
    patch_exe = src / 'third_party/git/usr/bin/patch.exe'
    series = REPO / 'patches/series'
    names = [line.strip() for line in series.read_text().splitlines()
             if line.strip() and not line.startswith('#')]
    for name in names:
        patch = REPO / 'patches' / name
        print(f'  patch {name}: {apply_one(patch_exe, src, patch)}')


def apply_one(patch_exe: Path, src: Path, patch: Path) -> str:
    # Patches are kept with LF endings. Some files in a Windows checkout have
    # CRLF, so each patch is tried as it is and then with CRLF endings.
    crlf = patch.with_suffix('.crlf.tmp')
    crlf.write_bytes(patch.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))
    try:
        for path, extra in ((patch, []), (crlf, ['--binary'])):
            base = [str(patch_exe), '-p1', '--ignore-whitespace', '--no-backup-if-mismatch',
                    '-d', str(src), '-i', str(path), '-s', '-f', *extra]
            # Reversing cleanly means it is already in.
            if subprocess.run(base + ['-R', '--dry-run'], capture_output=True).returncode == 0:
                return 'already applied'
            if subprocess.run(base + ['--forward', '--dry-run'], capture_output=True).returncode == 0:
                done = subprocess.run(base + ['--forward'], capture_output=True, text=True)
                if done.returncode != 0:
                    sys.exit(f'Patch {patch.name} failed:\n{done.stdout}{done.stderr}')
                return 'applied'
    finally:
        crlf.unlink(missing_ok=True)
    sys.exit(f'Patch {patch.name} does not apply to this source. Refresh it against {src}.')


def copy_assets(src: Path) -> None:
    count = 0
    for line in (REPO / 'branding/assets.txt').read_text().splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        ours, theirs = line.split()
        source, target = REPO / ours, src / theirs
        if not target.parent.is_dir():
            sys.exit(f'Asset target folder is gone: {target.parent}')
        if not target.exists() or target.read_bytes() != source.read_bytes():
            shutil.copyfile(source, target)
            count += 1
    print(f'  images: {count} replaced')


def read(path: Path) -> str:
    # newline='' keeps each file's own line endings (CRLF in a Windows checkout).
    with path.open(encoding='utf-8', newline='') as f:
        return f.read()


def write(path: Path, text: str) -> None:
    with path.open('w', encoding='utf-8', newline='') as f:
        f.write(text)


def message_ids(src: Path, grd: str) -> list:
    """The translation id of every message, in file order."""
    sys.path.insert(0, str(src / 'tools/grit'))
    from grit import grd_reader  # noqa: E402 (Chromium's own copy)
    from grit.node import message

    root = grd_reader.Parse(str(src / grd), defines=GRIT_DEFINES, debug=False)
    return [node.GetCliques()[0].GetMessage().GetId()
            for node in root.Preorder() if isinstance(node, message.MessageNode)]


def rename_product(src: Path) -> None:
    """Renames the product in the English strings and in every translation.

    A translation is matched to its English message by an id hashed from the
    English text. Changing that text changes the id, so the old translations
    would no longer be found and every language would fall back to English.
    The ids are therefore computed before and after, and each translation is
    moved to its new id with the same rename applied to its text.
    """
    for grd in STRINGS_FILES:
        grd_path = src / grd
        text = read(grd_path)
        parts = [grd_path.parent / p for p in re.findall(r'<part file="([^"]+)"', text)]
        if not any(PRODUCT.search(read(f)) for f in [grd_path, *parts]):
            print(f'  {grd}: already renamed')
            continue

        before = message_ids(src, grd)
        for f in [grd_path, *parts]:
            write(f, PRODUCT.sub(NAME, read(f)))
        after = message_ids(src, grd)
        if len(before) != len(after):
            sys.exit(f'{grd}: message count changed while renaming')
        moved = {old: new for old, new in zip(before, after) if old != new}

        translations = re.findall(r'<file path="([^"]+\.xtb)"', text)
        for rel in translations:
            xtb = grd_path.parent / rel

            def move(m):
                tid, body = m.group(1), m.group(2)
                if tid not in moved:
                    return m.group(0)
                return f'<translation id="{moved[tid]}">{PRODUCT.sub(NAME, body)}</translation>'

            data = read(xtb)
            data = re.sub(r'<translation id="(\d+)">(.*?)</translation>', move, data, flags=re.S)
            write(xtb, data)
        print(f'  {grd}: {len(moved)} messages renamed in English and {len(translations)} languages')


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1]).resolve()
    if not (src / 'chrome/app/theme/chromium/BRANDING').exists():
        sys.exit(f'Not a Chromium source tree: {src}')
    print('Jessnix: applying patches, images and product name')
    apply_patches(src)
    copy_assets(src)
    rename_product(src)


if __name__ == '__main__':
    main()
