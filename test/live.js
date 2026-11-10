// Live end-to-end test in the real Showit editor. It edits the site, but only a throwaway copy:
//   node test/live.js --yes [--page Home] [--sections "Intro,Testimonials"]
// Duplicates the page as "AI Test", squeezes the desktop layout onto the phone in some sections (the
// never-designed case), runs Fix (patches + automatic rebuild), checks what's left, deletes the copy.
// Exit code 1 if anything real is left or a step fails.
// Safety: every page-menu action checks it's on the right row first, and nothing is edited unless the
// original page is still there under its own name and the copy is the page open.
const path = require('path');
const { execFileSync } = require('child_process');
const { readModel, audit } = require('../audit');
const { applyMobile } = require('../editor');
const { click } = require('../cursor');

const ROOT = path.join(__dirname, '..');
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const COPY = 'AI Test';
const exact = name => new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');

// Page rows in the Site panel (the Site tab must be open for them to exist).
async function pageNames(page) {
  await page.keyboard.press('Escape');
  await page.locator('[data-intercom-target="site panel tab"]').click();
  await page.waitForTimeout(700);
  return page.evaluate(() => [...document.querySelectorAll('[class*="_item-label_"]')].map(e => e.textContent.trim()));
}

// A page row's own "..." menu, then one of its items. Climbs from the label to the smallest box holding
// a menu button and checks that box is this page's row (one label, this name) before clicking anything.
async function pageMenu(page, name, item) {
  await pageNames(page);
  const row = page.locator('[class*="_item-label_"]').filter({ hasText: exact(name) }).first();
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  const dots = await row.evaluate((el, want) => {
    let n = el;
    while (n && !n.querySelector('[class*="_menu-container_"]')) n = n.parentElement;
    const labels = n ? [...n.querySelectorAll('[class*="_item-label_"]')].map(l => l.textContent.trim()) : [];
    if (labels.length !== 1 || labels[0] !== want) return null;
    const r = n.querySelector('[class*="_menu-container_"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, name);
  if (!dots) throw new Error(`could not find the menu of page "${name}" safely`);
  await click(page, dots);
  await page.waitForTimeout(700);
  await page.locator('si-menu-item').filter({ hasText: item }).first().click();
  await page.waitForTimeout(1500);
}

async function deleteCopy(page) {
  if (!(await pageNames(page)).includes(COPY)) return;
  await pageMenu(page, COPY, 'Delete');
  if (!(await page.getByText(`Are you sure you want to delete the page '${COPY}'?`).count())) {
    await page.keyboard.press('Escape');
    throw new Error('delete dialog not for the test copy; nothing deleted');
  }
  await page.locator('button, si-button').filter({ hasText: /^\s*delete\s*$/i }).last().click();
  await page.waitForTimeout(2000);
  console.log(`deleted "${COPY}"`);
}

if (!process.argv.includes('--yes')) {
  console.error('This edits your Showit site (a throwaway copy of a page). Run with --yes.');
  process.exit(2);
}

require('../connect').run(async page => {
  const src = arg('--page', 'Home'), t0 = Date.now(), lap = label => console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${label}`);
  try {
    await deleteCopy(page); // a leftover from an interrupted run
    const before = await pageNames(page);
    if (!before.includes(src)) throw new Error(`no page "${src}"`);
    await pageMenu(page, src, 'Duplicate');
    const dup = (await pageNames(page)).find(n => !before.includes(n));
    if (!dup) throw new Error('duplicate did not appear');
    await pageMenu(page, dup, 'Rename');
    await page.keyboard.press('Control+a');
    await page.keyboard.type(COPY, { delay: 100 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);

    // Safety: the original page still there under its own name, exactly one copy, and the copy open.
    const now = await pageNames(page);
    if (!now.includes(src) || now.filter(n => n === COPY).length !== 1) throw new Error(`pages not as expected (${now.join(', ')}); stopped before editing anything`);
    await page.locator('[class*="_item-label_"]').filter({ hasText: exact(COPY) }).first().click();
    await page.waitForTimeout(2500);
    let m = await readModel(page);
    if (m.page.name !== COPY) throw new Error(`expected "${COPY}" open, found "${m.page.name}"; stopped before editing anything`);
    lap(`copied "${src}" as "${COPY}"`);

    // Squeeze the desktop layout onto the phone (what a never-designed mobile layout looks like).
    const wanted = arg('--sections', '');
    const blocks = m.blocks.filter(b => !b.canvasSet && b.elements.filter(e => e.visible === 'a').length >= 2)
      .filter(b => !wanted || wanted.split(',').map(s => s.trim()).includes(b.name.trim())).slice(0, wanted ? 99 : 4);
    for (const b of blocks) {
      for (const [i, e] of b.elements.entries()) {
        if (e.visible !== 'a' || e.type === 'line' || !e.desktop?.w || (e.type === 'text' && e.desktop.w > 1200)) continue;
        const d = e.desktop, t = { x: Math.round(d.x * 0.267), y: Math.round(d.y * 0.45) };
        if (e.type === 'text') t.w = Math.max(40, Math.round(d.w * 0.267));
        try { m = await applyMobile(page, m, `${b.id}.elements.${i}`, t, 'live test: squeeze'); } catch { /* left as is */ }
      }
    }
    const broken = audit(m).filter(i => !/intentional/.test(i.problem));
    lap(`squeezed ${blocks.map(b => b.name.trim()).join(', ')}: ${broken.length} issue(s) found`);

    execFileSync(process.execPath, [path.join(ROOT, 'fix.js'), '--page', COPY, '--apply'], { stdio: 'inherit', env: process.env });
    lap('Fix done');

    m = await readModel(page);
    const left = audit(m).filter(i => !/intentional/.test(i.problem));
    for (const i of left) console.log(`  left: ${i.block} | ${i.what} | ${i.problem}`);
    lap(left.length ? `${left.length} issue(s) left` : 'clean');
    if (left.length) process.exitCode = 1;
  } finally {
    await deleteCopy(page).catch(e => { console.error(`could not delete "${COPY}": ${e.message}`); process.exitCode = 1; });
  }
});
