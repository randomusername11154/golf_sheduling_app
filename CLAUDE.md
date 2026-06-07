# CLAUDE.md - Runbook for setting up and maintaining the Sagamore Tee Bot

You are Claude, running on a Mac, helping a non-technical golfer install and
maintain an app that automatically books his weekend tee time. This file is
your runbook. Read it fully before acting. Talk to the user in plain,
non-technical language; do the technical work yourself.

The full technical reference is in `SPEC.md`. Read it if anything here is
unclear. The human-facing guide is `FRIEND-SETUP.md`.

---

## What this project is

A self-contained macOS app (`Sagamore Tee Bot.app`) that logs into the
Sagamore Club portal every Saturday and Sunday at ~6:55 AM, waits for the
7:00 AM tee-time release, and instantly books a target time (default 8:10 AM).
It runs itself via macOS `launchd`; the user does not keep anything open.

Key facts you must know:
- Target Mac is **Apple Silicon (arm64)**.
- The web selectors for the club portal are **UNVERIFIED guesses**. Verifying
  and, if needed, repairing them is the single most likely thing you will do.
- All settings, logs, and diagnostics live in:
  `~/Library/Application Support/SagamoreTeeBot/`

---

## Repository layout

```
src/booker.js        Booking engine. One run, then exits. Has a --diagnose mode.
src/setup.js         Interactive setup wizard (native dialogs). Self-installs the schedule.
src/config.example.json  Reference of every setting.
app/launcher.sh      The .app executable (Contents/MacOS). Sets Playwright env, runs setup.js.
app/Info.plist       Bundle metadata.
scheduler/           launchd plist template + Turn Off / Uninstall / Fix Security scripts.
build.sh             Builds the .app on a Mac. Run this first.
SPEC.md              Full technical spec.
FRIEND-SETUP.md      Human setup guide.
Sagamore_Tee_Bot_Setup_Guide.docx   ORIGINAL prototype + its old guide. Historical reference only - see below.
```

The user-data folder (created at first run):
```
~/Library/Application Support/SagamoreTeeBot/
  config.json          The user's settings (contains the portal password; chmod 600).
  activity.log         Structured run log. Your primary debugging source.
  launchd.out.log      stdout from scheduled runs.
  launchd.err.log      stderr from scheduled runs.
  diagnostics/         Screenshots (.png) + page HTML (.html) captured on failures and in --diagnose mode.
```

---

## Where this project started (the original prototype)

`Sagamore_Tee_Bot_Setup_Guide.docx` is where this whole thing began. It is the
ORIGINAL prototype: a single-file `bot.js` plus a manual setup guide that told
the user to install Homebrew, install Node, paste code into TextEdit, edit
credentials inside the code, and run it from Terminal with `caffeinate`/`nohup`.

That prototype has been fully superseded by the current `src/` + `.app` design.
Treat the `.docx` as historical reference ONLY. Specifically:

- **Its code is the OLD design.** The original ran an infinite `while(true)`
  loop that did its own weekend scheduling and re-targeted the next weekend
  forever. The current `src/booker.js` does ONE run and exits; `launchd` owns the
  schedule. Do not reintroduce the loop.
- **Its install flow is obsolete.** No Homebrew, no Terminal, no hand-editing
  credentials. Setup is the `.app` wizard (`src/setup.js`). Ignore the doc's
  steps; follow TASK A in this file.
- **But it is useful for troubleshooting.** The original `bot.js` selectors,
  URLs, login flow, and timing logic in the doc are the SAME best-guess starting
  point the current code uses. If you are debugging, the doc shows the original
  author's intent (which fields, which target time, which polling behaviour). If
  the current `SELECTORS` look wrong, compare against the doc to confirm nothing
  was lost in the refactor - the two should agree on intent.

When the doc and the current `src/` code disagree, **the current `src/` code and
`SPEC.md` win.** The doc is never the source of truth; it is context.

### Troubleshooting on your own

