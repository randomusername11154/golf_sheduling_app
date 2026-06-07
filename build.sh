#!/bin/bash
# ============================================================
# Sagamore Tee Bot - Mac build script
# ============================================================
# Run this ONCE on any Mac to produce the finished, double-clickable
# app. It is fully automated:
#
#   1. Installs the Node dependencies (playwright-core)
#   2. Downloads a self-contained macOS Node binary
#   3. Downloads the matching Chromium browser (hermetic)
#   4. Assembles "Sagamore Tee Bot.app" with everything inside
#   5. Ad-hoc code-signs it (free, no Apple account needed)
#   6. Zips it for sending to your friend
#
# Usage:
#     chmod +x build.sh
#     ./build.sh                 # builds for Apple Silicon (arm64) by default
#     ./build.sh arm64           # force Apple Silicon build (M1/M2/M3/M4)
#     ./build.sh x64             # force Intel build (older Macs)
#
# Default target is arm64 (Apple Silicon) since every Mac sold since late
# 2020 uses it. Pass "x64" only for an older Intel Mac.
#
# Requirements on the build Mac: a recent system Node/npm (only used to
# install deps and download the browser; it is NOT bundled - a clean
# Node binary is downloaded for that). Internet connection.
# ============================================================

set -euo pipefail

# ── Settings ─────────────────────────────────────────────────
NODE_VERSION="22.14.0"          # LTS; avoids the Playwright-install hang on Node 24
PLAYWRIGHT_VERSION="1.60.0"     # MUST match package.json playwright-core version
APP_NAME="Sagamore Tee Bot"
BUNDLE_ID="com.sagamore.teebot"

# ── Resolve architecture ─────────────────────────────────────
# Defaults to arm64 (the target Mac), NOT the build machine's arch.
ARCH="${1:-arm64}"

if [ "$ARCH" = "arm64" ]; then
  NODE_ARCH="darwin-arm64"
  PW_BROWSER_ARCH="mac-arm64"
elif [ "$ARCH" = "x64" ]; then
  NODE_ARCH="darwin-x64"
  PW_BROWSER_ARCH="mac"
else
  echo "Architecture must be 'arm64' or 'x64'."; exit 1
fi

echo "=============================================="
echo " Building $APP_NAME for $ARCH"
echo "=============================================="

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD="$ROOT/build"
APP="$BUILD/$APP_NAME.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"

# ── Clean previous build ─────────────────────────────────────
rm -rf "$BUILD"
mkdir -p "$MACOS" "$RESOURCES/app"

# ── 1. Install JS dependencies ───────────────────────────────
echo ""
echo "[1/6] Installing Node dependencies..."
cd "$ROOT"
npm install --no-audit --no-fund

# ── 2. Download a clean macOS Node binary to bundle ──────────
echo ""
echo "[2/6] Downloading Node $NODE_VERSION ($NODE_ARCH)..."
NODE_PKG="node-v$NODE_VERSION-$NODE_ARCH"
NODE_URL="https://nodejs.org/dist/v$NODE_VERSION/$NODE_PKG.tar.gz"
curl -fsSL "$NODE_URL" -o "$BUILD/node.tar.gz"
tar -xzf "$BUILD/node.tar.gz" -C "$BUILD"
cp "$BUILD/$NODE_PKG/bin/node" "$RESOURCES/node"
chmod +x "$RESOURCES/node"
echo "      Bundled node: $("$RESOURCES/node" --version)"

# ── 3. Download the hermetic Chromium for Playwright ─────────
echo ""
echo "[3/6] Downloading Chromium for Playwright (this is the big one)..."
# PLAYWRIGHT_BROWSERS_PATH set to our Resources/browsers => hermetic install.
PLAYWRIGHT_BROWSERS_PATH="$RESOURCES/browsers" \
  npx --yes playwright-core@"$PLAYWRIGHT_VERSION" install chromium
echo "      Chromium installed into the app bundle."

# ── 4. Assemble the bundle ───────────────────────────────────
echo ""
echo "[4/6] Assembling the app bundle..."

# App code (no dev junk).
cp "$ROOT/src/booker.js" "$RESOURCES/app/booker.js"
cp "$ROOT/src/setup.js"  "$RESOURCES/app/setup.js"
cp -R "$ROOT/node_modules" "$RESOURCES/app/node_modules"

# Launcher executable (must match CFBundleExecutable name exactly).
cp "$ROOT/app/launcher.sh" "$MACOS/SagamoreTeeBot"
chmod +x "$MACOS/SagamoreTeeBot"

# Info.plist
cp "$ROOT/app/Info.plist" "$CONTENTS/Info.plist"

# PkgInfo (conventional)
printf 'APPL????' > "$CONTENTS/PkgInfo"

# App icon, if present.
if [ -f "$ROOT/assets/AppIcon.icns" ]; then
  cp "$ROOT/assets/AppIcon.icns" "$RESOURCES/AppIcon.icns"
fi

# Helper .command scripts alongside the app for the user.
cp "$ROOT/scheduler/Turn Off Tee Bot.command"  "$BUILD/Turn Off Tee Bot.command"
cp "$ROOT/scheduler/Uninstall Tee Bot.command" "$BUILD/Uninstall Tee Bot.command"
cp "$ROOT/scheduler/Fix Security (run if blocked).command" "$BUILD/Fix Security (run if blocked).command"
chmod +x "$BUILD/Turn Off Tee Bot.command" "$BUILD/Uninstall Tee Bot.command" "$BUILD/Fix Security (run if blocked).command"

# ── 5. Ad-hoc code sign (free; turns "damaged" into "unidentified") ──
echo ""
echo "[5/6] Ad-hoc code signing..."
# --deep signs the inner Chromium.app too. --force overwrites any prior sig.
codesign --force --deep --sign - --timestamp=none "$APP"
codesign --verify --deep --strict "$APP" && echo "      Signature OK."

# ── 6. Zip for delivery ──────────────────────────────────────
echo ""
echo "[6/6] Packaging for delivery..."
ZIP="$ROOT/SagamoreTeeBot-$ARCH.zip"
rm -f "$ZIP"
# ditto preserves the bundle structure, symlinks, and resource forks.
ditto -c -k --keepParent "$APP" "$BUILD/app-only.zip" >/dev/null

# Bundle the app + helper scripts + the friend guide into one zip.
STAGE="$BUILD/SagamoreTeeBot"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
cp "$BUILD/Turn Off Tee Bot.command"  "$STAGE/"
cp "$BUILD/Uninstall Tee Bot.command" "$STAGE/"
cp "$BUILD/Fix Security (run if blocked).command" "$STAGE/"
[ -f "$ROOT/FRIEND-SETUP.md" ] && cp "$ROOT/FRIEND-SETUP.md" "$STAGE/READ ME FIRST.txt" || true
ditto -c -k --keepParent "$STAGE" "$ZIP" >/dev/null

echo ""
echo "=============================================="
echo " Done!"
echo " Built: $APP"
echo " Send your friend: $ZIP"
echo "=============================================="
echo ""
echo " Tell your friend to follow 'READ ME FIRST.txt' inside the zip."
