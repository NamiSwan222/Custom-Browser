# SPDX-License-Identifier: MIT
# Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.
"""Puts the product icon on the installer's self-extractor stub.

The installer .exe is Firefox's 7-Zip self-extractor
(other-licenses/7zstub/firefox/7zSD.Win32.sfx) with the app packed behind it,
and the stub carries Firefox's installer icon. This writes a copy of the stub
whose icon group 1 (IDI_ICON, also used by its progress window) is the given
.ico, using Windows' own resource functions. The original stub is not changed.

    python scripts/custom_installer_icon.py <stub.sfx> <icon.ico> <out.sfx>
"""

import ctypes
import shutil
import struct
import sys
from ctypes import wintypes

RT_ICON = 3
RT_GROUP_ICON = 14
GROUP_ID = 1
LANG = 1033  # en-US, what the stub is built with

kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
kernel32.BeginUpdateResourceW.restype = ctypes.c_void_p
kernel32.BeginUpdateResourceW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]
kernel32.UpdateResourceW.restype = wintypes.BOOL
kernel32.UpdateResourceW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
                                     wintypes.WORD, ctypes.c_void_p, wintypes.DWORD]
kernel32.EndUpdateResourceW.restype = wintypes.BOOL
kernel32.EndUpdateResourceW.argtypes = [ctypes.c_void_p, wintypes.BOOL]
kernel32.LoadLibraryExW.restype = ctypes.c_void_p
kernel32.LoadLibraryExW.argtypes = [wintypes.LPCWSTR, ctypes.c_void_p, wintypes.DWORD]
kernel32.FreeLibrary.argtypes = [ctypes.c_void_p]
ENUM_NAMES = ctypes.WINFUNCTYPE(wintypes.BOOL, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)
ENUM_LANGS = ctypes.WINFUNCTYPE(wintypes.BOOL, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
                                wintypes.WORD, ctypes.c_void_p)
kernel32.EnumResourceNamesW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ENUM_NAMES, ctypes.c_void_p]
kernel32.EnumResourceLanguagesW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
                                            ENUM_LANGS, ctypes.c_void_p]


def existing_icons(path: str) -> list[tuple[int, int, int]]:
    """(type, id, language) of every icon resource in the file."""
    module = kernel32.LoadLibraryExW(path, None, 0x2)  # LOAD_LIBRARY_AS_DATAFILE
    if not module:
        raise OSError(ctypes.get_last_error(), f'cannot read resources of {path}')
    found = []
    try:
        for rtype in (RT_ICON, RT_GROUP_ICON):
            names = []
            name_cb = ENUM_NAMES(lambda m, t, n, p: names.append(n) or True)
            kernel32.EnumResourceNamesW(module, ctypes.c_void_p(rtype), name_cb, None)
            for name in names:
                if name >= 0x10000:
                    continue  # named (string) resources: the stub has none
                langs = []
                lang_cb = ENUM_LANGS(lambda m, t, n, lang, p: langs.append(lang) or True)
                kernel32.EnumResourceLanguagesW(module, ctypes.c_void_p(rtype), ctypes.c_void_p(name), lang_cb, None)
                found += [(rtype, name, lang) for lang in langs]
    finally:
        kernel32.FreeLibrary(module)
    return found


def read_ico(path: str) -> list[tuple[bytes, bytes]]:
    """(12-byte group entry minus id, image bytes) for each image in an .ico."""
    data = open(path, 'rb').read()
    reserved, kind, count = struct.unpack_from('<HHH', data, 0)
    if reserved != 0 or kind != 1 or count == 0:
        raise ValueError(f'{path} is not an .ico file')
    images = []
    for i in range(count):
        width, height, colors, res, planes, bpp, size, offset = struct.unpack_from('<BBBBHHII', data, 6 + 16 * i)
        entry = struct.pack('<BBBBHHI', width, height, colors, res, planes, bpp, size)
        images.append((entry, data[offset:offset + size]))
    return images


def update(handle, rtype: int, rid: int, lang: int, data: bytes | None) -> None:
    buffer = ctypes.create_string_buffer(data) if data else None
    ok = kernel32.UpdateResourceW(handle, ctypes.c_void_p(rtype), ctypes.c_void_p(rid), lang,
                                  buffer, len(data) if data else 0)
    if not ok:
        raise OSError(ctypes.get_last_error(), f'UpdateResource({rtype}, {rid}) failed')


def main() -> None:
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    stub, ico, out = sys.argv[1:]
    shutil.copyfile(stub, out)
    old = existing_icons(out)
    images = read_ico(ico)

    handle = kernel32.BeginUpdateResourceW(out, False)
    if not handle:
        raise OSError(ctypes.get_last_error(), f'cannot update {out}')
    try:
        for rtype, rid, lang in old:  # remove the old icon in every language
            update(handle, rtype, rid, lang, None)
        group = struct.pack('<HHH', 0, 1, len(images))
        for number, (entry, image) in enumerate(images, start=1):
            update(handle, RT_ICON, number, LANG, image)
            group += entry + struct.pack('<H', number)
        update(handle, RT_GROUP_ICON, GROUP_ID, LANG, group)
    except BaseException:
        kernel32.EndUpdateResourceW(handle, True)  # discard
        raise
    if not kernel32.EndUpdateResourceW(handle, False):
        raise OSError(ctypes.get_last_error(), f'cannot write {out}')
    print(f'{out}: icon replaced ({len(images)} sizes, removed {len(old)} old icon resources)')


if __name__ == '__main__':
    main()
