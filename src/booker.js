// ============================================================
// Sagamore Club Tee Time Sniper - booking engine
// ============================================================
// Runs ONE booking attempt and exits. Scheduling is handled by
// macOS launchd (see scheduler/), NOT by this script. launchd
// wakes the Mac and runs this at the configured time every
// Saturday and Sunday.
//
// Flow:
//   1. Load config.json (member #, password, target time, etc.)
//   2. Log in to the club portal
//   3. Load the tee-time page for the target date
//   4. Wait until the exact release time (default 7:00 AM)
//   5. Poll the page fast until the target slot appears, book it
//   6. Post a native Mac notification with the result, then exit
//
// MODES (first CLI arg):
//   (none)       Normal scheduled run. Books for real.
//   --diagnose   Dry run for debugging. Logs in, loads the tee-time
//                page, captures a screenshot + full HTML + a dump of
//                every candidate slot element, then exits WITHOUT
//                booking and WITHOUT waiting for release time. Safe to
//                run any time. This is what a later Claude uses to
//                verify/repair the selectors against the real portal.
//
// DIAGNOSTICS: every run writes structured, tagged lines to
//   ~/Library/Application Support/SagamoreTeeBot/activity.log
// On any failure (and always in --diagnose mode) it also saves a
// screenshot + page HTML into the diagnostics/ subfolder so the page
// state can be inspected after the fact. See SPEC.md and CLAUDE.md.
// ============================================================

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// playwright-core is bundled in node_modules. The browser path is
// supplied via PLAYWRIGHT_BROWSERS_PATH by the launcher BEFORE this
// module is required (Playwright reads that env var at require time).
const { chromium } = require('playwright-core');

// ── Mode ─────────────────────────────────────────────────────
const ARGS = process.argv.slice(2);
const DIAGNOSE = ARGS.includes('--diagnose') || ARGS.includes('--dry-run');

// ── Paths ────────────────────────────────────────────────────
// Config and logs live in a stable, user-writable location so they
// survive app updates and are easy for the user (or Claude) to find.
const DATA_DIR = path.join(
  process.env.HOME || os.homedir(),
  'Library',
  'Application Support',
  'SagamoreTeeBot'
);
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const LOG_PATH = path.join(DATA_DIR, 'activity.log');
const DIAG_DIR = path.join(DATA_DIR, 'diagnostics');

// The list of CSS selectors we try for each element. Centralised here so
// a later Claude can edit selectors in ONE place when the portal changes.
// Each is an array tried in order; the first that matches wins.
const SELECTORS = {
  memberInput: [
    'input[name*="member" i]',
    'input[placeholder*="member" i]',
    'input[id*="member" i]',
    'input[name*="user" i]',
    'input[type="text"]',
  ],
  passwordInput: ['input[type="password"]'],
  submitButton: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Log In")',
    'button:has-text("Login")',
    'button:has-text("Sign In")',
  ],
  dateInput: ['input[type="date"]', 'input[name*="date" i]', 'input[id*="date" i]'],
  playerSelect: ['select[name*="player" i]', 'select[id*="player" i]'],
  slotContainers: [
    '[class*="tee-time"]',
    '[class*="teetime"]',
    '[class*="slot"]',
    '[class*="booking-time"]',
    '[class*="available"]',
    '[data-time]',
    'tr',
  ],
  bookButton: [
    'button:has-text("Book")',
    'button:has-text("Reserve")',
    'button:has-text("Confirm")',
    'a:has-text("Book")',
    'a:has-text("Reserve")',
    'input[value*="Book" i]',
  ],
  confirmButton: [
    'button:has-text("Confirm")',
    'button:has-text("Yes")',
    'button:has-text("Complete")',
  ],
};

// ── Logging ──────────────────────────────────────────────────
function ensureDirs() {
  for (const d of [DATA_DIR, DIAG_DIR]) {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch (_) {
      /* already exists */
    }
  }
}

