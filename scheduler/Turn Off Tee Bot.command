#!/bin/bash
# ============================================================
# Turn Off Sagamore Tee Bot
# ============================================================
# Double-click this file to stop the bot from running on
# weekends. Your settings are kept - open the app and choose
# "Change Settings" to turn it back on.
# ============================================================

LABEL="com.sagamore.teebot"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM=$(id -u)

echo "Turning off the Sagamore Tee Bot..."
echo ""

# Stop the scheduled job (modern launchctl syntax, macOS 10.11+).
if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$UID_NUM" "$PLIST" 2>/dev/null
  echo "[+] Stopped the weekend schedule."
else
  echo "[+] The schedule was already off."
fi

# Cancel the scheduled hardware wake (needs your Mac password once).
echo ""
echo "Cancelling the automatic wake-up (you may be asked for your Mac password)..."
sudo /usr/bin/pmset repeat cancel 2>/dev/null && echo "[+] Wake-up cancelled." || echo "[ ] Skipped wake-up cancel."

echo ""
echo "Done. The bot will not run until you turn it back on."
echo "You can close this window."
