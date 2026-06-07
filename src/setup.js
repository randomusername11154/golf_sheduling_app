// ============================================================
// Sagamore Tee Bot - setup / control panel
// ============================================================
// This runs when the user double-clicks the app. It shows native
// macOS dialogs (no Terminal, no JSON editing) to:
//   - collect member number, password, target time, players, days
//   - save them to config.json
//   - install the launchd schedule so it runs every weekend
//   - schedule a hardware wake (pmset) so a sleeping Mac wakes up
//   - fire a test notification so macOS prompts for permission once
//
// It is intentionally a simple menu. "Not overkill."
// ============================================================

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, execFileSync } = require('child_process');

const HOME = process.env.HOME || os.homedir();
const DATA_DIR = path.join(HOME, 'Library', 'Application Support', 'SagamoreTeeBot');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const LABEL = 'com.sagamore.teebot';
const PLIST_DEST = path.join(HOME, 'Library', 'LaunchAgents', `${LABEL}.plist`);

// Resources dir inside the .app bundle. setup.js lives in Resources/app/,
// so Resources/ is two levels up.
const APP_RESOURCES = path.join(__dirname, '..');
const NODE_BIN = path.join(APP_RESOURCES, 'node');
const BOOKER_JS = path.join(APP_RESOURCES, 'app', 'booker.js');

const DEFAULTS = {
  memberNumber: '',
  password: '',
  targetTime: '8:10',
  numberOfPlayers: 2,
  bookSaturday: true,
  bookSunday: true,
  releaseHour: 7,
  releaseMinute: 0,
  sniperIntervalMs: 500,
  giveUpAfterMinutes: 15,
  loginUrl: 'https://www.thesagamoreclub.com/web/pages/login',
  teeTimesUrl: 'https://www.thesagamoreclub.com/web/pages/tee-times',
  headless: true,
};

// ── AppleScript dialog helpers ───────────────────────────────
// All run synchronously - this is an interactive setup wizard.
function osa(script) {
  return execFileSync('osascript', ['-e', script], { encoding: 'utf8' }).trim();
}

// Show a dialog with a text field. Returns the typed text, or null if cancelled.
function askText(prompt, defaultAnswer = '', hidden = false) {
  const hiddenClause = hidden ? ' with hidden answer' : '';
  const script =
    `try\n` +
    `  set r to display dialog ${JSON.stringify(prompt)} ` +
    `default answer ${JSON.stringify(String(defaultAnswer))}${hiddenClause} ` +
    `with title "Sagamore Tee Bot" buttons {"Cancel", "OK"} default button "OK"\n` +
    `  return text returned of r\n` +
    `on error number -128\n` +
    `  return "<<CANCELLED>>"\n` +
    `end try`;
  const out = osa(script);
  return out === '<<CANCELLED>>' ? null : out;
}

// Show a button choice. Returns the chosen button label, or null if cancelled.
function askButtons(prompt, buttons, defaultButton) {
  const list = buttons.map((b) => JSON.stringify(b)).join(', ');
  const script =
    `try\n` +
    `  set r to display dialog ${JSON.stringify(prompt)} ` +
    `with title "Sagamore Tee Bot" buttons {${list}} default button ${JSON.stringify(defaultButton)}\n` +
    `  return button returned of r\n` +
    `on error number -128\n` +
    `  return "<<CANCELLED>>"\n` +
    `end try`;
  const out = osa(script);
  return out === '<<CANCELLED>>' ? null : out;
}

// Pick one item from a list. Returns the chosen string, or null if cancelled.
function askChoice(prompt, items, defaultItem) {
  const list = items.map((b) => JSON.stringify(b)).join(', ');
  const script =
    `set r to choose from list {${list}} ` +
    `with prompt ${JSON.stringify(prompt)} ` +
    `default items {${JSON.stringify(defaultItem)}} with title "Sagamore Tee Bot"\n` +
    `if r is false then\n  return "<<CANCELLED>>"\nelse\n  return item 1 of r\nend if`;
  const out = osa(script);
  return out === '<<CANCELLED>>' ? null : out;
}

