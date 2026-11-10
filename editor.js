// Drives the Showit editor UI: pages, selection, typing into fields, verified + logged edits.
// Every edit goes through Showit's own fields, is checked afterwards, and is logged with what it
// replaced (fixes-log.json, one JSON object per line) so restore.js can put it back.
const fs = require('fs');
const path = require('path');
const { readModel, textSize } = require('./audit');
const { click, moveTo, say } = require('./cursor');

// Writable data folder: the desktop app sets SHOWIT_AI_DATA (install folders can be read-only).
const DATA = process.env.SHOWIT_AI_DATA || __dirname;
const LOG = path.join(DATA, 'fixes-log.json');
// The app's Stop button creates this file; edits stop cleanly before the next one starts.
const STOP = path.join(DATA, 'stop');
const checkStop = () => { if (fs.existsSync(STOP)) throw new Error('Stopped by you. Everything done so far is logged and can be undone.'); };
const RUN = Date.now().toString(36); // one id per command run; restore.js undoes by run
// Model key -> [panel section, field label]
const FIELD = {
  w: ['Size & Position', 'W'], x: ['Size & Position', 'X'],
  h: ['Size & Position', 'H'], y: ['Size & Position', 'Y'],
  size: ['Text Style', 'Size'],
};

const domId = id => id.replace(/\./g, '_');
// id: "block.elements.3", or "block.elements.3.elements.<child id>" for an element inside a group.
const findEl = (model, id) => {
  const [b, , i, , c] = id.split('.');
  const el = model.blocks.find(x => x.id === b)?.elements[+i];
  return c ? el?.elements?.[c] : el;
};
const log = entry => fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), run: RUN, ...entry }) + '\n');
const readLog = () => fs.existsSync(LOG)
  ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

// ---- pages -------------------------------------------------------------------------------

// Leave any shared-section ("Main Site") view; page data and page sections only load in page view.
async function toPage(page) {
  const back = page.locator('[data-intercom-target="layer panel"] si-button[icon-prefix="arrowChevronLeft"]');
  for (let i = 0; i < 3 && await back.isVisible().catch(() => false); i++) {
    await click(page, back);
    await page.waitForTimeout(800);
  }
}

// Runs in the page. Live React components (searched DOWN from the root, so never outdated copies)
// whose props match; returns their first DOM node's text, and tags that node with `attr` if given.
// match: { has: [prop names], is: { prop: [allowed values] } }
function liveComponents({ has = [], is = {}, attr, text }) {
  if (attr) document.querySelectorAll(`[${attr}]`).forEach(e => e.removeAttribute(attr));
  // Every React root on the page (the editor has more than one, e.g. the layers panel).
  const roots = [...document.querySelectorAll('body *')].flatMap(n => Object.keys(n).filter(k => k.startsWith('__reactContainer')).map(k => n[k]));
  const out = [], stack = roots.map(r => r.stateNode?.current ?? r).reverse();
  while (stack.length) {
    const f = stack.pop(), q = f.memoizedProps;
    if (q && typeof q === 'object' && has.every(k => q[k] != null) && Object.entries(is).every(([k, vs]) => vs.includes(q[k]))) {
      let h = f;
      while (h && !(h.stateNode instanceof Element)) h = h.child;
      const t = h?.stateNode.textContent.trim();
      if (h && (text == null || t === text)) {
        out.push({ text: t, type: q.type });
        if (attr) { h.stateNode.setAttribute(attr, '1'); return out; }
      }
    }
    if (f.sibling) stack.push(f.sibling);
    if (f.child) stack.push(f.child);
  }
  return out;
}

const PAGE_ROW = { has: ['id', 'listIndex'], is: { type: ['page', 'wppage'] } };

// Pages and blog templates from the Site tab: [{ name, type }]
async function listPages(page) {
  await page.locator('[data-intercom-target="site panel tab"]').click();
  await page.waitForTimeout(600);
  const pages = (await page.evaluate(liveComponents, PAGE_ROW)).map(p => ({ name: p.text, type: p.type }));
  await page.locator('[data-intercom-target="page panel tab"]').click();
  return pages;
}