// Structured, tagged log line. LEVEL is one of INFO/STEP/WARN/ERROR/DEBUG.
// A consistent, greppable format ("[time] [LEVEL] [STEP] message") lets a
// remote Claude reconstruct exactly what happened and where it failed.
function logAt(level, step, msg) {
  const line = `[${new Date().toISOString()}] [${level}] [${step}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch (_) {
    /* logging must never crash the run */
  }
}
const log = (msg) => logAt('INFO', 'general', msg);
const step = (name, msg) => logAt('STEP', name, msg);
const warn = (step, msg) => logAt('WARN', step, msg);
const error = (step, msg) => logAt('ERROR', step, msg);
const debug = (step, msg) => logAt('DEBUG', step, msg);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Diagnostic capture ───────────────────────────────────────
// Saves a screenshot + full HTML of the current page so the page state
// can be inspected later (the #1 tool for fixing wrong selectors).
async function capturePage(page, label) {
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(DIAG_DIR, `${stamp}_${label}`);
  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
    debug('capture', `screenshot saved: ${base}.png`);
  } catch (e) {
    warn('capture', `screenshot failed: ${e.message}`);
  }
  try {
    const html = await page.content();
    fs.writeFileSync(`${base}.html`, html);
    debug('capture', `html saved: ${base}.html (${html.length} bytes)`);
  } catch (e) {
    warn('capture', `html dump failed: ${e.message}`);
  }
  try {
    debug('capture', `final url: ${page.url()}`);
  } catch (_) {
    /* page may be closed */
  }
  return base;
}

// Try a list of selectors in order; return the first locator that has at
// least one match. Logs every attempt so failures are fully traceable.
async function firstMatching(page, selectorList, stepName, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (const sel of selectorList) {
    try {
      const loc = page.locator(sel).first();
      const count = await page.locator(sel).count();
      if (count > 0) {
        debug(stepName, `selector matched (${count}): ${sel}`);
        return loc;
      }
      debug(stepName, `selector matched 0: ${sel}`);
    } catch (e) {
      debug(stepName, `selector errored: ${sel} -> ${e.message}`);
    }
    if (Date.now() > deadline) break;
  }
  return null;
}

// ── Native Mac notification ──────────────────────────────────
function notify(title, message, sound = 'Glass') {
  return new Promise((resolve) => {
    const script =
      `display notification ${JSON.stringify(message)} ` +
      `with title ${JSON.stringify(title)} ` +
      `sound name ${JSON.stringify(sound)}`;
    execFile('osascript', ['-e', script], (err) => {
      if (err) warn('notify', `notification failed: ${err.message}`);
      resolve();
    });
  });
}

// ── Config ───────────────────────────────────────────────────
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `No settings found at ${CONFIG_PATH}. Open the Sagamore Tee Bot app once to set up your member number and password.`
    );
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    throw new Error(`Settings file is corrupted (${e.message}). Re-open the app to fix it.`);
  }

  const merged = {
    memberNumber: '',
    password: '',
    targetTime: '8:10',
    numberOfPlayers: 2,
    releaseHour: 7,
    releaseMinute: 0,
    sniperIntervalMs: 500,
    giveUpAfterMinutes: 15,
    bookSaturday: true,
    bookSunday: true,
    loginUrl: 'https://www.thesagamoreclub.com/web/pages/login',
    teeTimesUrl: 'https://www.thesagamoreclub.com/web/pages/tee-times',
    headless: true,
    ...cfg,
  };

  if (!merged.memberNumber || !merged.password) {
    throw new Error(
      'Member number or password is blank. Open the app to enter your login details.'
    );
  }
  return merged;
}

// ── Target time parsing ──────────────────────────────────────
function parseTargetTime(targetTime) {
  const m = String(targetTime).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) throw new Error(`Invalid target time "${targetTime}". Use a format like "8:10".`);
  let h = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const ap = m[3] ? m[3].toUpperCase() : null;
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return { hour24: h, minute: mins };
}

// ── Which date are we booking? ───────────────────────────────
function targetDateForToday(cfg) {
  const now = new Date();
  const day = now.getDay();
  if (!DIAGNOSE) {
    if (day === 6 && !cfg.bookSaturday)
      throw new Error('Saturday booking is turned off in settings.');
    if (day === 0 && !cfg.bookSunday)
      throw new Error('Sunday booking is turned off in settings.');
  }
  if (day !== 0 && day !== 6) {
    warn('date', 'Today is not a weekend day. Targeting today anyway (manual/diagnose run).');
  }
  return now;
}

function dateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function msUntilToday(hour, minute) {
  const t = new Date();
  t.setHours(hour, minute, 0, 0);
  return t.getTime() - Date.now();
}

// ── Login ────────────────────────────────────────────────────
async function login(page, cfg) {
  step('login', `Navigating to login page: ${cfg.loginUrl}`);
  await page.goto(cfg.loginUrl, { waitUntil: 'networkidle', timeout: 30000 });
  debug('login', `landed on: ${page.url()}`);

  const memberInput = await firstMatching(page, SELECTORS.memberInput, 'login', 15000);
  if (!memberInput) {
    await capturePage(page, 'login-no-member-field');
    throw new Error(
      'Could not find the member-number field on the login page. ' +
        'A screenshot + HTML were saved to the diagnostics folder for Claude to inspect.'
    );
  }
  await memberInput.fill(cfg.memberNumber);
  debug('login', 'filled member number');

  const passInput = await firstMatching(page, SELECTORS.passwordInput, 'login', 5000);
  if (!passInput) {
    await capturePage(page, 'login-no-password-field');
    throw new Error('Could not find the password field on the login page. Diagnostics saved.');
  }
  await passInput.fill(cfg.password);
  debug('login', 'filled password');

  const submit = await firstMatching(page, SELECTORS.submitButton, 'login', 5000);
  if (!submit) {
    await capturePage(page, 'login-no-submit');
    throw new Error('Could not find the login submit button. Diagnostics saved.');
  }

  step('login', 'Submitting credentials...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}),
    submit.click(),
  ]);

  if (page.url().includes('login')) {
    await capturePage(page, 'login-still-on-login');
    throw new Error(
      'Login failed - still on the login page. Check member number and password in settings. ' +
        'Diagnostics saved (the page may show an error message).'
    );
  }
  step('login', `Logged in successfully. Now at: ${page.url()}`);
}

// ── Load tee-time page (date + players) ──────────────────────
async function loadTeeTimePage(page, cfg, dateStr) {
  step('teepage', `Navigating to tee-times page: ${cfg.teeTimesUrl}`);
  await page.goto(cfg.teeTimesUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  debug('teepage', `landed on: ${page.url()}`);

  const dateInput = await firstMatching(page, SELECTORS.dateInput, 'teepage', 4000);
  if (dateInput) {
    try {
      await dateInput.fill(dateStr);
      await page.keyboard.press('Enter');
      await page.waitForLoadState('domcontentloaded');
      step('teepage', `Set date to ${dateStr}`);
    } catch (e) {
      warn('teepage', `found date field but could not set it: ${e.message}`);
    }
  } else {
    warn('teepage', 'no date field found - portal may default to today.');
  }

  const playerSelect = await firstMatching(page, SELECTORS.playerSelect, 'teepage', 3000);
  if (playerSelect) {
    try {
      await playerSelect.selectOption({ value: String(cfg.numberOfPlayers) });
      await page.waitForLoadState('domcontentloaded');
      step('teepage', `Set players to ${cfg.numberOfPlayers}`);
    } catch (e) {
      warn('teepage', `found player select but could not set it: ${e.message}`);
    }
  } else {
    debug('teepage', 'no player selector found (optional).');
  }
}

// Pull the time out of an element's text, normalised to 24h.
function parseSlotTime(text) {
  const m = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const ap = m[3] ? m[3].toUpperCase() : null;
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return { hour24: h, minute: mins, raw: m[0] };
}

// ── Diagnose mode: dump everything, book nothing ─────────────
async function diagnoseSlots(page, target) {
  step('diagnose', 'Collecting all candidate slot elements (no booking will happen)...');
  let total = 0;
  const seen = [];
  for (const sel of SELECTORS.slotContainers) {
    let els;
    try {
      els = await page.locator(sel).all();
    } catch (e) {
      debug('diagnose', `selector errored: ${sel} -> ${e.message}`);
      continue;
    }
    debug('diagnose', `selector "${sel}" matched ${els.length} element(s)`);
    for (const el of els) {
      let text;
      try {
        text = (await el.innerText()).trim().replace(/\s+/g, ' ');
      } catch (_) {
        continue;
      }
      if (!text) continue;
      const t = parseSlotTime(text);
      if (t) {
        total++;
        const isTarget = t.hour24 === target.hour24 && t.minute === target.minute;
        seen.push(
          `${isTarget ? '>>> TARGET ' : '          '}[${sel}] ${t.hour24}:${String(t.minute).padStart(2, '0')}  "${text.slice(0, 80)}"`
        );
      }
    }
  }
  log(`Diagnose: found ${total} element(s) containing a time.`);
  for (const line of seen.slice(0, 60)) log('  ' + line);
  if (total === 0) {
    warn(
      'diagnose',
      'No time-bearing elements matched ANY slot selector. The slotContainers selectors in booker.js likely need updating - inspect the saved HTML.'
    );
  }
}

// ── Try to find + book the target slot ───────────────────────
async function tryBook(page, target) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });

  let slots = [];
  for (const sel of SELECTORS.slotContainers) {
    try {
      const found = await page.locator(sel).all();
      if (found.length) slots = slots.concat(found);
    } catch (_) {
      /* try next selector */
    }
  }

  for (const slot of slots) {
    let text;
    try {
      text = (await slot.innerText()).trim();
    } catch (_) {
      continue;
    }
    const t = parseSlotTime(text);
    if (!t) continue;
    if (t.hour24 !== target.hour24 || t.minute !== target.minute) continue;

    step('book', `Found target slot ${target.hour24}:${String(target.minute).padStart(2, '0')} - clicking...`);
    await slot.click();

    const bookBtn = await firstMatching(page, SELECTORS.bookButton, 'book', 3000);
    if (!bookBtn) {
      warn('book', 'Found the slot but no Book button appeared - will retry next cycle.');
      continue;
    }
    try {
      await bookBtn.click();
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 });

      const confirm = await firstMatching(page, SELECTORS.confirmButton, 'book', 3000);
      if (confirm) {
        await confirm.click();
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
        debug('book', 'clicked confirmation dialog');
      }
      await capturePage(page, 'after-book-click');
      return true;
    } catch (e) {
      warn('book', `clicked Book but follow-through failed: ${e.message} - retrying next cycle.`);
    }
  }
  return false;
}

// ── Sniper loop ──────────────────────────────────────────────
async function sniperLoop(page, cfg, target) {
  step('snipe', `Sniper active - checking every ${cfg.sniperIntervalMs}ms for up to ${cfg.giveUpAfterMinutes} min.`);
  const giveUpAt = Date.now() + cfg.giveUpAfterMinutes * 60 * 1000;
  let attempts = 0;
  let lastDiagAt = 0;

  while (Date.now() < giveUpAt) {
    attempts++;
    try {
      if (await tryBook(page, target)) {
        step('snipe', `Booked on attempt #${attempts}.`);
        return true;
      }
    } catch (e) {
      debug('snipe', `attempt #${attempts} errored (continuing): ${e.message}`);
    }
    // Every ~60s of polling with no luck, capture the page once so a later
    // Claude can see what the portal looked like during the window.
    if (Date.now() - lastDiagAt > 60000) {
      lastDiagAt = Date.now();
      await capturePage(page, `polling-attempt-${attempts}`);
    }
    await sleep(cfg.sniperIntervalMs);
  }
  warn('snipe', `Gave up after ${cfg.giveUpAfterMinutes} minutes (${attempts} attempts).`);
  return false;
}