function info(message) {
  const script =
    `display dialog ${JSON.stringify(message)} with title "Sagamore Tee Bot" ` +
    `buttons {"OK"} default button "OK"`;
  try {
    osa(script);
  } catch (_) {
    /* user dismissed */
  }
}

function notify(title, message) {
  const script =
    `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)} sound name "Glass"`;
  try {
    osa(script);
  } catch (_) {
    /* ignore */
  }
}

// ── Config load/save ─────────────────────────────────────────
function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

function saveConfig(cfg) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  // 0600: only the user can read the file (it holds the portal password).
}

// ── launchd plist ────────────────────────────────────────────
function buildPlist(cfg) {
  const entries = [];
  // Wake/run a few minutes before release so login warm-up has time.
  let runMinute = cfg.releaseMinute - 5;
  let runHour = cfg.releaseHour;
  if (runMinute < 0) {
    runMinute += 60;
    runHour -= 1;
  }
  const days = [];
  if (cfg.bookSaturday) days.push(6);
  if (cfg.bookSunday) days.push(0);

  for (const wd of days) {
    entries.push(
      '    <dict>\n' +
        `      <key>Weekday</key><integer>${wd}</integer>\n` +
        `      <key>Hour</key><integer>${runHour}</integer>\n` +
        `      <key>Minute</key><integer>${runMinute}</integer>\n` +
        '    </dict>'
    );
  }

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n' +
    '<dict>\n' +
    `  <key>Label</key>\n  <string>${LABEL}</string>\n` +
    '  <key>ProgramArguments</key>\n' +
    '  <array>\n' +
    `    <string>${NODE_BIN}</string>\n` +
    `    <string>${BOOKER_JS}</string>\n` +
    '  </array>\n' +
    '  <key>EnvironmentVariables</key>\n' +
    '  <dict>\n' +
    '    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>\n' +
    `    <key>HOME</key><string>${HOME}</string>\n` +
    `    <key>PLAYWRIGHT_BROWSERS_PATH</key><string>${path.join(APP_RESOURCES, 'browsers')}</string>\n` +
    '    <key>PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD</key><string>1</string>\n' +
    '  </dict>\n' +
    '  <key>StartCalendarInterval</key>\n' +
    '  <array>\n' +
    entries.join('\n') +
    '\n  </array>\n' +
    `  <key>StandardOutPath</key>\n  <string>${path.join(DATA_DIR, 'launchd.out.log')}</string>\n` +
    `  <key>StandardErrorPath</key>\n  <string>${path.join(DATA_DIR, 'launchd.err.log')}</string>\n` +
    '  <key>RunAtLoad</key>\n  <false/>\n' +
    '</dict>\n' +
    '</plist>\n'
  );
}

function installSchedule(cfg) {
  fs.mkdirSync(path.dirname(PLIST_DEST), { recursive: true });
  fs.writeFileSync(PLIST_DEST, buildPlist(cfg), { mode: 0o644 });

  const uid = process.getuid();
  // Remove any previous version first (ignore errors), then bootstrap.
  try {
    execFileSync('launchctl', ['bootout', `gui/${uid}`, PLIST_DEST], { stdio: 'ignore' });
  } catch (_) {
    /* wasn't loaded */
  }
  execFileSync('launchctl', ['bootstrap', `gui/${uid}`, PLIST_DEST]);
}

// Schedule a hardware wake so a sleeping/plugged-in Mac wakes before the job.
// Needs admin rights -> use AppleScript "with administrator privileges".
function scheduleWake(cfg) {
  let wakeMinute = cfg.releaseMinute - 7;
  let wakeHour = cfg.releaseHour;
  if (wakeMinute < 0) {
    wakeMinute += 60;
    wakeHour -= 1;
  }
  const dayCodes = [];
  if (cfg.bookSaturday) dayCodes.push('S');
  if (cfg.bookSunday) dayCodes.push('U');
  if (dayCodes.length === 0) return;
  const hh = String(wakeHour).padStart(2, '0');
  const mm = String(wakeMinute).padStart(2, '0');
  const cmd = `/usr/bin/pmset repeat wakeorpoweron ${dayCodes.join('')} ${hh}:${mm}:00`;

  const script =
    `do shell script ${JSON.stringify(cmd)} with administrator privileges`;
  try {
    osa(script);
  } catch (_) {
    info(
      'Skipped the automatic wake setup (you cancelled the password prompt).\n\n' +
        'The bot will still work as long as your Mac is awake at booking time. ' +
        'You can re-run setup later to enable automatic wake.'
    );
  }
}