async function openPage(page, name) {
  await page.locator('[data-intercom-target="site panel tab"]').click();
  await page.waitForTimeout(500);
  // Pages only (shared sections can have the same name, e.g. "Contact").
  const found = await page.evaluate(liveComponents, { ...PAGE_ROW, text: name, attr: 'data-ai-page' });
  if (!found.length) throw new Error(`no page called "${name}"`);
  await click(page, page.locator('[data-ai-page]'));
  for (let i = 0; i < 40; i++) { // wait for the editor to load it
    await page.waitForTimeout(250);
    const m = await readModel(page).catch(() => null);
    if (m?.page.name === name) break;
    if (i === 39) throw new Error(`page "${name}" did not open`);
  }
  await page.locator('[data-intercom-target="page panel tab"]').click();
  await page.waitForTimeout(500);
  await toPage(page);
}

// Value after a CLI flag: flag('--page') for `--page "About"`.
const flag = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

// Pages a command should cover: --all, --page "Name", or (default) whatever page is open.
// Yields each page opened and ready.
async function* eachPage(page) {
  const names = process.argv.includes('--all') ? (await listPages(page)).map(p => p.name)
    : flag('--page') ? [flag('--page')] : [null];
  for (const name of names) {
    if (name) await openPage(page, name); else await toPage(page);
    yield (await readModel(page)).page.name;
  }
}

// ---- selecting + typing -------------------------------------------------------------------

