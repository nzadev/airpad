#!/usr/bin/env bash
set -euo pipefail

SDK_DIR="/home/nza/Android/Sdk"
BUILD_TOOLS="$SDK_DIR/build-tools/35.0.0"
PLATFORM="$SDK_DIR/platforms/android-36"
KEYSTORE="/home/nza/.android/debug.keystore"

SRC_DIR="/home/nza/Projects/web-gamepad/android_src"
BUILD_DIR="/home/nza/Projects/web-gamepad/android_build"
OUT_APK="/home/nza/Projects/web-gamepad/AirPad.apk"

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

echo ">> SUCCESS: APK generated at $OUT_APK ($(ls -lh "$OUT_APK" | awk '{print $5}'))"