// ── Main: one run, then exit ─────────────────────────────────
async function run() {
  ensureDirs();
  log(`=== Run start (mode: ${DIAGNOSE ? 'DIAGNOSE' : 'normal'}) ===`);

  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    error('config', e.message);
    if (!DIAGNOSE) await notify('Sagamore Tee Bot', e.message, 'Basso');
    process.exit(1);
  }

  const target = parseTargetTime(cfg.targetTime);
  const targetLabel = `${target.hour24}:${String(target.minute).padStart(2, '0')} AM`;

  let weekend;
  try {
    weekend = targetDateForToday(cfg);
  } catch (e) {
    log(e.message);
    process.exit(0);
  }
  const dateStr = dateString(weekend);
  const dayName =
    weekend.getDay() === 6 ? 'Saturday' : weekend.getDay() === 0 ? 'Sunday' : 'today';

  log(`Target ${targetLabel} for ${dayName} ${dateStr}, ${cfg.numberOfPlayers} players.`);

  // In diagnose mode force a visible browser so a human watching can see it.
  const headless = DIAGNOSE ? false : cfg.headless;
  const browser = await chromium.launch({ headless });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  let booked = false;
  try {
    await login(page, cfg);
    await loadTeeTimePage(page, cfg, dateStr);

    if (DIAGNOSE) {
      await capturePage(page, 'diagnose-teepage');
      await diagnoseSlots(page, target);
      log('Diagnose complete. Screenshot + HTML + slot dump saved to the diagnostics folder.');
    } else {
      step('wait', `Waiting for ${cfg.releaseHour}:${String(cfg.releaseMinute).padStart(2, '0')} release...`);
      const msToRelease = msUntilToday(cfg.releaseHour, cfg.releaseMinute);
      if (msToRelease > 0) await sleep(msToRelease);
      booked = await sniperLoop(page, cfg, target);
    }
  } catch (err) {
    error('run', err.message);
    try {
      await capturePage(page, 'run-error');
    } catch (_) {
      /* page may already be gone */
    }
    if (!DIAGNOSE) await notify('Sagamore Tee Bot - problem', err.message, 'Basso');
  } finally {
    await ctx.close();
    await browser.close();
  }

  if (DIAGNOSE) {
    log('=== Diagnose run end ===');
    process.exit(0);
  }

  if (booked) {
    const msg = `Booked ${targetLabel} for ${dayName}!`;
    log(msg);
    await notify('Tee time booked!', msg, 'Glass');
  } else {
    const msg = `Could not get ${targetLabel} for ${dayName} this time.`;
    log(msg);
    await notify('Sagamore Tee Bot', msg, 'Basso');
  }

  log(`=== Run end (booked: ${booked}) ===`);
  process.exit(booked ? 0 : 2);
}

run();
