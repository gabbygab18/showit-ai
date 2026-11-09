// Rebuild one section's MOBILE layout from its DESKTOP layout: single column, reading order.
//   node rebuild.js "Section name" [--page "About"]           show the plan (no edits)
//   node rebuild.js "Section name" [--page "About"] --apply   rebuild it (undo with: node restore.js)
//   node rebuild.js --selftest
// Desktop is never touched. Mobile-only and locked elements are left where they are.
const { readModel, textSize, MOBILE_W, MIN_TEXT, MIN_HERO, DESKTOP_W } = require('./audit');
const { RUN, eachPage, applyMobile, setSectionHeight, findEl, say } = require('./editor');

const M = 20;                 // side margin
const CW = MOBILE_W - 2 * M;  // content width
const GAP = 16;               // space between stacked elements
const PAD = 40;               // section top/bottom padding
const INSET = 16;             // padding inside a photo for text laid over it
const ROW_GAP = 8;            // between icons kept side by side
const MEDIA = ['graphic', 'gallery', 'video'];

const textBoxH = k => Math.ceil(k.dy + k.h) + 2;

// Pure layout plan. ink: measured text (for estimates only; real text heights are measured live).
// top: space above the first element (more when the site header floats over this section).
// Units, top to bottom: { kind, y, h, steps: [{ id, type, target }] }
//   one:  a single element, full width (text) or scaled (media)
//   row:  small non-text items side by side on desktop (stars, social icons) stay side by side
//   over: a photo plus the text laid over it on desktop; the text stays on the photo
function plan(block, ink = {}, top = PAD) {
  const items = block.elements.map((e, i) => ({ e, id: `${block.id}.elements.${i}` }))
    .filter(({ e }) => e.visible === 'a' && e.desktop && e.mobile && !e.lockEditing);
  const dh = block.desktop.h;
  const isBg = ({ e }) => e.type === 'graphic' && e.desktop.w >= 0.9 * DESKTOP_W && e.desktop.h >= 0.9 * dh;
  const bg = items.filter(isBg);
  const rest = items.filter(x => !isBg(x));
  // Text whose middle sits on a (clearly bigger) photo on desktop belongs to that photo.
  const on = (t, g) => {
    const a = t.e.desktop, b = g.e.desktop, cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    return cx > b.x && cx < b.x + b.w && cy > b.y && cy < b.y + b.h && b.w * b.h > 1.5 * a.w * a.h;
  };
  const host = new Map();
  for (const t of rest.filter(x => x.e.type === 'text')) {
    const g = rest.find(o => MEDIA.includes(o.e.type) && on(t, o));
    if (g) host.set(t, g);
  }
  // Reading order: rows (tops within 20px) top to bottom, then left to right.
  const flow = rest.filter(x => !host.has(x)).sort((a, b) =>
    Math.abs(a.e.desktop.y - b.e.desktop.y) < 20 ? a.e.desktop.x - b.e.desktop.x : a.e.desktop.y - b.e.desktop.y);
  const rows = [];
  for (const x of flow) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(r[0].e.desktop.y - x.e.desktop.y) < 20) r.push(x); else rows.push([x]);
  }
  const small = x => x.e.type !== 'text' && x.e.desktop.w <= 120;
  const textH = (id, e, w) => { const k = ink[id]; return k ? textBoxH({ dy: k.dy, h: k.h * Math.max(1, k.w / w) }) : e.mobile.h; };

  let y = top;
  const units = [];
  for (const r of rows) {
    if (r.length > 1 && r.every(small)) {
      // Keep the row: each item at its mobile size (or half its desktop size), shrunk together if too wide.
      const sizes = r.map(({ e: { mobile: m, desktop: d } }) => (m.w > 0 && m.h > 0 ? [m.w, m.h] : [d.w / 2, d.h / 2]));
      const total = sizes.reduce((s, [w]) => s + w, 0) + ROW_GAP * (r.length - 1);
      const k = Math.min(1, CW / total);
      const h = Math.round(Math.max(...sizes.map(([, sh]) => sh)) * k);
      let x = Math.round((MOBILE_W - total * k) / 2);
      const steps = r.map(({ e, id }, i) => {
        const w = Math.round(sizes[i][0] * k), sh = Math.round(sizes[i][1] * k);
        const step = { id, type: e.type, target: { x, y: y + Math.round((h - sh) / 2), w, h: sh } };
        x += w + Math.round(ROW_GAP * k);
        return step;
      });
      units.push({ kind: 'row', y, h, steps });
      y += h + GAP;
      continue;
    }
    for (const g of r) {
      const { e, id } = g, d = e.desktop;
      let w, h, x;
      // Text wider than the whole desktop canvas is a marquee/decoration: keep its mobile size, only move it.
      const keep = e.type === 'text' && d.w > DESKTOP_W;
      if (keep) {
        ({ x, w, h } = e.mobile);
      } else if (e.type === 'text') {
        w = CW; x = M; h = textH(id, e, w);
      } else {
        const big = MEDIA.includes(e.type) && d.w >= 400;
        w = Math.round(big ? CW : Math.min(CW, MEDIA.includes(e.type) ? Math.max(100, d.w * 0.6) : d.w));
        h = e.type === 'line' ? e.mobile.h : Math.round(d.h * w / d.w); // line h = stroke weight, keep
        x = Math.round((MOBILE_W - w) / 2);
      }
      const steps = [{ id, type: e.type, keep, target: { x, y, w, h } }];
      const over = rest.filter(t => host.get(t) === g).sort((a, b) => a.e.desktop.y - b.e.desktop.y);
      if (over.length) {
        // Text on a photo: photo width minus padding, stacked and centred on it; the photo grows if needed.
        const tw = w - 2 * INSET, hs = over.map(t => textH(t.id, t.e, tw));
        const total = hs.reduce((s, v) => s + v, 0) + GAP * (over.length - 1);
        if (total + 2 * INSET > h) steps[0].target.h = h = total + 2 * INSET;
        let ty = y + Math.round((h - total) / 2);
        over.forEach((t, i) => { steps.push({ id: t.id, type: 'text', target: { x: x + INSET, y: ty, w: tw, h: hs[i] } }); ty += hs[i] + GAP; });
      }
      units.push({ kind: over.length ? 'over' : 'one', y, h, steps });
      y += h + GAP;
    }
  }
  // Only a background (a photo hero): nothing to stack, so keep the section's height instead of collapsing it.
  const sectionH = units.length ? Math.max(y - GAP + PAD, 100)
    : Math.max(block.mobile?.h || 0, Math.round(dh * MOBILE_W / DESKTOP_W), block.desktop.nature === 'wH' ? MIN_HERO : 0);
  return {
    units, steps: units.flatMap(u => u.steps), sectionH,
    bg: bg.map(({ id }) => ({ id, target: { x: 0, y: 0, w: MOBILE_W, h: sectionH } })),
    mobileOnly: block.elements.filter(e => e.visible === 'm').length,
  };
}

