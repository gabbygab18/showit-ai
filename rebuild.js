// Rebuild one section's MOBILE layout from its DESKTOP layout: single column, reading order.
//   node rebuild.js "Section name" [--page "About"]           show the plan (no edits)
//   node rebuild.js "Section name" [--page "About"] --apply   rebuild it (undo with: node restore.js)
//   node rebuild.js --selftest
// Desktop is never touched. Mobile-only elements are left where they are.
const { readModel, MOBILE_W } = require('./audit');
const { RUN, eachPage, applyMobile, setSectionHeight, say } = require('./editor');

const M = 20;                 // side margin
const CW = MOBILE_W - 2 * M;  // content width
const GAP = 16;               // space between stacked elements
const PAD = 40;               // section top/bottom padding
const DESKTOP_W = 1200;

const textBoxH = k => Math.ceil(k.dy + k.h) + 2;

// Pure layout plan. ink: measured text (for estimates only; real text heights are measured live).
// top: space above the first element (more when the site header floats over this section).
function plan(block, ink = {}, top = PAD) {
  const items = block.elements.map((e, i) => ({ e, id: `${block.id}.elements.${i}` }))
    .filter(({ e }) => e.visible === 'a' && e.desktop && e.mobile);
  const dh = block.desktop.h;
  const isBg = ({ e }) => e.type === 'graphic' && e.desktop.w >= 0.9 * DESKTOP_W && e.desktop.h >= 0.9 * dh;
  const bg = items.filter(isBg);
  // Reading order: rows (tops within 20px) top to bottom, then left to right.
  const flow = items.filter(x => !isBg(x)).sort((a, b) =>
    Math.abs(a.e.desktop.y - b.e.desktop.y) < 20 ? a.e.desktop.x - b.e.desktop.x : a.e.desktop.y - b.e.desktop.y);

  let y = top;
  const steps = flow.map(({ e, id }) => {
    const d = e.desktop;
    let w, h, x;
    if (e.type === 'text') {
      w = CW; x = M;
      const k = ink[id];
      h = k ? textBoxH({ dy: k.dy, h: k.h * Math.max(1, k.w / CW) }) : e.mobile.h; // estimate; re-measured live
    } else {
      const big = ['graphic', 'gallery', 'video'].includes(e.type) && d.w >= 400;
      w = big ? CW : Math.min(CW, ['graphic', 'gallery', 'video'].includes(e.type) ? Math.max(100, d.w * 0.6) : d.w);
      w = Math.round(w);
      h = e.type === 'line' ? e.mobile.h : Math.round(d.h * w / d.w); // line h = stroke weight, keep
      x = Math.round((MOBILE_W - w) / 2);
    }
    const step = { id, type: e.type, target: { x, y, w, h } };
    y += h + GAP;
    return step;
  });
  // Only a background (a photo hero): nothing to stack, so keep the section's height instead of collapsing it.
  const sectionH = flow.length ? Math.max(y - GAP + PAD, 100) : Math.max(block.mobile?.h || 0, Math.round(dh * MOBILE_W / DESKTOP_W));
  return { steps, bg: bg.map(({ id }) => ({ id, target: { x: 0, y: 0, w: MOBILE_W, h: sectionH } })), sectionH,
    mobileOnly: block.elements.filter(e => e.visible === 'm').length };
}

