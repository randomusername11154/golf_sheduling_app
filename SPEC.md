# SPEC.md - Sagamore Tee Bot Technical Specification

Version 1.0.0. This is the authoritative technical reference for the
application. The AI runbook is `CLAUDE.md`; the end-user guide is
`FRIEND-SETUP.md`.

---

## 1. Overview

The Sagamore Tee Bot is a self-contained macOS application that automatically
books a golf tee time on the Sagamore Club member portal every weekend.

- It logs into the portal a few minutes before the weekly tee-time release.
- At the exact release moment (default 7:00 AM) it polls the booking page
  rapidly and books the configured target time (default 8:10 AM) the instant it
  becomes available.
- It runs unattended via macOS `launchd` and reports each outcome with a native
  macOS notification.
- The end user never opens Terminal, installs Node, or edits code. Setup is a
  short series of native dialog prompts.

### Design goals

1. **Zero ongoing interaction.** Install once; it runs itself every weekend.
2. **Self-contained.** Node runtime and the Chromium browser are bundled inside
   the `.app`. No Homebrew, no `npm install`, no system dependencies at runtime.
3. **Diagnosable by an AI.** Because the portal's HTML is unverified, all runs
   emit structured logs and capture page screenshots + HTML on failure, so a
   later Claude can repair the selectors from artifacts alone.
4. **Reversible.** One-click turn-off and uninstall.

### Non-goals

- Not a general-purpose booking tool; it targets one club and one time pattern.
- Not notarized (no Apple Developer account). First launch requires a one-time
  Gatekeeper bypass.

---

## 2. Architecture

```
                       macOS launchd (user agent)
                                |
         Sat/Sun at warm-up time (release - 5 min)
                                v
   +-------------------------------------------------------+
   |  bundled node  ->  Contents/Resources/app/booker.js   |
   |     env: PLAYWRIGHT_BROWSERS_PATH -> Resources/browsers|
   +-------------------------------------------------------+
         |                |                 |
         v                v                 v
   read config.json   drive Chromium    write activity.log
   (~/Library/...)    (bundled)         + diagnostics/*.png,*.html
                                            |
                                            v
                                  osascript notification
```

Two independent entry points share the same bundle:

1. **`setup.js`** - run when the user double-clicks the app. Interactive. Writes
   `config.json`, generates and loads the `launchd` plist, schedules a hardware
   wake, and fires a test notification. Then exits.
2. **`booker.js`** - run by `launchd` on schedule (and by Claude in `--diagnose`
   mode). Non-interactive. One booking attempt, then exits.

`launchd` is the scheduler. `booker.js` deliberately contains **no** long-lived
loop or self-scheduling logic; "run every weekend" is `launchd`'s job. This
makes the system reboot-safe and removes the need to keep any process or
Terminal open.

---

## 3. Components

### 3.1 `src/booker.js` - booking engine

Single run, then `process.exit`. Responsibilities:

- Load and validate `config.json`.
- Launch bundled Chromium via `playwright-core`.
- Log in (TASK: `login`).
- Load the tee-time page, set date + player count (TASK: `teepage`).
- Wait until the exact release time (TASK: `wait`).
- Poll/snipe until the target slot is booked or the give-up window elapses
  (TASKS: `snipe`, `book`).
- Notify the user of the result.

Centralised `SELECTORS` object at the top is the **only** place CSS selectors
live. Each field is an ordered array of candidate selectors; `firstMatching()`
tries them in order and logs every attempt.

Exit codes: `0` success or benignly-skipped; `1` config/setup error; `2` ran but
did not book.

### 3.2 `src/setup.js` - setup wizard / control panel

Uses `osascript` AppleScript dialogs (no GUI framework). Flows:

- **First run** (no config + no plist): collect details, save config, install
  schedule, schedule wake, test notification.
- **Subsequent runs**: a small menu - Turn Off / Change Settings / Done.

Writes `config.json` with mode `0600` (owner read/write only) because it holds
the portal password. Generates the `launchd` plist with absolute paths resolved
from the running bundle, then `launchctl bootout` (ignore failure) + `bootstrap`.

