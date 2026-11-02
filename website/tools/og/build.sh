#!/usr/bin/env bash
# Render the share cards to PNG. Needs rsvg-convert and the system fonts the
# SVGs name (PingFang SC, Helvetica Neue: present on macOS).
#
# rsvg-convert only loads images that sit beside the SVG, so each card is
# rendered from a temporary directory holding the SVG and its book cover.
set -euo pipefail
cd "$(dirname "$0")"
out=../../themes/book/static
covers=../../../book/assets
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

render() { # <svg> <cover> <png>
  mkdir -p "$tmp/$1"
  cp "$1" "$tmp/$1/card.svg"
  cp "$covers/$2" "$tmp/$1/cover.png"
  rsvg-convert -w 1200 -h 630 "$tmp/$1/card.svg" -o "$out/$3"
  echo "wrote $out/$3"
}

render og-cover.svg cover-cn-v3.png og-cover.png
render og-cover-en.svg cover-en-v3.png og-cover-en.png