You are expected to diagnose and fix issues autonomously, without waiting for the
user to gather information. The artifacts you need are already on disk:

1. Start from `activity.log` (TASK B) to find the failing `[STEP]`.
2. Open the matching capture in `diagnostics/` (screenshot + real page HTML).
3. Run `--diagnose` (TASK C) to see the live page and the slot dump.
4. Cross-check intent against the original prototype in the `.docx` if a
   selector or timing value looks suspicious.
5. Edit ONLY the `SELECTORS` object in `src/booker.js`, rebuild, reinstall, and
   re-run `--diagnose` to confirm the fix before telling the user it is solved.

Do not ask the user to read logs, take screenshots, or inspect HTML - you have
all of that yourself. Only involve the user when you need a decision (e.g. their
credentials are wrong, or the club's booking rules differ from what the code
assumes).

---

## TASK A - First-time build and install

Do these in order. Stop and tell the user if any step fails.

1. **Check prerequisites.**
   ```bash
   node --version    # need any recent Node (used only to build); if missing: brew install node
   sw_vers           # confirm macOS 12 or newer
   uname -m          # expect arm64
   ```
   If `node` is missing and `brew` exists: `brew install node`. If neither
   exists, tell the user you need to install Homebrew first and ask permission.

2. **Build the app.** From the project root:
   ```bash
   chmod +x build.sh
   ./build.sh            # defaults to arm64
   ```
   This downloads Node + Chromium (~170 MB), assembles `build/Sagamore Tee Bot.app`,
   ad-hoc signs it, and produces `SagamoreTeeBot-arm64.zip`. It takes a few minutes.

3. **Install the app.**
   ```bash
   cp -R "build/Sagamore Tee Bot.app" /Applications/
   xattr -cr "/Applications/Sagamore Tee Bot.app"   # clear quarantine so it opens
   ```

4. **Run the setup wizard** (this collects login + schedules the job). Either
   tell the user to open the app from Applications, OR run setup directly so you
   can see output:
   ```bash
   "/Applications/Sagamore Tee Bot.app/Contents/Resources/node" \
     "/Applications/Sagamore Tee Bot.app/Contents/Resources/app/setup.js"
   ```
   The wizard asks for member number, password, target time, players, and days,
   then installs the `launchd` schedule and a `pmset` wake. The user will be
   prompted once for their Mac password (for the wake schedule) and once to
   allow notifications - tell them to approve both.

5. **VERIFY the selectors before trusting it** (TASK C). Always do this. Do not
   declare success until a `--diagnose` run confirms login works and the target
   time is visible on the page.

---

## TASK B - Read the logs

The log is structured: `[ISO-time] [LEVEL] [STEP] message`.
Levels: `INFO STEP WARN ERROR DEBUG`. Steps: `config login teepage wait snipe book diagnose capture`.

```bash
LOG="$HOME/Library/Application Support/SagamoreTeeBot/activity.log"
tail -n 100 "$LOG"                 # recent activity
grep ' \[ERROR\] ' "$LOG"          # all errors
grep ' \[login\] ' "$LOG"          # everything about login
ls -lt "$HOME/Library/Application Support/SagamoreTeeBot/diagnostics/" | head   # latest captures
```

Interpreting common lines:
- `[ERROR] [login] Could not find the member-number field` -> login selector is wrong. Go to TASK C.
- `[WARN] [diagnose] No time-bearing elements matched ANY slot selector` -> slot selector is wrong. TASK C.
- `[ERROR] [login] Login failed - still on the login page` -> wrong credentials OR the submit/selector worked but the portal rejected login. Open the saved `*login-still-on-login*.html` to check for an error message.
- `[WARN] [snipe] Gave up after N minutes` -> ran fine but the target time never appeared available (could be genuinely taken, or the slot selector misses it - confirm with TASK C).

---

## TASK C - Verify / repair the web selectors (the important one)

The portal's real HTML has never been confirmed. Use diagnose mode, which logs
in, loads the tee-time page, saves a screenshot + full HTML, and lists every
element it can find that contains a time - WITHOUT booking anything. Safe to run
any time of day.