// Showit's group focus mode (a group opened by double-click): its children get stage hitboxes.
const inGroup = page => page.evaluate(() => [...document.querySelectorAll('[id^="si_element_mobile_"]')].some(e => /_elements_\d+_elements_/.test(e.id)));
async function leaveGroup(page) {
  for (let i = 0; i < 2 && await inGroup(page); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
}

// Selection goes through the layers list, which only shows on the left panel's PAGE tab.
async function showLayers(page) {
  if (await page.locator('[data-intercom-target="layer panel"]').isVisible().catch(() => false)) return;
  const tab = page.locator('[data-intercom-target="page panel tab"]');
  if (await tab.isVisible().catch(() => false)) { await click(page, tab); await page.waitForTimeout(700); }
}

// Selected in either view: a layers-row click selects in whichever stage (phone/desktop) was used last.
// Fields are always switched to the phone tab and checked against the mobile value before typing.
const isSelected = (page, id) => page.evaluate(d => ['mobile', 'desktop'].some(l => document.getElementById(`si_element_${l}_${d}`)?.getAttribute('data-selected') === '1'), domId(id));

// Select an element on the mobile stage. One clean retry: Showit's selection can lag behind clicks.
async function select(page, id) {
  checkStop();
  await showLayers(page);
  for (let attempt = 1; ; attempt++) {
    try {
      return await (id.split('.').length > 3 ? selectChild(page, id) : selectTop(page, id));
    } catch (e) {
      if (attempt >= 2 || /Stopped by you/.test(e.message)) throw e;
      await page.keyboard.press('Escape');
      await leaveGroup(page);
      await page.waitForTimeout(600);
    }
  }
}

async function selectTop(page, id) {
  await leaveGroup(page);
  const el = page.locator(`#si_element_mobile_${domId(id)}`);
  if (await isSelected(page, id)) return; // clicking a selected group would open it
  // Element hitboxes and layer rows only exist for the active section; clicking the section activates it.
  // Shared sections take two clicks: page -> "Main Site" set -> the section itself.
  for (let i = 0; i < 3 && !(await el.count()); i++) {
    await click(page, page.locator(`#si_block_mobile_${id.split('.')[0]}`));
    await page.waitForTimeout(800);
  }
  // Pick via the layers panel row (stage hitboxes can be covered by overlapping elements).
  // The row only exists once its section is expanded in the layers panel; a click into the
  // section on stage expands it (even if that click lands on an overlapping neighbour).
  const ROW = { has: ['id'], is: { layerType: ['element', 'group'], id: [id] }, attr: 'data-ai-target' };
  if (!(await page.evaluate(liveComponents, ROW)).length && await el.count()) {
    await click(page, el);
    await page.waitForTimeout(600);
    await page.evaluate(liveComponents, ROW);
  }
  await clickRow(page, page.locator('[data-ai-target]'));
  for (let i = 0; i < 3 && !(await isSelected(page, id)); i++) {
    const p = await visiblePoint(page, `#si_element_mobile_${domId(id)}`); // fallback: click on stage
    if (p) await click(page, p);
    await page.waitForTimeout(500);
  }
  if (!(await isSelected(page, id))) throw new Error(`could not select ${id}`);
}

// Click a layers-panel row on its top line: a group's row also contains its children's rows.
async function clickRow(page, row) {
  if (!(await row.count())) return false;
  // Rows low in the list sit under Showit's footer bar until scrolled into the middle.
  await row.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const rb = await row.boundingBox();
  if (rb) await click(page, { x: rb.x + rb.width / 2, y: rb.y + Math.min(rb.height / 2, 12) });
  return !!rb;
}

// A point on the mobile stage where this hitbox is really the thing under the mouse: inside the
// visible stage and not covered by another element (overlapping cards, groups half off-screen).
async function visiblePoint(page, sel) {
  const el = page.locator(sel);
  if (!(await el.count())) return null;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  return page.evaluate(sel => {
    const g = document.querySelector(sel), st = document.querySelector('[data-intercom-target="mobile stage"]')?.getBoundingClientRect();
    if (!g || !st) return null;
    const r = g.getBoundingClientRect();
    const fs = [0.5, 0.3, 0.7, 0.15, 0.85];
    for (const fy of fs) for (const fx of fs) {
      const x = r.x + r.width * fx, y = r.y + r.height * fy;
      if (x < st.x + 2 || x > st.right - 2 || y < st.y + 2 || y > st.bottom - 2) continue;
      const t = document.elementFromPoint(x, y);
      const hit = t?.closest('[id^="si_element_mobile_"]');
      if (hit === g || g.contains(t) || (!hit && /transformer/.test(String(t?.className?.baseVal ?? t?.className)))) return { x, y };
    }
    return null;
  }, sel);
}

// Inside a group: via the child's own layers row when the list shows it; otherwise open the group
// (double-click a visible part of it: Showit's group focus) and click a visible part of the child.
async function selectChild(page, id) {
  const el = page.locator(`#si_element_mobile_${domId(id)}`);
  if (await isSelected(page, id)) return;
  const gid = id.split('.').slice(0, 3).join('.');
  if (!(await el.count())) await selectTop(page, gid); // activates the section and its layers
  const ROW = { has: ['elemKey'], is: { layerType: ['element'], elemKey: [id] }, attr: 'data-ai-target' };
  const viaRow = async () => (await page.evaluate(liveComponents, ROW)).length && clickRow(page, page.locator('[data-ai-target]'));
  if (await viaRow()) { await page.waitForTimeout(600); if (await isSelected(page, id)) return; }
  if (!(await el.count())) {
    const p = await visiblePoint(page, `#si_element_mobile_${domId(gid)}`);
    if (!p) throw new Error(`could not select ${id}`);
    await moveTo(page, p);
    await page.mouse.dblclick(p.x, p.y);
    await page.waitForTimeout(800);
  }
  for (let i = 0; i < 3 && !(await isSelected(page, id)); i++) {
    if (await viaRow()) { await page.waitForTimeout(600); continue; }
    const p = await visiblePoint(page, `#si_element_mobile_${domId(id)}`);
    if (p) await click(page, p);
    await page.waitForTimeout(500);
  }
  if (!(await isSelected(page, id))) throw new Error(`could not select ${id}`);
}

// Type a value into a properties-panel field. `labels`: one label or alternatives.
async function setField(page, section, labels, value, expected) {
  const field = label => page.locator('div')
    .filter({ has: page.getByText(label, { exact: true }) })
    .filter({ has: page.locator('input') }).last().locator('input').first();
  const find = async () => {
    for (const l of [].concat(labels)) if (await field(l).isVisible().catch(() => false)) return field(l);
  };
  let input = await find();
  if (!input) {
    await click(page, page.getByText(new RegExp(`^${section}$`, 'i')).first()); // expand panel section
    await page.waitForTimeout(500);
    input = await find();
  }
  if (!input) throw new Error(`field ${labels} not found in ${section}`);
  if (await input.isDisabled()) throw new Error(`field ${labels} is disabled in ${section}`); // e.g. a group's size
  // Panels have a phone/desktop view tab (si-toggle, selected 0 = phone). Showit remembers the last
  // one used, so switch any that show desktop back to phone. View only; the checks below still apply.
  const tabs = page.locator('si-toggle.split-merge-toggle');
  for (let i = 0; i < await tabs.count(); i++) {
    const t = tabs.nth(i);
    if (await t.isVisible() && await t.evaluate(el => el.selected !== 0)) {
      await click(page, t.locator('si-button[slot="0"]'));
      await page.waitForTimeout(300);
    }
  }
  input = (await find()) || input;
  // Guard against the desktop tab still being active: the field must show the current mobile value.
  const shown = Number(await input.inputValue());
  if (Math.abs(shown - expected) > 0.5) throw new Error(`${labels} shows ${shown}, expected mobile value ${expected}; desktop tab active?`);
  await click(page, input);
  await input.fill(String(value));
  await input.press('Enter');
  await page.waitForTimeout(400);
}

// ---- verified edits ------------------------------------------------------------------------

const current = (el, k, theme) => (k === 'size' ? textSize(el, theme) : el.mobile[k]);

// Lock or unlock an element with the lock button on its layers row. The tool only unlocks to make an
// edit and locks it again right after, so the designer's locks stay as they were.
async function setLock(page, id, locked) {
  await showLayers(page);
  const child = id.split('.').length > 3;
  const ROW = child
    ? { has: ['elemKey'], is: { layerType: ['element'], elemKey: [id] }, attr: 'data-ai-target' }
    : { has: ['id'], is: { layerType: ['element', 'group'], id: [id] }, attr: 'data-ai-target' };
  if (!(await page.evaluate(liveComponents, ROW)).length) {
    await click(page, page.locator(`#si_block_mobile_${id.split('.')[0]}`)); // a section's rows show once it's active
    await page.waitForTimeout(800);
    if (!(await page.evaluate(liveComponents, ROW)).length) throw new Error(`could not find the layers row of ${id} to unlock it`);
  }
  const row = page.locator('[data-ai-target]');
  await row.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await row.hover();
  await click(page, row.locator('button[class*="lock-icon"]').first());
  await page.waitForTimeout(700);
  const m = await readModel(page);
  if (!!findEl(m, id)?.lockEditing !== locked) throw new Error(`could not ${locked ? 'lock' : 'unlock'} ${id}`);
  log({ page: m.page.name, id, note: locked ? 'locked again' : 'unlocked to edit', ok: true });
  return m;
}

// Set mobile values on one element, then verify mobile changed and desktop still looks the same.
// Returns the fresh model. On a failed check: undoes what it typed and throws.
async function applyMobile(page, model, id, target, note = '') {
  const before = findEl(model, id);
  if (!before) throw new Error(`element ${id} not found on page "${model.page.name}"`);
  const changes = Object.entries(target).map(([k, v]) => [k, Math.round(v)])
    .filter(([k, v]) => current(before, k, model.theme) !== v);
  if (!changes.length) return model;
  // Locked (by the designer, or its group is): unlock for this edit, lock again afterwards.
  const gid = id.split('.').slice(0, 3).join('.');
  const lockId = before.lockEditing ? id : gid !== id && findEl(model, gid)?.lockEditing ? gid : null;
  if (lockId) {
    model = await setLock(page, lockId, false);
    try { return await applyMobile(page, model, id, target, note); }
    finally { await setLock(page, lockId, true); }
  }
  await select(page, id);
  let typed = 0, err;
  try {
    for (const [k, v] of changes) {
      // Lines: "L" is the length (model w); "W" is stroke weight (model h).
      const label = before.type === 'line' ? { w: 'L', h: 'W' }[k] ?? FIELD[k][1] : FIELD[k][1];
      await setField(page, FIELD[k][0], label, v, current(before, k, model.theme));
      typed++;
    }
  } catch (e) { err = e; }
  const fresh = await readModel(page);
  const after = findEl(fresh, id);
  // Showit may copy an inherited style value onto the desktop element (e.g. size 14 from
  // "subheading"); that looks identical. Any other desktop change fails the check.
  const inherited = model.theme.styles?.[before.desktop?.style]?.desktop || {};
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ok = !err && changes.every(([k, v]) => after.mobile[k] === v)
    && Object.keys(before.desktop || {}).every(k => k in after.desktop)
    && Object.entries(after.desktop || {}).every(([k, v]) => same(v, before.desktop?.[k] ?? inherited[k]));
  const undo = Object.fromEntries(changes.slice(0, ok ? changes.length : 0).map(([k]) => [k, current(before, k, model.theme)]));
  log({ page: model.page.name, id, note, ok, undo, before: { mobile: before.mobile, desktop: before.desktop }, after: { mobile: after.mobile, desktop: after.desktop } });
  if (!ok) {
    await page.keyboard.press('Escape');
    for (let i = 0; i < typed; i++) await page.keyboard.press('Control+z'); // only what was typed
    throw new Error(`${err ? err.message : 'check failed'} on ${id}; undid ${typed} change(s). See fixes-log.json`);
  }
  return fresh;
}

// Is the properties panel showing this section (its name in the Name field)?
const showing = (page, block) => page.locator('input').evaluateAll((els, n) => els.some(e => e.checkVisibility() && e.value.trim() === n), block.name.trim());

// Mobile section height: select the section (canvas) and type into its height field.
async function setSectionHeight(page, model, blockId, h, note = '') {
  checkStop();
  await leaveGroup(page);
  const block = model.blocks.find(b => b.id === blockId);
  h = Math.round(h);
  if (block.mobile.h === h) return model;
  if (block.canvasSet) {
    // Shared: stage click opens "Main Site", then its layers-panel row selects the section.
    const row = page.locator(`[data-testid="layer-block-wrapper"][id="${blockId}"] [data-testid="layer-block"]`).first();
    for (let i = 0; i < 3 && !(await row.isVisible().catch(() => false)); i++) {
      await click(page, page.locator(`#si_block_mobile_${blockId}`));
      await page.waitForTimeout(800);
    }
    await click(page, row);
  } else {
    // Page section. 0) Its row in the layers list (works even when elements cover the whole section).
    await showLayers(page);
    const ROW = { has: ['id'], is: { layerType: ['block'], id: [blockId] }, attr: 'data-ai-target' };
    if ((await page.evaluate(liveComponents, ROW)).length) {
      await clickRow(page, page.locator('[data-ai-target]'));
      await page.waitForTimeout(600);
    }
    // 1) Click an empty corner inside it (selects the section itself).
    // 2) If corners are covered by elements: click into another section, then back into this one
    //    (the first click into an inactive section selects the section). Needs a second section.
    const box = page.locator(`#si_block_mobile_${blockId}`);
    await box.scrollIntoViewIfNeeded();
    const b = await box.boundingBox();
    for (const [fx, fy] of [[0, 1], [1, 1], [0, 0], [1, 0]]) {
      if (await showing(page, block)) break;
      await click(page, { x: b.x + 4 + fx * (b.width - 8), y: b.y + 4 + fy * (b.height - 8) });
      await page.waitForTimeout(600);
    }
    const other = page.locator(`.selectable[id^="si_element_mobile_"]:not([id^="si_element_mobile_${blockId}_elements_"])`).first();
    if (!(await showing(page, block)) && await other.count()) {
      await click(page, other);
      await page.waitForTimeout(500);
      // Its top-most element: lower ones may hang past the section and sit under a neighbour.
      const top = block.elements.map((e, i) => ({ e, i })).filter(({ e }) => e.visible !== 'd' && e.mobile)
        .sort((a, c) => a.e.mobile.y - c.e.mobile.y)[0];
      if (top) await click(page, page.locator(`#si_element_mobile_${blockId}_elements_${top.i}`));
    }
  }
  await page.waitForTimeout(600);
  // Make sure the panel is showing THIS section before typing.
  if (!(await showing(page, block))) throw new Error(`could not select section ${block.name.trim()}; set its mobile height by hand`);
  await setField(page, 'Canvas', ['Initial Height', 'Minimum Height', 'Height'], h, block.mobile.h);
  const fresh = await readModel(page);
  const after = fresh.blocks.find(x => x.id === blockId);
  const ok = after.mobile.h === h && JSON.stringify(after.desktop) === JSON.stringify(block.desktop);
  log({ page: model.page.name, id: blockId, note, ok, undo: ok ? { sectionH: block.mobile.h } : {}, before: { mobile: block.mobile }, after: { mobile: after.mobile } });
  if (!ok) throw new Error(`section ${block.name.trim()}: height check failed (mobile ${after.mobile.h}, wanted ${h})`);
  return fresh;
}

module.exports = { DATA, STOP, FIELD, RUN, flag, eachPage, toPage, listPages, openPage, select, setField, applyMobile, setSectionHeight, findEl, log, readLog, say };
