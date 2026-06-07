#!/bin/bash
# ============================================================
# Fix Security - run only if the app says it is "damaged"
# ============================================================
# On some Macs (especially Apple Silicon), apps downloaded from
# the internet get a "damaged and can't be opened" warning. This
# is not real damage - it is macOS being cautious about apps that
# did not come from the App Store. This script clears that flag.
#
# Just double-click this file, enter your Mac password if asked,
# then try opening the Sagamore Tee Bot app again.
# ============================================================

APP="/Applications/Sagamore Tee Bot.app"

echo "Clearing the security flag on the Sagamore Tee Bot..."
echo ""

if [ ! -d "$APP" ]; then
  echo "Could not find the app at:"
  echo "  $APP"
  echo ""
  echo "Make sure you dragged 'Sagamore Tee Bot' into your Applications folder first,"
  echo "then run this again."
  echo ""
  echo "You can close this window."
  exit 1
fi

# Remove the quarantine attribute from the whole bundle (including the
# Chromium browser inside it).
xattr -cr "$APP" 2>/dev/null && echo "[+] Done." || echo "[ ] Nothing to clear (it may already be fine)."

echo ""
echo "Now go to your Applications folder and open 'Sagamore Tee Bot' again."
echo "You can close this window."
