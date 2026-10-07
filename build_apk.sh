#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="/home/nza/Android/Sdk"
BUILD_TOOLS="$SDK_DIR/build-tools/35.0.0"
PLATFORM="$SDK_DIR/platforms/android-36"
KEYSTORE="/home/nza/.android/debug.keystore"

SRC_DIR="$SCRIPT_DIR/android_src"
BUILD_DIR="$SCRIPT_DIR/android_build"
OUT_APK="$SCRIPT_DIR/AirPad.apk"

echo ">> 0. Syncing web assets to APK assets & static folder..."
mkdir -p "$SRC_DIR/assets" "$SCRIPT_DIR/static"
for f in app.js style.css jsqr.min.js config.json manifest.json app_icon.png icon.svg; do
    if [[ -f "$SCRIPT_DIR/$f" ]]; then
        cp "$SCRIPT_DIR/$f" "$SRC_DIR/assets/$f"
        cp "$SCRIPT_DIR/$f" "$SCRIPT_DIR/static/$f"
    fi
done

# Website gets standard index.html
cp "$SCRIPT_DIR/index.html" "$SCRIPT_DIR/static/index.html"

# Android Native App gets android_index.html (without web download banners/tabs)
if [[ -f "$SCRIPT_DIR/android_index.html" ]]; then
    cp "$SCRIPT_DIR/android_index.html" "$SRC_DIR/assets/index.html"
else
    cp "$SCRIPT_DIR/index.html" "$SRC_DIR/assets/index.html"
fi

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/compiled_res" "$BUILD_DIR/gen" "$BUILD_DIR/classes"

echo ">> 1. Compiling resources..."
"$BUILD_TOOLS/aapt2" compile --dir "$SRC_DIR/res" -o "$BUILD_DIR/compiled_res.zip"

echo ">> 2. Linking resources & APK shell..."
"$BUILD_TOOLS/aapt2" link \
    -I "$PLATFORM/android.jar" \
    "$BUILD_DIR/compiled_res.zip" \
    --manifest "$SRC_DIR/AndroidManifest.xml" \
    --min-sdk-version 21 \
    --target-sdk-version 34 \
    --auto-add-overlay \
    -A "$SRC_DIR/assets" \
    --java "$BUILD_DIR/gen" \
    -o "$BUILD_DIR/app-unaligned.apk"

echo ">> 3. Compiling Java sources..."
javac -d "$BUILD_DIR/classes" \
    -cp "$PLATFORM/android.jar" \
    "$SRC_DIR/src/com/nzadev/airpad/MainActivity.java" \
    $(find "$BUILD_DIR/gen" -name "*.java" 2>/dev/null || true)

echo ">> 4. Converting to Dalvik DEX (d8)..."
"$BUILD_TOOLS/d8" \
    --lib "$PLATFORM/android.jar" \
    --output "$BUILD_DIR" \
    $(find "$BUILD_DIR/classes" -name "*.class")

echo ">> 5. Adding classes.dex to APK..."
(cd "$BUILD_DIR" && jar uf app-unaligned.apk classes.dex)

echo ">> 6. Zipalign APK..."
"$BUILD_TOOLS/zipalign" -f 4 "$BUILD_DIR/app-unaligned.apk" "$BUILD_DIR/app-aligned.apk"

echo ">> 7. Signing APK with apksigner..."
"$BUILD_TOOLS/apksigner" sign \
    --ks "$KEYSTORE" \
    --ks-pass pass:android \
    --key-pass pass:android \
    --ks-key-alias androiddebugkey \
    --out "$OUT_APK" \
    "$BUILD_DIR/app-aligned.apk"

echo ">> Verification:"
"$BUILD_TOOLS/apksigner" verify "$OUT_APK"

cp "$OUT_APK" "$SCRIPT_DIR/static/AirPad.apk"

echo ">> SUCCESS: APK generated at $OUT_APK ($(ls -lh "$OUT_APK" | awk '{print $5}'))"
