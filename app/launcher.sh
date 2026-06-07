#!/bin/bash
# ============================================================
# Sagamore Tee Bot - app launcher
# ============================================================
# This is the executable macOS runs when the user double-clicks
# the app. It is the file referenced by CFBundleExecutable in
# Info.plist and lives at Contents/MacOS/SagamoreTeeBot.
#
# It points Playwright at the bundled Chromium, then runs the
# interactive setup/control panel (setup.js) with the bundled
# Node binary. The actual scheduled booking is run separately by
# launchd, which calls booker.js directly (see setup.js).
# ============================================================

set -euo pipefail

# Contents/MacOS -> Contents -> Contents/Resources
MACOS_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES="$(cd "$MACOS_DIR/../Resources" && pwd)"

# Playwright reads this at require() time, so it MUST be set before node runs.
export PLAYWRIGHT_BROWSERS_PATH="$RESOURCES/browsers"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1

exec "$RESOURCES/node" "$RESOURCES/app/setup.js" "$@"
