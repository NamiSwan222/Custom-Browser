#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.
#
# Linux build steps, like scripts/custom-browser.ps1 on Windows. Logs go to .logs/.
#
#   ./scripts/custom-browser.sh init      download Firefox, apply the changes, install build tools
#   ./scripts/custom-browser.sh import    copy changed src/, prefs/ and configs/ into engine/
#   ./scripts/custom-browser.sh build     full dev build
#   ./scripts/custom-browser.sh ui        rebuild only the interface (JS/CSS/HTML)
#   ./scripts/custom-browser.sh cpp [dir] quick C++/Rust rebuild
#   ./scripts/custom-browser.sh release   optimized build
#   ./scripts/custom-browser.sh package   a .tar.xz in dist/
#   ./scripts/custom-browser.sh start     run the dev build
#
# Needs: git, Node.js 21+, Python 3, Rust (rustup), and the packages
# `./mach bootstrap` asks for. The path must not contain spaces.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$REPO/engine"
STEP="${1:-}"
shift || true
case "$REPO" in *" "*) echo "Firefox cannot build in a path with spaces: $REPO" >&2; exit 1 ;; esac

mkdir -p "$REPO/.logs"
LOG="$REPO/.logs/$STEP-$(date +%Y%m%d-%H%M%S).txt"
exec > >(tee -a "$LOG") 2>&1
echo "Custom Browser: $STEP $*"

BRAND="${CUSTOM_BRAND:-release}"
export MAR_CHANNEL_ID="$BRAND" ACCEPTED_MAR_CHANNEL_IDS="$BRAND"
if command -v sccache >/dev/null; then
  export CUSTOM_SCCACHE="$(command -v sccache)"
  export SCCACHE_CACHE_SIZE="${SCCACHE_CACHE_SIZE:-30G}"
fi

mode() {
  if [ "$1" = release ]; then export ZEN_RELEASE=1; else unset ZEN_RELEASE; fi
  local file="$REPO/.surfer/dynamicConfig.buildMode.json"
  local previous=dev
  [ -f "$file" ] && previous="$(tr -d '"\n ' < "$file")"
  if [ "$previous" != "$1" ] && [ -d "$ENGINE"/obj-* ]; then
    echo "Switching from a $previous build to $1: clearing the old build output."
    (cd "$ENGINE" && ./mach clobber)
  fi
  npm run surfer -- set buildMode "$1"
}

brand() { npm run surfer -- set brand "$BRAND"; }

case "$STEP" in
  init)
    npm run download
    python3 scripts/fetch_ublock.py
    python3 scripts/fetch_hebrew.py
    npm run import
    python3 scripts/custom_brand_terms.py
    (cd "$ENGINE" && ./mach --no-interactive bootstrap --application-choice browser)
    python3 scripts/update_en_US_packs.py
    ;;
  import)
    brand
    python3 scripts/fetch_ublock.py
    python3 scripts/fetch_hebrew.py
    npm run import
    python3 scripts/custom_brand_terms.py
    python3 scripts/update_en_US_packs.py
    ;;
  build)   mode dev; brand; npm run build || true; (cd "$ENGINE" && ./mach build) ;;
  ui)      mode dev; brand; npm run build:ui || true; (cd "$ENGINE" && ./mach build faster) ;;
  cpp)
    mode dev; brand
    if [ $# -gt 0 ]; then (cd "$ENGINE" && ./mach build "$@"); fi
    (cd "$ENGINE" && ./mach build binaries)
    ;;
  release) mode release; brand; npm run build || true; (cd "$ENGINE" && ./mach build) ;;
  package)
    [ -f "$REPO/.surfer/dynamicConfig.buildMode.json" ] && grep -q release "$REPO/.surfer/dynamicConfig.buildMode.json" && export ZEN_RELEASE=1
    (cd "$ENGINE" && ./mach package)
    mkdir -p "$REPO/dist"
    cp "$ENGINE"/obj-*/dist/*.tar.* "$REPO/dist/" 2>/dev/null || true
    ls -1 "$REPO/dist"
    ;;
  start)
    mkdir -p "$REPO/.profiles/dev"
    (cd "$ENGINE" && ./mach run --profile "$REPO/.profiles/dev" -- -purgecaches)
    ;;
  *) npm run "$STEP" -- "$@" ;;
esac
echo "exit: 0"