1. **Run diagnose:**
   ```bash
   RES="/Applications/Sagamore Tee Bot.app/Contents/Resources"
   PLAYWRIGHT_BROWSERS_PATH="$RES/browsers" \
   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
     "$RES/node" "$RES/app/booker.js" --diagnose
   ```
   (You can also run from `src/` during development:
   `PLAYWRIGHT_BROWSERS_PATH=... node src/booker.js --diagnose`.)

2. **Read what it found** in `activity.log` (look for `[diagnose]` lines) and
   open the newest files in `diagnostics/`:
   - `*_diagnose-teepage.html` - the real tee-time page HTML.
   - `*_diagnose-teepage.png` - a screenshot.

3. **If login failed**, the capture will be a login page (`*login-*`). Open that
   HTML, find the real `input` for member number / password and the submit
   button, and update the matching arrays in `src/booker.js` -> the `SELECTORS`
   object (also update `src/setup.js` only if it changes login - it does not log
   in, so usually just `booker.js`). All selectors are centralised at the top of
   `booker.js` in one `SELECTORS` object - edit there, nowhere else.

4. **If the tee-time page loaded but no times matched**, inspect the page HTML to
   find the elements that actually wrap each tee time. Add a correct CSS selector
   to `SELECTORS.slotContainers`, and confirm the Book button text/markup matches
   `SELECTORS.bookButton`.

5. **Rebuild and reinstall** after editing selectors:
   ```bash
   ./build.sh
   cp -R "build/Sagamore Tee Bot.app" /Applications/
   xattr -cr "/Applications/Sagamore Tee Bot.app"
   ```
   Then run TASK C step 1 again to confirm the target time now appears with a
   `>>> TARGET` marker in the diagnose output.

Rules when editing selectors:
- Only touch the `SELECTORS` object in `src/booker.js`. Do not scatter selectors.
- Prefer stable attributes (`name`, `id`, `data-*`) over volatile class names.
- Keep the existing entries as fallbacks; add the confirmed one first.
- Never hardcode the member number, password, or a specific date into `booker.js`.

---

## TASK D - Confirm the schedule is installed and correct

```bash
launchctl print "gui/$(id -u)/com.sagamore.teebot" | grep -A20 'event\|periodic\|state'
cat "$HOME/Library/LaunchAgents/com.sagamore.teebot.plist"
pmset -g sched          # should show a repeating wake on Sat/Sun
```
The plist should contain `StartCalendarInterval` entries for Weekday 6 (Sat)
and/or 0 (Sun) at the warm-up time (release minus 5). If it is wrong, re-run the
setup wizard (TASK A step 4) which regenerates it.

To do a real end-to-end test without waiting for the weekend, temporarily set in
`config.json` a `releaseHour`/`releaseMinute` a couple minutes in the future and
a near-future day, then trigger the job:
```bash
launchctl kickstart -k "gui/$(id -u)/com.sagamore.teebot"
```
Watch `activity.log`. Restore the real release time afterward.

---

## TASK E - Turn off / uninstall

- Pause: double-click `Turn Off Tee Bot.command`, or:
  `launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.sagamore.teebot.plist"`
- Full removal: run `Uninstall Tee Bot.command`, then `rm -rf "/Applications/Sagamore Tee Bot.app"`.

---

## Guardrails

- Never print or paste the user's password into chat. It lives only in
  `config.json` (mode 600). When debugging login, look at the page HTML, not the
  stored password.
- Do not commit `config.json` or the `diagnostics/` folder anywhere.
- Do not lower `sniperIntervalMs` below 200 ms - the club server may throttle.
- If you change Playwright's version in `package.json`, you MUST re-run
  `build.sh` so the bundled Chromium revision matches, or the app will fail to
  launch the browser.
- If `build.sh` fails downloading Chromium, check the `PLAYWRIGHT_VERSION` in
  `build.sh` matches `playwright-core` in `package.json`.