// ── Wizard flows ─────────────────────────────────────────────
function runFirstTimeSetup() {
  const cfg = loadConfig();

  info(
    'Welcome to the Sagamore Tee Bot.\n\n' +
      "Let's set up your login and which tee time to grab. " +
      'This only takes a minute and you only do it once.'
  );

  const member = askText('Enter your Sagamore member number\n(e.g. 12345 or 12345-S):', cfg.memberNumber);
  if (member === null) return false;

  const pass = askText('Enter your Sagamore portal password:', '', true);
  if (pass === null) return false;

  const time = askText('What tee time should it grab? (e.g. 8:10)', cfg.targetTime);
  if (time === null) return false;

  const players = askChoice('How many players?', ['1', '2', '3', '4'], String(cfg.numberOfPlayers));
  if (players === null) return false;

  const days = askChoice(
    'Which days should it book?',
    ['Saturday and Sunday', 'Saturday only', 'Sunday only'],
    'Saturday and Sunday'
  );
  if (days === null) return false;

  cfg.memberNumber = member.trim();
  cfg.password = pass;
  cfg.targetTime = time.trim();
  cfg.numberOfPlayers = parseInt(players, 10);
  cfg.bookSaturday = days !== 'Sunday only';
  cfg.bookSunday = days !== 'Saturday only';

  saveConfig(cfg);

  try {
    installSchedule(cfg);
  } catch (e) {
    info(`Could not install the weekend schedule:\n${e.message}\n\nYour settings were saved. Try re-opening the app.`);
    return false;
  }

  scheduleWake(cfg);

  // Fire a test notification so macOS shows the permission prompt now,
  // while the user is here to click Allow.
  notify('Sagamore Tee Bot is ready', 'You will get a message here whenever it books a tee time.');

  const dayText = cfg.bookSaturday && cfg.bookSunday ? 'Saturday and Sunday' : cfg.bookSaturday ? 'Saturday' : 'Sunday';
  info(
    'All set!\n\n' +
      `It will try to book ${cfg.targetTime} AM for ${cfg.numberOfPlayers} player(s) every ${dayText}.\n\n` +
      'IMPORTANT: leave your Mac plugged in on Friday night (the lid can be closed). ' +
      'You can close this window now - everything runs automatically.'
  );
  return true;
}

function showMainMenu() {
  const choice = askButtons(
    'Sagamore Tee Bot is installed and running.\n\nWhat would you like to do?',
    ['Turn Off', 'Change Settings', 'Done'],
    'Done'
  );
  if (choice === 'Change Settings') {
    runFirstTimeSetup();
  } else if (choice === 'Turn Off') {
    disableSchedule();
    info('The bot is turned off. Open this app again and choose "Change Settings" to turn it back on.');
  }
}

function disableSchedule() {
  const uid = process.getuid();
  try {
    execFileSync('launchctl', ['bootout', `gui/${uid}`, PLIST_DEST], { stdio: 'ignore' });
  } catch (_) {
    /* already off */
  }
  try {
    osa(`do shell script "/usr/bin/pmset repeat cancel" with administrator privileges`);
  } catch (_) {
    /* user cancelled or not set */
  }
}

// ── Entry point ──────────────────────────────────────────────
function main() {
  ensureDataDir();
  const isInstalled = fs.existsSync(CONFIG_PATH) && fs.existsSync(PLIST_DEST);
  if (isInstalled) {
    showMainMenu();
  } else {
    runFirstTimeSetup();
  }
}

main();