async function rebuild(page, model, block, apply) {
  // The page's first section sits under the shared header, which floats over it on phones.
  const header = model.blocks.find(b => b.canvasSet && b.mobile?.h <= 1 && model.blocks.indexOf(b) < model.blocks.indexOf(block));
  const first = model.blocks.filter(b => !b.canvasSet)[0] === block;
  const headerBottom = first && header ? Math.max(0, ...header.elements.filter(e => e.visible !== 'd' && e.mobile).map(e => e.mobile.y + e.mobile.h)) : 0;
  const top = Math.max(PAD, headerBottom + 24);
  const p = plan(block, model.ink, top);
  const locked = block.elements.filter(e => e.lockEditing && e.visible === 'a').length;
  if (locked) throw new Error(`${block.name.trim()} has ${locked} locked element(s); unlock them in Showit first`);
  console.log(`${block.name.trim()}: ${p.steps.length} element(s) stacked, ${p.bg.length} background(s), section height ~${p.sectionH}` +
    (p.mobileOnly ? `; ${p.mobileOnly} mobile-only element(s) left as is` : ''));
  if (!apply) {
    for (const s of p.steps) console.log(`  ${s.id} ${s.type} -> ${JSON.stringify(s.target)}`);
    await say(page, `Plan for ${block.name.trim()}: ${p.steps.length} elements in one column, height ~${p.sectionH}px. Add --apply to rebuild.`);
    return;
  }
  const note = `rebuild ${block.name.trim()}`;
  let y = top;
  for (const s of p.steps) {
    await say(page, `Placing ${s.type} ${p.steps.indexOf(s) + 1}/${p.steps.length}`);
    let t = { ...s.target, y };
    if (s.type === 'text') {
      model = await applyMobile(page, model, s.id, { x: t.x, w: t.w }, note); // width first, then measure
      const k = model.ink[s.id];
      t = { ...t, h: k ? textBoxH(k) : t.h };
    }
    model = await applyMobile(page, model, s.id, t, note);
    y += t.h + GAP;
  }
  const sectionH = p.steps.length ? Math.max(y - GAP + PAD, 100) : p.sectionH;
  model = await setSectionHeight(page, model, block.id, sectionH, note);
  for (const b of p.bg) model = await applyMobile(page, model, b.id, { ...b.target, h: sectionH }, note);
  await say(page, `${block.name.trim()} rebuilt for mobile.`);
  console.log(`  done, section height ${sectionH}. Undo with: node restore.js ${RUN}`);
}

function selftest() {
  const assert = require('assert');
  const block = {
    id: 'S', desktop: { h: 800 }, mobile: { h: 500 }, elements: [
      { type: 'graphic', visible: 'a', desktop: { x: 0, y: 0, w: 1200, h: 800 }, mobile: {} },          // bg
      { type: 'text', visible: 'a', desktop: { x: 700, y: 100, w: 400, h: 60 }, mobile: { h: 30 } },     // row 1, right
      { type: 'graphic', visible: 'a', desktop: { x: 100, y: 110, w: 500, h: 500 }, mobile: {} },       // row 1, left (big)
      { type: 'icon', visible: 'a', desktop: { x: 700, y: 300, w: 40, h: 40 }, mobile: {} },
      { type: 'text', visible: 'd', desktop: { x: 0, y: 0, w: 10, h: 10 }, mobile: {} },                 // desktop-only
      { type: 'text', visible: 'm', desktop: { x: 0, y: 0, w: 10, h: 10 }, mobile: {} },                 // mobile-only
    ],
  };
  const p = plan(block, { 'S.elements.1': { dy: 2, h: 20, w: 140 } });
  assert.deepStrictEqual(p.steps.map(s => [s.id, s.target]), [
    ['S.elements.2', { x: 20, y: 40, w: 280, h: 280 }],
    ['S.elements.1', { x: 20, y: 336, w: 280, h: 24 }],
    ['S.elements.3', { x: 140, y: 376, w: 40, h: 40 }],
  ]);
  assert.strictEqual(p.sectionH, 456);
  assert.deepStrictEqual(p.bg, [{ id: 'S.elements.0', target: { x: 0, y: 0, w: 320, h: 456 } }]);
  assert.strictEqual(p.mobileOnly, 1);
  // Photo hero (background only): keeps its height instead of collapsing to the padding.
  const hero = { id: 'H', desktop: { h: 812 }, mobile: { h: 500 }, elements: [block.elements[0]] };
  assert.strictEqual(plan(hero, {}, 90).sectionH, 500);
  console.log('selftest ok');
}

async function main(page) {
  if (process.argv.includes('--sections')) { // for the app's dropdown: this page's own sections
    const m = await readModel(page);
    return console.log(JSON.stringify({ page: m.page.name, sections: m.blocks.filter(b => !b.canvasSet && b.elements.length).map(b => b.name.trim()) }));
  }
  const name = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--page');
  if (!name) throw new Error('usage: node rebuild.js "Section name" [--page "Page"] [--apply]');
  for await (const pageName of eachPage(page)) {
    const model = await readModel(page);
    const block = model.blocks.find(b => b.name.trim().toLowerCase() === name.toLowerCase());
    if (!block) throw new Error(`no section "${name}" on page ${pageName}. Sections: ${model.blocks.map(b => b.name.trim()).join(', ')}`);
    if (block.canvasSet) console.log('Note: shared section, changes apply to every page.');
    await rebuild(page, model, block, process.argv.includes('--apply'));
  }
}

module.exports = { plan };
if (require.main === module) {
  if (process.argv.includes('--selftest')) selftest();
  else require('./connect').run(main);
}