// Live: set a text's width, measure it, and shrink the font if one word is still wider than the box.
// Returns [model, measured box height].
async function placeText(page, model, id, x, w, note) {
  model = await applyMobile(page, model, id, { x, w }, note);
  let k = model.ink[id];
  if (k && k.w > w + 2) {
    const size = textSize(findEl(model, id), model.theme);
    model = await applyMobile(page, model, id, { size: Math.max(MIN_TEXT, Math.floor(size * w / k.w)) }, note);
    k = model.ink[id];
  }
  return [model, k ? textBoxH(k) : findEl(model, id).mobile.h];
}

// Returns the fresh model.
async function rebuild(page, model, block, apply) {
  // The page's first section sits under the shared header, which floats over it on phones.
  const header = model.blocks.find(b => b.canvasSet && b.mobile?.h <= 1 && model.blocks.indexOf(b) < model.blocks.indexOf(block));
  const first = model.blocks.filter(b => !b.canvasSet)[0] === block;
  const headerBottom = first && header ? Math.max(0, ...header.elements.filter(e => e.visible !== 'd' && e.mobile).map(e => e.mobile.y + e.mobile.h)) : 0;
  const top = Math.max(PAD, headerBottom + 24);
  const p = plan(block, model.ink, top);
  const name = block.name.trim();
  const locked = block.elements.filter(e => e.lockEditing && e.visible === 'a').length;
  console.log(`${name}: ${p.steps.length} element(s) laid out, ${p.bg.length} background(s), section height ~${p.sectionH}` +
    (p.mobileOnly ? `; ${p.mobileOnly} mobile-only element(s) left as is` : '') + (locked ? `; ${locked} locked element(s) left as is` : ''));
  if (!apply) {
    for (const s of p.steps) console.log(`  ${s.id} ${s.type} -> ${JSON.stringify(s.target)}`);
    await say(page, `Plan for ${name}: ${p.steps.length} elements, height ~${p.sectionH}px. Add --apply to rebuild.`);
    return model;
  }
  const note = `rebuild ${name}`;
  let y = top, n = 0;
  for (const u of p.units) {
    await say(page, `Laying out ${name}: ${++n}/${p.units.length}`);
    if (u.kind === 'row') {
      for (const s of u.steps) model = await applyMobile(page, model, s.id, { ...s.target, y: y + s.target.y - u.y }, note);
      y += u.h + GAP;
      continue;
    }
    const [lead, ...over] = u.steps;
    const t = { ...lead.target, y };
    if (lead.keep) { model = await applyMobile(page, model, lead.id, { y }, note); y += t.h + GAP; continue; }
    if (lead.type === 'text') [model, t.h] = await placeText(page, model, lead.id, t.x, t.w, note);
    if (over.length) {
      // Measure the text on the photo first, then size the photo and centre the text on it.
      const hs = [];
      for (const s of over) { let h; [model, h] = await placeText(page, model, s.id, s.target.x, s.target.w, note); hs.push(h); }
      const total = hs.reduce((a, b) => a + b, 0) + GAP * (over.length - 1);
      t.h = Math.max(lead.target.h, total + 2 * INSET);
      model = await applyMobile(page, model, lead.id, t, note);
      let ty = y + Math.round((t.h - total) / 2);
      for (const [i, s] of over.entries()) {
        model = await applyMobile(page, model, s.id, { x: s.target.x, y: ty, w: s.target.w, h: hs[i] }, note);
        ty += hs[i] + GAP;
      }
    } else {
      model = await applyMobile(page, model, lead.id, t, note);
    }
    y += t.h + GAP;
  }
  const sectionH = p.units.length ? Math.max(y - GAP + PAD, 100) : p.sectionH;
  model = await setSectionHeight(page, model, block.id, sectionH, note);
  for (const b of p.bg) model = await applyMobile(page, model, b.id, { ...b.target, h: sectionH }, note);
  await say(page, `${name} rebuilt for mobile.`);
  console.log(`  done, section height ${sectionH}. Undo with: node restore.js ${RUN}`);
  return model;
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
  assert.strictEqual(plan({ ...hero, mobile: { h: 114 }, desktop: { h: 812, nature: 'wH' } }, {}, 90).sectionH, 480);
  // Five stars in a row stay a row; a caption laid over a photo stays on the photo.
  const star = x => ({ type: 'icon', visible: 'a', desktop: { x, y: 20, w: 24, h: 34 }, mobile: { w: 17, h: 17 } });
  const mix = { id: 'T', desktop: { h: 900 }, mobile: { h: 400 }, elements: [
    star(100), star(124), star(148), star(172), star(196),
    { type: 'graphic', visible: 'a', desktop: { x: 100, y: 100, w: 600, h: 400 }, mobile: {} },
    { type: 'text', visible: 'a', desktop: { x: 200, y: 250, w: 400, h: 60 }, mobile: { h: 30 } },
    { type: 'text', visible: 'a', desktop: { x: -1109, y: 600, w: 5720, h: 212 }, mobile: { x: -227, y: 5, w: 1283, h: 41 } }, // marquee
  ] };
  const q = plan(mix, { 'T.elements.6': { dy: 0, h: 30, w: 200 } });
  assert.deepStrictEqual(q.units.map(u => u.kind), ['row', 'over', 'one']);
  assert.deepStrictEqual(q.units[2].steps[0].target, { x: -227, y: 276, w: 1283, h: 41 }); // marquee only moves
  assert.deepStrictEqual(q.units[0].steps.map(s => s.target.x), [102, 127, 152, 177, 202]); // 5×17 + 4×8 = 117 wide, centred
  assert.deepStrictEqual(q.units[1].steps.map(s => s.target), [
    { x: 20, y: 73, w: 280, h: 187 },
    { x: 36, y: 151, w: 248, h: 32 },  // centred on the photo
  ]);
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

module.exports = { plan, rebuild };
if (require.main === module) {
  if (process.argv.includes('--selftest')) selftest();
  else require('./connect').run(main);
}
