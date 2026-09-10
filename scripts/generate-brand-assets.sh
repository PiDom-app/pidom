#!/usr/bin/env bash

set -euo pipefail

root=$(cd -- "$(dirname -- "$0")/.." && pwd)
source="$root/assets/pidom-mark.svg"
images="$root/assets/images"
temporary=$(mktemp -d)

cleanup() {
  rm -rf "$temporary"
}
trap cleanup EXIT

rsvg-convert --width 512 --height 512 "$source" --output "$temporary/mark.png"

magick "$temporary/mark.png" -resize 600x600 "$temporary/launcher-mark.png"
magick -size 1024x1024 xc:white "$temporary/launcher-mark.png" -gravity center -composite \
  "$images/icon.png"

magick "$temporary/mark.png" -resize 660x660 "$temporary/adaptive-mark.png"
magick -size 1024x1024 xc:none "$temporary/adaptive-mark.png" -gravity center -composite \
  "$images/android-icon-foreground.png"
magick -size 1024x1024 xc:none "$temporary/adaptive-mark.png" -gravity center -composite \
  -colorspace Gray "$images/android-icon-monochrome.png"
magick -size 1024x1024 xc:white "$images/android-icon-background.png"

magick "$temporary/mark.png" -resize 64x64 "$temporary/favicon-mark.png"
magick -size 96x96 xc:white "$temporary/favicon-mark.png" -gravity center -composite \
  "$images/favicon.png"
magick "$temporary/mark.png" "$images/splash-icon.png"
magick "$temporary/mark.png" -fill '#e8e6e3' -colorize 100 "$images/splash-icon-dark.png"
