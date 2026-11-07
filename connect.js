// `node connect.js` opens a dedicated Chrome window (own profile, debug port 9222).
// Other scripts call connect() to attach to that window and get the Showit editor tab,
// or run(main) to do that plus plain-language errors.
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const CHROMES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
];
const PORT = 9222;

async function connect() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
  } catch {
    throw new Error('The tool\'s Chrome window is not open. Start it first (menu option 1 / `npm run chrome`).');
  }
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('app.showit.com'));
  if (!page) {
    await browser.close();
    throw new Error('Open the Showit editor (app.showit.com) in the tool\'s Chrome window and log in.');
  }
  return { browser, page };
}

// Run a command against the editor; always disconnects (Chrome stays open), never dumps stack traces.
async function run(main) {
  let conn;
  try {
    conn = await connect();
    await main(conn.page);
  } catch (e) {
    const msg = e.name === 'TimeoutError'
      ? 'The Showit editor did not respond as expected (a popup may be open, or Showit changed its editor). ' +
        'The tool stopped; anything it changed is in fixes-log.json and can be undone with restore.'
      : e.message;
    console.error(`\nSTOPPED: ${msg}`);
    if (process.env.DEBUG) console.error(e);
    process.exitCode = 1;
  } finally {
    await conn?.browser.close(); // disconnect only
  }
}

if (require.main === module) {
  const chrome = CHROMES.find(p => fs.existsSync(p));
  if (!chrome) { console.error('Google Chrome not found. Install it from google.com/chrome.'); process.exit(1); }
  require('child_process').spawn(chrome, [
    `--remote-debugging-port=${PORT}`,
    // Keep drawing and running timers when the window is behind others (the tool works while you do too).
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    `--user-data-dir=${path.join(process.env.SHOWIT_AI_DATA || __dirname, '.profile')}`,
    'https://app.showit.com',
  ], { detached: true, stdio: 'ignore' }).unref();
}

module.exports = { connect, run };
