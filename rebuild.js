// Rebuild one section's MOBILE layout from its DESKTOP layout: single column, reading order.
//   node rebuild.js "Section name" [--page "About"]           show the plan (no edits)
//   node rebuild.js "Section name" [--page "About"] --apply   rebuild it (undo with: node restore.js)
//   node rebuild.js --selftest
// Desktop is never touched. Mobile-only and locked elements are left where they are.
const { readModel, textSize, blownUp, phoneSize, turned, MOBILE_W, MIN_TEXT, MIN_HERO, DESKTOP_W } = require('./audit');
// Editor actions; eval.js swaps in an offline simulator (useEditor) to score layouts without Showit.
let ed = require('./editor');
const useEditor = e => { ed = e; };
const applyMobile = (...a) => ed.applyMobile(...a);
const setSectionHeight = (...a) => ed.setSectionHeight(...a);
const findEl = (...a) => ed.findEl(...a);
const say = (...a) => ed.say(...a);

// Spacing and sizes measured from Showit's own templates' phone layouts (test/fixtures, medians):
// text 29px from the edge, 21px between texts, 30px between a photo and text, sections padded 50/67,
// paragraphs 15px, buttons 41px tall.
const M = 24;                 // side margin
const CW = MOBILE_W - 2 * M;  // content width
const TEXT_GAP = 14;          // between texts that read together (heading, paragraph)
const GAP = 24;               // between different things (photo and text, text and button)
const CARD_GAP = 32;          // between cards
const PAD_TOP = 48;           // section padding
const PAD_BOT = 56;
const BODY = 14;              // smallest paragraph size on a phone
const HEAD_LINES = 3;         // longest a big heading should wrap
const BUTTON_H = 44;          // comfortable tap target
const BUTTON_W = 160;
const kindOf = u => (u.kind === 'group' ? 'card' : u.kind === 'one' && u.steps[0].type === 'text' && !u.steps[0].keep ? 'text' : 'block');
const gapFor = (a, b) => (a === 'text' && b === 'text' ? TEXT_GAP : a === 'card' && b === 'card' ? CARD_GAP : GAP);
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
//   group: a Showit group (a card: photo + title + text...). Its insides are laid out the same way,
//          in the group's own coordinates, then the group is moved (Showit won't resize a group).
// o: { left, width } of the column (default: the screen minus margins); inner: laying out a group's insides;
//    byMobile: the section has a hand-made phone layout (mobile-only elements), so follow the phone's order.
function plan(block, ink = {}, top = PAD_TOP, o = {}) {
  const L = o.left ?? M, W = o.width ?? CW;
  const mobileOnly = block.elements.filter(e => e.visible === 'm').length;
  if (o.byMobile) {
    // Read the phone layout as if it were the desktop one (scaled up), mobile-only elements included.
    const S = DESKTOP_W / MOBILE_W;
    const virt = e => ({
      ...e, visible: e.visible === 'm' ? 'a' : e.visible, _rd: e._rd ?? e.desktop, // _rd: the real desktop box
      desktop: e.mobile && { ...e.desktop, x: (e.mobile.x || 0) * S, y: (e.mobile.y || 0) * S, w: e.mobile.w * S, h: e.mobile.h * S },
      ...(e.elements ? { elements: Object.fromEntries(Object.entries(e.elements).map(([k, c]) => [k, virt(c)])) } : {}),
    });
    block = { ...block, desktop: { ...block.desktop, h: (block.mobile?.h || 0) * S }, elements: block.elements.map(virt) };
  }
  const items = block.elements.map((e, i) => ({ e, id: e._id ?? `${block.id}.elements.${i}` }))
    .filter(({ e }) => e.visible === 'a' && e.desktop && e.mobile); // locked ones too: applyMobile unlocks and re-locks
  const dh = block.desktop.h;
  const isBg = ({ e }) => !o.inner && e.type === 'graphic' && e.desktop.w >= 0.9 * DESKTOP_W && e.desktop.h >= 0.9 * dh;
  const bg = items.filter(isBg);
  const rest = items.filter(x => !isBg(x));
  // Text whose middle sits on a (clearly bigger) photo on desktop belongs to that photo. Always judged on
  // the real desktop layout: on a broken phone layout, text lying on a photo is the bug, not the design.
  const on = (t, g) => {
    const a = t.e._rd ?? t.e.desktop, b = g.e._rd ?? g.e.desktop;
    if (!a?.w || !b?.w) return false;
    const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    return cx > b.x && cx < b.x + b.w && cy > b.y && cy < b.y + b.h && b.w * b.h > 1.5 * a.w * a.h;
  };
  const host = new Map();
  for (const t of rest.filter(x => x.e.type === 'text')) {
    // Hosts: photos, and coloured boxes (a text panel or card background).
    const g = rest.find(o => (MEDIA.includes(o.e.type) || o.e.type === 'simple') && on(t, o));
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

  let y = top, end = null, prevK = null;
  const at = k => { y = end === null ? top : end + gapFor(prevK, k); prevK = k; }; // next unit's top
  const units = [];
  for (const r of rows) {
    if (r.length > 1 && r.every(small)) {
      at('block');
      // Keep the row: each item at its mobile size (or half its desktop size), shrunk together if too wide.
      const sizes = r.map(({ e: { mobile: m, desktop: d } }) => (m.w > 0 && m.h > 0 ? [m.w, m.h] : [d.w / 2, d.h / 2]));
      const total = sizes.reduce((s, [w]) => s + w, 0) + ROW_GAP * (r.length - 1);
      const k = Math.min(1, W / total);
      const h = Math.round(Math.max(...sizes.map(([, sh]) => sh)) * k);
      let x = Math.round(L + (W - total * k) / 2);
      const steps = r.map(({ e, id }, i) => {
        const w = Math.round(sizes[i][0] * k), sh = Math.round(sizes[i][1] * k);
        const step = { id, type: e.type, target: { x, y: y + Math.round((h - sh) / 2), w, h: sh } };
        x += w + Math.round(ROW_GAP * k);
        return step;
      });
      units.push({ kind: 'row', y, h, steps });
      end = y + h;
      continue;
    }
    for (const g of r) {
      const { e, id } = g, d = e.desktop;
      if (e.type === 'group' && e.elements) {
        at('card');
        const kids = (e.elementOrder || Object.keys(e.elements)).filter(c => e.elements[c])
          .map(c => ({ ...e.elements[c], _id: `${id}.elements.${c}` }));
        const inner = plan({ id, desktop: { h: d.h }, mobile: {}, elements: kids }, ink, 0, { left: 0, width: W, inner: true, groupW: d.w, byMobile: o.byMobile });
        const h = Math.max(1, inner.innerH);
        units.push({ kind: 'group', y, h, id, inner: inner.units, steps: [...inner.steps, { id, type: 'group', target: { x: L, y, w: W, h } }] });
        end = y + h;
        continue;
      }
      let w, h, x;
      // Text wider than the whole desktop canvas is a marquee/decoration: keep its mobile size, only move it.
      // A rotated element (vertical label) also keeps its size; it's centred and stacked by its turned box.
      const tb = turned(e.mobile), turn = tb !== e.mobile;
      const keep = turn || (e.type === 'text' && d.w > DESKTOP_W);
      let off = 0;
      if (keep) {
        ({ x, w, h } = e.mobile);
        if (turn) { x = Math.round(L + (W - w) / 2); off = Math.round((tb.h - e.mobile.h) / 2); h = Math.round(tb.h); }
      } else if (e.type === 'text') {
        w = W; x = L; h = textH(id, e, w);
      } else if (e.type === 'button') {
        // A comfortable tap target, centred.
        w = Math.round(Math.min(W, Math.max(BUTTON_W, o.byMobile ? e.mobile.w : d.w * 0.6)));
        h = Math.max(BUTTON_H, e.mobile.h || 0);
        x = Math.round(L + (W - w) / 2);
      } else if (o.byMobile) {
        // Hand-made phone layout: keep the designer's phone size, just fit it in the column.
        w = Math.round(Math.min(W, e.mobile.w));
        h = e.type === 'line' ? e.mobile.h : Math.round(e.mobile.h * w / e.mobile.w);
        x = Math.round(L + (W - w) / 2);
      } else {
        // Big photos go full width; in a card (group), so does its main photo.
        // ...and a photo with text laid on it, so the text has room.
        const hosting = rest.some(t => host.get(t) === g);
        const big = (MEDIA.includes(e.type) && (d.w >= 400 || (o.groupW && d.w >= 0.6 * o.groupW))) || hosting;
        w = Math.round(big ? W : Math.min(W, MEDIA.includes(e.type) ? Math.max(100, d.w * 0.6) : d.w));
        h = e.type === 'line' ? e.mobile.h : Math.round(d.h * w / d.w); // line h = stroke weight, keep
        x = Math.round(L + (W - w) / 2);
      }
      at(e.type === 'text' && !keep ? 'text' : 'block');
      const steps = [{ id, type: e.type, keep, off, target: { x, y, w, h } }];
      const over = rest.filter(t => host.get(t) === g).sort((a, b) => a.e.desktop.y - b.e.desktop.y);
      if (over.length) {
        // Text on a photo: photo width minus padding, stacked and centred on it; the photo grows if needed.
        const tw = w - 2 * INSET, hs = over.map(t => textH(t.id, t.e, tw));
        const total = hs.reduce((s, v) => s + v, 0) + TEXT_GAP * (over.length - 1);
        if (total + 2 * INSET > h) steps[0].target.h = h = total + 2 * INSET;
        let ty = y + Math.round((h - total) / 2);
        over.forEach((t, i) => { steps.push({ id: t.id, type: 'text', target: { x: x + INSET, y: ty, w: tw, h: hs[i] } }); ty += hs[i] + TEXT_GAP; });
      }
      units.push({ kind: over.length ? 'over' : 'one', y, h, steps });
      end = y + h;
    }
  }
  // Only a background (a photo hero): nothing to stack, so keep the section's height instead of collapsing it.
  const sectionH = units.length ? Math.max(end + PAD_BOT, 100)
    : Math.max(block.mobile?.h || 0, Math.round(dh * MOBILE_W / DESKTOP_W), block.desktop.nature === 'wH' ? MIN_HERO : 0);
  return {
    units, steps: units.flatMap(u => u.steps), sectionH, innerH: units.length ? end - top : 0,
    bg: bg.map(({ id }) => ({ id, target: { x: 0, y: 0, w: MOBILE_W, h: sectionH } })),
    mobileOnly,
  };
}

// Live: set a text's width, measure it, and shrink the font if one word is still wider than the box.
// Returns [model, measured box height].
async function placeText(page, model, id, x, w, note) {
  const el = findEl(model, id);
  const fix = blownUp(el, model.theme) ? { size: phoneSize(el, model.theme) } : {}; // a typo'd huge font
  model = await applyMobile(page, model, id, { x, w, ...fix }, note);
  let k = model.ink[id];
  if (k && k.w > w + 2) {
    const size = textSize(findEl(model, id), model.theme);
    model = await applyMobile(page, model, id, { size: Math.max(MIN_TEXT, Math.floor(size * w / k.w)) }, note);
    k = model.ink[id];
  }
  // Readable on a phone: paragraphs at least 14px; a big heading no more than 3 lines.
  let size = textSize(findEl(model, id), model.theme);
  if (k && k.lines >= 3 && size < BODY) { model = await applyMobile(page, model, id, { size: BODY }, note); k = model.ink[id]; size = BODY; }
  for (let i = 0; i < 3 && k && k.lines > HEAD_LINES && size > 32; i++) {
    size = Math.max(32, Math.round(size * 0.85));
    model = await applyMobile(page, model, id, { size }, note);
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
  const top = Math.max(PAD_TOP, headerBottom + 24);
  const p = plan(block, model.ink, top, { byMobile: block.elements.some(e => e.visible === 'm') });
  const name = block.name.trim();
  const locked = block.elements.filter(e => e.lockEditing && e.visible === 'a').length;
  console.log(`${name}: ${p.steps.length} element(s) laid out, ${p.bg.length} background(s), section height ~${p.sectionH}` +
    (p.mobileOnly ? `; has ${p.mobileOnly} mobile-only element(s), so the phone's order is kept` : '') + (locked ? `; ${locked} locked element(s) are unlocked for the edit and locked again` : ''));
  if (!apply) {
    for (const s of p.steps) console.log(`  ${s.id} ${s.type} -> ${JSON.stringify(s.target)}`);
    await say(page, `Plan for ${name}: ${p.steps.length} elements, height ~${p.sectionH}px. Add --apply to rebuild.`);
    return model;
  }
  const note = `rebuild ${name}`;
  let y;
  [model, y] = await layOut(page, model, p.units, top, note, name);
  const sectionH = p.units.length ? Math.max(y + PAD_BOT, 100) : p.sectionH;
  model = await setSectionHeight(page, model, block.id, sectionH, note);
  for (const b of p.bg) model = await applyMobile(page, model, b.id, { ...b.target, h: sectionH }, note);
  await say(page, `${name} rebuilt for mobile.`);
  console.log(`  done, section height ${sectionH}. Undo with: node restore.js ${ed.RUN}`);
  return model;
}

// Places units top to bottom from `top` (live: text heights are measured as we go). Returns [model, bottom].
async function layOut(page, model, units, top, note, name) {
  let y = top, end = null, prevK = null, n = 0;
  for (const u of units) {
    if (name) await say(page, `Laying out ${name}: ${++n}/${units.length}`);
    const k = kindOf(u);
    y = end === null ? top : end + gapFor(prevK, k);
    prevK = k;
    if (u.kind === 'group') {
      // Move the group into place first (on screen, so it can be opened), lay out its insides in its
      // own coordinates, then put it back in place (its box can shift as its insides change).
      const g = u.steps[u.steps.length - 1].target;
      model = await applyMobile(page, model, u.id, { x: g.x, y }, note);
      let bottom;
      [model, bottom] = await layOut(page, model, u.inner, 0, note);
      model = await applyMobile(page, model, u.id, { x: g.x, y }, note);
      end = y + Math.max(bottom, 1);
      continue;
    }
    if (u.kind === 'row') {
      for (const s of u.steps) model = await applyMobile(page, model, s.id, { ...s.target, y: y + s.target.y - u.y }, note);
      end = y + u.h;
      continue;
    }
    const [lead, ...over] = u.steps;
    const t = { ...lead.target, y };
    if (lead.keep) {
      model = await applyMobile(page, model, lead.id, lead.off ? { x: lead.target.x, y: y + lead.off } : { y }, note);
      end = y + t.h;
      continue;
    }
    if (lead.type === 'text') [model, t.h] = await placeText(page, model, lead.id, t.x, t.w, note);
    if (over.length) {
      // Measure the text on the photo first, then size the photo and centre the text on it.
      const hs = [];
      for (const s of over) { let h; [model, h] = await placeText(page, model, s.id, s.target.x, s.target.w, note); hs.push(h); }
      const total = hs.reduce((a, b) => a + b, 0) + TEXT_GAP * (over.length - 1);
      t.h = Math.max(lead.target.h, total + 2 * INSET);
      model = await applyMobile(page, model, lead.id, t, note);
      let ty = y + Math.round((t.h - total) / 2);
      for (const [i, s] of over.entries()) {
        model = await applyMobile(page, model, s.id, { x: s.target.x, y: ty, w: s.target.w, h: hs[i] }, note);
        ty += hs[i] + TEXT_GAP;
      }
    } else {
      model = await applyMobile(page, model, lead.id, t, note);
    }
    end = y + t.h;
  }
  return [model, end ?? top];
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
    ['S.elements.2', { x: 24, y: 48, w: 272, h: 272 }],
    ['S.elements.1', { x: 24, y: 344, w: 272, h: 24 }],  // 24px after a photo
    ['S.elements.3', { x: 140, y: 392, w: 40, h: 40 }],
  ]);
  assert.strictEqual(p.sectionH, 488); // + 56 bottom padding
  assert.deepStrictEqual(p.bg, [{ id: 'S.elements.0', target: { x: 0, y: 0, w: 320, h: 488 } }]);
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
  assert.deepStrictEqual(q.units[2].steps[0].target, { x: -227, y: 294, w: 1283, h: 41 }); // marquee only moves
  assert.deepStrictEqual(q.units[0].steps.map(s => s.target.x), [102, 127, 152, 177, 202]); // 5×17 + 4×8 = 117 wide, centred
  assert.deepStrictEqual(q.units[1].steps.map(s => s.target), [
    { x: 24, y: 89, w: 272, h: 181 },
    { x: 40, y: 164, w: 240, h: 32 },  // centred on the photo
  ]);
  // A card (group: photo + caption) keeps its insides together, laid out in the group's own coordinates.
  const card = { id: 'K', desktop: { h: 800 }, mobile: { h: 600 }, elements: [
    { type: 'group', visible: 'a', desktop: { x: 100, y: 100, w: 388, h: 557 }, mobile: { x: -40, y: 30, w: 290, h: 424 }, elementOrder: ['i', 't'], elements: {
      i: { type: 'graphic', visible: 'a', desktop: { x: 0, y: 0, w: 388, h: 480 }, mobile: { x: 0, y: 0, w: 290, h: 390 } },
      t: { type: 'text', visible: 'a', desktop: { x: 0, y: 496, w: 388, h: 61 }, mobile: { x: 0, y: 405, w: 290, h: 19 } },
    } },
  ] };
  const c = plan(card, { 'K.elements.0.elements.t': { dy: 0, h: 17, w: 190 } });
  assert.deepStrictEqual(c.units.map(u => u.kind), ['group']);
  assert.deepStrictEqual(c.steps.map(s => [s.id, s.target]), [
    ['K.elements.0.elements.i', { x: 0, y: 0, w: 272, h: 336 }],
    ['K.elements.0.elements.t', { x: 0, y: 360, w: 272, h: 19 }],
    ['K.elements.0', { x: 24, y: 48, w: 272, h: 379 }],
  ]);
  // Hand-made phone layout (a mobile-only element): the phone's order wins and that element is laid out too.
  const mob = { id: 'P', desktop: { h: 600 }, mobile: { h: 300 }, elements: [
    { type: 'text', visible: 'a', desktop: { x: 0, y: 0, w: 400, h: 40 }, mobile: { x: 10, y: 200, w: 300, h: 20 } },   // last on phone
    { type: 'icon', visible: 'm', mobile: { x: 250, y: 10, w: 30, h: 30 } },                                             // mobile-only, first
  ] };
  const q2 = plan(mob, {}, 40, { byMobile: true });
  assert.deepStrictEqual(q2.steps.map(s => [s.id, s.target]), [
    ['P.elements.1', { x: 145, y: 40, w: 30, h: 30 }],
    ['P.elements.0', { x: 24, y: 94, w: 272, h: 20 }],
  ]);
  assert.strictEqual(q2.mobileOnly, 1);
  // A vertical label (rotated -90°) keeps its size: centred, stacked by its turned height.
  const vert = { id: 'V', desktop: { h: 400 }, mobile: { h: 300 }, elements: [
    { type: 'text', visible: 'a', desktop: { x: 500, y: 100, w: 147, h: 22, a: -90 }, mobile: { x: 250, y: 100, w: 147, h: 22, a: -90 } },
  ] };
  const v = plan(vert, {}, 40).steps[0];
  assert.deepStrictEqual([v.keep, v.off, v.target], [true, 63, { x: 87, y: 40, w: 147, h: 147 }]);
  // Related texts sit closer than a photo and text; a button gets a comfortable tap size.
  const ux = { id: 'U', desktop: { h: 800 }, mobile: { h: 600 }, elements: [
    { type: 'text', visible: 'a', desktop: { x: 100, y: 100, w: 600, h: 60 }, mobile: { h: 30 } },
    { type: 'text', visible: 'a', desktop: { x: 100, y: 180, w: 600, h: 40 }, mobile: { h: 20 } },
    { type: 'button', visible: 'a', desktop: { x: 100, y: 260, w: 180, h: 40 }, mobile: { w: 100, h: 24 } },
  ] };
  assert.deepStrictEqual(plan(ux).steps.map(s => s.target), [
    { x: 24, y: 48, w: 272, h: 30 },
    { x: 24, y: 92, w: 272, h: 20 },   // 14px under the heading
    { x: 80, y: 136, w: 160, h: 44 },  // 24px gap; 160×44 button, centred
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
  for await (const pageName of ed.eachPage(page)) {
    const model = await readModel(page);
    const block = model.blocks.find(b => b.name.trim().toLowerCase() === name.toLowerCase());
    if (!block) throw new Error(`no section "${name}" on page ${pageName}. Sections: ${model.blocks.map(b => b.name.trim()).join(', ')}`);
    if (block.canvasSet) console.log('Note: shared section, changes apply to every page.');
    await rebuild(page, model, block, process.argv.includes('--apply'));
  }
}

module.exports = { plan, rebuild, useEditor };
if (require.main === module) {
  if (process.argv.includes('--selftest')) selftest();
  else require('./connect').run(main);
}