### 3.3 `app/launcher.sh` - bundle executable

`Contents/MacOS/SagamoreTeeBot`. Sets `PLAYWRIGHT_BROWSERS_PATH`,
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`, and execs the bundled `node` against
`setup.js`. Must be `chmod +x` and its filename must equal `CFBundleExecutable`.

### 3.4 `app/Info.plist`

Bundle metadata. Notable keys: `LSMinimumSystemVersion` 12.0; `LSUIElement`
true (setup is a dialog flow, not a Dock app); `NSAppleEventsUsageDescription`
(required on Sequoia+ for browser automation consent).

### 3.5 `scheduler/`

- `com.sagamore.teebot.plist.template` - reference only; `setup.js` generates
  the real plist at runtime.
- `Turn Off Tee Bot.command` - `launchctl bootout` + `pmset repeat cancel`.
- `Uninstall Tee Bot.command` - the above + remove plist + remove data dir.
- `Fix Security (run if blocked).command` - `xattr -cr` the installed app.

### 3.6 `build.sh`

Run once on a Mac. Defaults to arm64. Steps: `npm install`; download a clean
macOS Node binary; hermetic Playwright Chromium install into
`Resources/browsers`; assemble bundle; `codesign --force --deep --sign -`
(ad-hoc); zip the app + helper scripts + guide for delivery.

---

## 4. Configuration schema

Stored at `~/Library/Application Support/SagamoreTeeBot/config.json`.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `memberNumber` | string | `""` | Portal member number (e.g. `12345` or `12345-S`). Required. |
| `password` | string | `""` | Portal password. Required. Stored plaintext, file mode 600. |
| `targetTime` | string | `"8:10"` | Tee time to grab. `h:mm` with optional AM/PM; AM assumed. |
| `numberOfPlayers` | number | `2` | 1-4. |
| `bookSaturday` | bool | `true` | Run on Saturdays. |
| `bookSunday` | bool | `true` | Run on Sundays. |
| `releaseHour` | number | `7` | Hour (24h) the portal releases tee times. |
| `releaseMinute` | number | `0` | Minute the portal releases tee times. |
| `sniperIntervalMs` | number | `500` | Poll interval after release. Do not go below 200. |
| `giveUpAfterMinutes` | number | `15` | Stop trying this many minutes after release. |
| `loginUrl` | string | club login URL | Portal login page. |
| `teeTimesUrl` | string | club tee-times URL | Portal booking page. |
| `headless` | bool | `true` | Hide the browser during scheduled runs. |

---

## 5. Control & timing model

### 5.1 Schedule

`launchd` `StartCalendarInterval` cannot express ranges or lists, so each
enabled day is a separate dict (Saturday = Weekday 6, Sunday = Weekday 0). The
job is scheduled at **release minus 5 minutes** (default 6:55) so login warm-up
completes before release.

### 5.2 Wake-from-sleep

`launchd` runs a missed job on the next wake but cannot itself wake the machine,
and a closed-lid MacBook on battery will not wake. The installer therefore also
runs `pmset repeat wakeorpoweron <days> <release-7min>` (needs admin once) to
schedule a hardware wake ~7 minutes before release. **Reliability requires the
Mac to be plugged in.** This is a hardware constraint, not a software bug, and is
documented to the user.

### 5.3 Date targeted

Because `launchd` only triggers on the configured weekend days, the run targets
**today's** date. No rolling-window date math is performed. NOTE: this assumes
the club releases *same-day* 7:00 AM tee times. If the club actually uses an
N-days-ahead rolling window, the date logic in `targetDateForToday()` and the
date set in `loadTeeTimePage()` must be adjusted - flagged as a known assumption
in section 9.

---

## 6. Logging & diagnostics

### 6.1 Structured log

`activity.log` lines: `[ISO-8601 time] [LEVEL] [STEP] message`.
Levels: `INFO STEP WARN ERROR DEBUG`. Steps: `general config login teepage wait
snipe book diagnose capture date notify run`. The format is greppable so an AI
can reconstruct the run and pinpoint the failing step.

`launchd` also writes `launchd.out.log` / `launchd.err.log` (raw stdout/stderr).

### 6.2 Page capture

`capturePage()` writes a full-page screenshot (`.png`) and the page HTML
(`.html`) to `diagnostics/`, timestamped and labelled. Triggered:
- on any login/teepage failure (labelled by failure point),
- after a successful book click (`after-book-click`),
- once per ~60s during the snipe window (`polling-attempt-N`),
- on any uncaught run error (`run-error`),
- always in `--diagnose` mode (`diagnose-teepage`).

These artifacts are the primary input for repairing selectors.

### 6.3 `--diagnose` mode

`node booker.js --diagnose` logs in, loads the tee-time page, forces a **visible**
browser, dumps every time-bearing candidate element across all `slotContainers`
selectors (marking the target with `>>> TARGET`), saves screenshot + HTML, and
exits **without booking** and **without waiting for release**. Safe any time of
day. This is the tool a later Claude uses to verify/repair selectors.

---

## 7. Security & privacy

- The portal password is stored only in `config.json`, file mode `0600`. It is
  never logged and never printed to notifications.
- Failure captures dump page HTML, which on a logged-in page could contain
  member info; `diagnostics/` is local-only and must never be committed or sent
  off-device.
- The app is ad-hoc signed (free), not notarized. On first launch the user must
  clear quarantine (`xattr -cr`, or the Fix Security script) and approve the app
  in System Settings > Privacy & Security.
- Browser automation triggers a one-time macOS Automation consent prompt;
  `NSAppleEventsUsageDescription` explains why.

---

## 8. Build & distribution pipeline

Built on a Mac (the macOS Node binary, macOS Chromium, and `codesign` cannot be
produced on Windows). The friend's Claude runs `build.sh` per `CLAUDE.md` TASK A.

1. `npm install` (`playwright-core` pinned to match `build.sh PLAYWRIGHT_VERSION`).
2. Download clean macOS arm64 Node, copy `node` binary into `Resources/`.
3. Hermetic `playwright-core install chromium` into `Resources/browsers`.
4. Assemble bundle (app JS, `node_modules`, launcher, Info.plist, PkgInfo).
5. `codesign --force --deep --sign - --timestamp=none` (signs inner Chromium.app too).
6. `ditto` zip of app + Turn Off / Uninstall / Fix Security + guide.

Version coupling: `playwright-core` in `package.json` MUST equal
`PLAYWRIGHT_VERSION` in `build.sh`, or the bundled Chromium revision will not
match what the library expects.

---

## 9. Known limitations & assumptions

1. **Unverified selectors.** All `SELECTORS` are best-guess. First real use is
   the live test; repair per `CLAUDE.md` TASK C. This is the highest-risk item.
2. **Same-day release assumption.** Section 5.3. If the club uses a rolling
   advance window, date handling must change.
3. **Wake reliability needs AC power.** Section 5.2. On battery + closed lid,
   macOS may not wake; nothing software can fully guarantee this.
4. **Notification attribution.** `osascript` notifications are attributed to
   "Script Editor" on modern macOS; the message text is correct but the icon and
   click target are Script Editor's. Acceptable for this use; a native helper
   would be needed to change it.
5. **Single target time, single club.** By design.
6. **No retry across days.** If the target time is gone for the day, it notifies
   and waits for the next scheduled day.

---

## 10. Operational quick reference

| Action | Command / file |
|---|---|
| Build | `./build.sh` |
| Install | `cp -R "build/Sagamore Tee Bot.app" /Applications/ && xattr -cr "/Applications/Sagamore Tee Bot.app"` |
| Run setup | open the app, or run `Resources/node Resources/app/setup.js` |
| Verify selectors | `Resources/node Resources/app/booker.js --diagnose` |
| Read log | `tail -n 100 "~/Library/Application Support/SagamoreTeeBot/activity.log"` |
| Check schedule | `launchctl print "gui/$(id -u)/com.sagamore.teebot"` |
| Force a test run | `launchctl kickstart -k "gui/$(id -u)/com.sagamore.teebot"` |
| Turn off | `Turn Off Tee Bot.command` |
| Uninstall | `Uninstall Tee Bot.command` |
