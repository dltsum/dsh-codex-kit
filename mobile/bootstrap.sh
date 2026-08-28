#!/usr/bin/env sh
set -eu

command -v flutter >/dev/null 2>&1 || {
  echo 'Flutter is not on PATH. Install the current Flutter stable SDK and run flutter doctor first.' >&2
  exit 1
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if [ ! -f android/settings.gradle ] && [ ! -f android/settings.gradle.kts ]; then
  flutter create --platforms=android --org com.dshcodexkit .
fi

node ../scripts/ensure-android-compile-sdk.mjs
cp android_manifest.overlay.xml android/app/src/main/AndroidManifest.xml
flutter pub get
flutter analyze
flutter test
echo 'Android project bootstrapped and checked. Build with: flutter build apk --release'
