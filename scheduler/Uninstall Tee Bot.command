#!/bin/bash
# ============================================================
# Uninstall Sagamore Tee Bot
# ============================================================
# Double-click this file to completely remove the bot:
#   - stops the weekend schedule
#   - cancels the automatic wake-up
#   - deletes your saved settings and logs
# After this, you can drag the app to the Trash.
# ============================================================

LABEL="com.sagamore.teebot"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DATA_DIR="$HOME/Library/Application Support/SagamoreTeeBot"
UID_NUM=$(id -u)

echo "Uninstalling the Sagamore Tee Bot..."
echo ""

# 1. Stop the scheduled job.
if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$UID_NUM" "$PLIST" 2>/dev/null
  echo "[+] Stopped the weekend schedule."
else
  echo "[+] Schedule was not running."
fi

# 2. Remove the schedule file.
if [ -f "$PLIST" ]; then
  rm -f "$PLIST"
  echo "[+] Removed the schedule file."
fi

# 3. Cancel the hardware wake (needs your Mac password once).
echo ""
echo "Cancelling the automatic wake-up (you may be asked for your Mac password)..."
sudo /usr/bin/pmset repeat cancel 2>/dev/null && echo "[+] Wake-up cancelled." || echo "[ ] Skipped wake-up cancel."

# 4. Remove saved settings and logs.
if [ -d "$DATA_DIR" ]; then
  rm -rf "$DATA_DIR"
  echo "[+] Removed saved settings and logs."
fi

echo ""
echo "Done. You can now drag the Sagamore Tee Bot app to the Trash."
echo "You can close this window."
