#!/bin/bash
# Renders the PNG icons in public/ from the two SVGs that sit beside them, so
# the mark has one source. Previously the PNGs were committed with no record
# of how they were made, which meant re-lettering the mark left them behind.
#
# Run after editing icon.svg or icon-maskable.svg:
#   ./scripts/make-icons.sh
#
# The iOS app renders its own icon from public/icon.svg (see the app repo's
# Scripts/make-app-icon.sh), so both ports wear the same mark.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
public="$root/public"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# QuickLook is the only SVG renderer that ships with macOS. It composites onto
# an opaque ground, which is what these want -- an apple-touch-icon showing
# through to whatever is behind it looks broken on a home screen.
render() { # svg size out
  local svg=$1 size=$2 out=$3
  qlmanage -t -s 1024 -o "$work" "$public/$svg" >/dev/null 2>&1
  local rendered="$work/$svg.png"
  [ -f "$rendered" ] || { echo "qlmanage did not render $svg" >&2; exit 1; }
  sips -z "$size" "$size" "$rendered" --out "$public/$out" >/dev/null
  echo "wrote public/$out (${size}x${size})"
}

render icon.svg 192 icon-192.png
render icon.svg 512 icon-512.png
render icon.svg 180 apple-touch-icon.png
render icon-maskable.svg 512 icon-maskable-512.png
