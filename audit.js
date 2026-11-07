// Read-only mobile audit. Needs the tool's Chrome window with the Showit editor open.
//   node audit.js                  the page that's open
//   node audit.js --page "About"   one page
//   node audit.js --all            every page
//   node audit.js --selftest

const MOBILE_W = 320;
const MIN_TEXT = 12; // px; ponytail: fixed threshold, make per-style if it flags intentional captions
const MAX_NUDGE = 40; // px; text spilling further than this is treated as a deliberate design (marquees etc.)
const EDGE = 15; // px; side margin kept when widening text
const MIN_GAP = 6; // px; minimum vertical breathing room between stacked small texts

// Page model (Immutable.js in React props) + measured text ink from the mobile preview iframe.
async function readModel(page) {
  const model = await page.evaluate(() => {
    if (!document.getElementById('mobile_stage_canvas')) throw new Error('Mobile canvas not found. Open a page in the Showit editor.');
    // Walk DOWN from React's root (root.current is always the live tree). Walking up from a DOM
    // node can land on outdated copies after a page switch.
    const roots = [...document.querySelectorAll('body *')].flatMap(n => Object.keys(n).filter(k => k.startsWith('__reactContainer')).map(k => n[k]));
    let f, p = null;
    const stack = roots.map(r => r.stateNode?.current ?? r);
    while (stack.length && !p) {
      f = stack.pop();
      const q = f.memoizedProps;
      if (q && q.layout === 'mobile' && q.blocks && q.blockContainer) p = q;
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    if (!p) throw new Error('Page data not found; Showit editor may have changed.');
    const c = p.blockContainer;
    return { blocks: p.blocks.toJS(), theme: c.get('theme').toJS(), page: { name: c.get('name'), type: c.get('type') } };
  });
  const frame = page.frames().find(f => f.name() === 'mobile_frame');
  model.ink = frame ? await frame.evaluate(measureInk) : {};
  return model;
}

// Runs inside the preview iframe. Where the text actually is, relative to its box, in design px.
function measureInk() {
  const out = {};
  for (const el of document.querySelectorAll('[id^="si_element_"]')) {
    const m = el.id.match(/^si_element_(.+)_elements_(\d+)$/);
    if (!m || !el.innerText.trim() || !el.offsetWidth) continue;
    const box = el.getBoundingClientRect();
    const s = box.width / el.offsetWidth; // preview is CSS-scaled by the editor zoom
    const r = document.createRange();
    r.selectNodeContents(el);
    const c = r.getBoundingClientRect();
    const lines = new Set([...r.getClientRects()].filter(q => q.height).map(q => Math.round(q.top / s / 4))).size;
    out[`${m[1]}.elements.${m[2]}`] = { dx: (c.x - box.x) / s, dy: (c.y - box.y) / s, w: c.width / s, h: c.height / s, lines };
  }
  return out;
}

const onMobile = x => x.visible !== 'd';
const plain = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const styleOf = (el, theme) => theme.styles?.[el.mobile?.style || el.desktop?.style || 'paragraph'] || {};

function textSize(el, theme) {
  const style = styleOf(el, theme);
  return el.mobile?.size ?? style.mobile?.size ?? el.desktop?.size ?? style.desktop?.size;
}

function textAlign(el, theme) {
  const style = styleOf(el, theme);
  return el.mobile?.tA ?? style.mobile?.tA ?? el.desktop?.tA ?? style.desktop?.tA ?? 'left';
}

// Text wraps past its box. Small text (labels, captions): widen toward free space so it stops wrapping.
// Big display text: line breaks are usually deliberate, so only grow the box height (no visual change).
function wrapFix(m, k, align, size) {
  const room = align === 'center' ? Math.min(m.x, MOBILE_W - m.x - m.w) - EDGE
    : align === 'right' ? m.x - EDGE
    : MOBILE_W - EDGE - m.x - m.w;
  if (size <= 14 && room > 4) {
    const r = Math.floor(room);
    if (align === 'center') return { x: m.x - r, w: m.w + 2 * r };
    if (align === 'right') return { x: m.x - r, w: m.w + r };
    return { w: m.w + r };
  }
  return { h: Math.ceil(k.dy + k.h + 2) };
}

function audit({ blocks, theme, ink = {} }) {
  const issues = [];
  const idOf = (b, e) => `${b.id}.elements.${b.elements.indexOf(e)}`;
  // fix: mobile values to set (x/y/w/h/size/sectionH); null = report only
  const add = (block, el, problem, fix = null) => {
    if (fix && el?.lockEditing) { problem += ', locked in Showit, skipped'; fix = null; } // respect locks
    issues.push({
      block: block.name.trim(),
      shared: !!block.canvasSet, // Header/Footer etc: edited in "Main Site", applies to every page
      id: el ? idOf(block, el) : block.id,
      what: el ? `${el.type}${el.type === 'text' ? ` "${plain(el.content?.text).slice(0, 40)}"` : ''}` : '(section)',
      problem,
      fix,
    });
  };
  const inkRect = (b, e) => {
    const k = ink[idOf(b, e)], m = e.mobile;
    return k ? { x: m.x + k.dx, y: m.y + k.dy, w: k.w, h: k.h } : m;
  };

  for (const b of blocks.filter(onMobile)) {
    const els = (b.elements || []).filter(onMobile);
    const bh = b.mobile?.h;
    for (const e of els) {
      const m = e.mobile;
      if (!m) { add(b, e, 'no mobile layout'); continue; }
      // Text: judge by where the letters are; a box hanging off screen with its text inside is harmless.
      const k0 = e.type === 'text' ? ink[idOf(b, e)] : null;
      const left = k0 ? m.x + k0.dx : m.x, right = k0 ? m.x + k0.dx + k0.w : m.x + m.w;
      if (left < -0.5 || right > MOBILE_W + 0.5) {
        const spill = Math.max(-left, right - MOBILE_W);
        const nudge = e.type === 'text' && spill <= MAX_NUDGE;
        // Slide back on screen keeping the width (no new wrapping); shrink only if wider than the screen.
        const fix = m.w <= MOBILE_W ? { x: Math.min(Math.max(0, m.x), MOBILE_W - m.w) }
          : { x: Math.max(0, m.x), w: Math.min(m.x + m.w, MOBILE_W) - Math.max(0, m.x) };
        // Text lined up in a column with others: slide the whole column so it stays aligned.
        const dx = fix.x - m.x;
        if (!fix.w && dx) {
          const col = els.filter(o => o !== e && o.type === 'text' && o.mobile && Math.abs(o.mobile.x - m.x) < 1.5);
          if (col.every(o => o.mobile.x + dx >= 0 && !o.lockEditing))
            fix.also = col.map(o => ({ id: idOf(b, o), fix: { x: o.mobile.x + dx } }));
        }
        add(b, e, `off screen sideways (x ${Math.round(left)} to ${Math.round(right)}, screen is 0 to ${MOBILE_W})${nudge ? '' : ', looks intentional, skipped'}`,
          nudge ? fix : null);
      }
      // Text past the section bottom is a bug (often after we push it down); images doing it are usually design.
      if (bh > 1 && m.y + m.h > bh) add(b, e, `sticks out below section (bottom ${m.y + m.h}, section height ${bh})`,
        e.type === 'text' && m.y + m.h - bh <= MAX_NUDGE ? { sectionH: m.y + m.h + MIN_GAP } : null);
      if (e.type === 'text') {
        const s = textSize(e, theme);
        if (s < MIN_TEXT) {
          // Predict where the bigger text lands (grows from its alignment side). If it would run into
          // other text, e.g. a "Location:" label sitting right next to its value, a person must re-lay it.
          const k = ink[idOf(b, e)], r = MIN_TEXT / s, al = textAlign(e, theme);
          // 2px margin: bigger text also shifts down a little inside its box (line height).
          const grown = k && { w: k.w * r + 4, h: k.h * r + 4, y: m.y + k.dy - 2,
            x: m.x + k.dx - 2 - (al === 'center' ? k.w * (r - 1) / 2 : al === 'right' ? k.w * (r - 1) : 0) };
          const hit = grown && els.find(o => o !== e && o.type === 'text' && o.mobile && !o.wp && overlap(grown, inkRect(b, o)));
          if (hit) add(b, e, `text ${s}px, under ${MIN_TEXT}px; at ${MIN_TEXT}px it would run into "${plain(hit.content?.text).slice(0, 30)}", needs a manual layout`);
          else add(b, e, `text ${s}px, under ${MIN_TEXT}px`, { size: MIN_TEXT });
        }
        const k = ink[idOf(b, e)];
        if (k && !e.wp && k.lines > 1 && k.dy + k.h > m.h + 3)
          add(b, e, `text wraps past its box (${k.lines} lines need ${Math.ceil(k.dy + k.h)}px, box is ${m.h}px)`,
            wrapFix(m, k, textAlign(e, theme), s));
      }
    }
    // WordPress dynamic text (e.wp) is placeholder in the editor; its real size varies, so skip layout checks.
    const texts = els.filter(e => e.type === 'text' && e.mobile && !e.wp);
    const push = new Map(); // lower element -> [px needed, gap]; one fix each, for the tightest gap
    for (let i = 0; i < texts.length; i++)
      for (let j = i + 1; j < texts.length; j++) {
        const a = inkRect(b, texts[i]), c = inkRect(b, texts[j]);
        if (overlap(a, c)) { add(b, texts[i], `overlaps text "${plain(texts[j].content?.text).slice(0, 30)}"`); continue; }
        if (!(a.x < c.x + c.w && c.x < a.x + a.w)) continue; // not stacked
        // Crowding only matters for small print; big headings sitting tight are a design choice.
        if (Math.max(textSize(texts[i], theme), textSize(texts[j], theme)) > 14) continue;
        const [top, low, lowEl] = a.y < c.y ? [a, c, texts[j]] : [c, a, texts[i]];
        const gap = low.y - (top.y + top.h);
        if (gap < MIN_GAP - 0.5 && gap < (push.get(lowEl)?.[1] ?? Infinity)) push.set(lowEl, [Math.ceil(MIN_GAP - gap), gap]);
      }
    // Move whole rows (a label and its value side by side) together so they stay lined up.
    const moved = new Set();
    for (const [el, [, gap]] of push) {
      if (moved.has(el)) continue;
      const row = texts.filter(o => Math.abs(o.mobile.y - el.mobile.y) <= 2);
      row.forEach(o => moved.add(o));
      const px = Math.max(...row.map(o => push.get(o)?.[0] ?? 0));
      const mates = row.filter(o => o !== el);
      if (mates.some(o => o.lockEditing)) { add(b, el, `too close to text above (gap ${gap.toFixed(1)}px); its row has a locked element`); continue; }
      add(b, el, `too close to text above (gap ${gap.toFixed(1)}px)${mates.length ? ', row moved together' : ''}`,
        { y: el.mobile.y + px, ...(mates.length ? { also: mates.map(o => ({ id: idOf(b, o), fix: { y: o.mobile.y + px } })) } : {}) });
    }
  }
  return issues;
}

function selftest() {
  const assert = require('assert');
  const theme = { styles: { paragraph: { desktop: { size: 16 }, mobile: { size: 10 } } } };
  const T = (text, mobile, extra = {}) => ({ type: 'text', visible: 'a', content: { text }, desktop: {}, mobile: { size: 14, ...mobile }, ...extra });
  const blocks = [{
    id: 'B', name: 'Hero', visible: 'a', mobile: { h: 500 }, elements: [
      { type: 'graphic', visible: 'a', mobile: { x: 0, y: 0, w: 320, h: 500 } },   // 0 fine
      { type: 'graphic', visible: 'a', mobile: { x: 200, y: 0, w: 200, h: 50 } },  // 1 off right, image: skipped
      { type: 'graphic', visible: 'd', mobile: { x: 900, y: 0, w: 200, h: 50 } },  // 2 desktop-only, ignored
      T('A', { x: 10, y: 450, w: 100, h: 80, size: undefined }),                   // 3 below + 10px
      T('B', { x: 50, y: 460, w: 100, h: 20 }),                                    // 4 overlaps A (no ink measured)
      T('C', { x: -10, y: 0, w: 340, h: 20 }),                                     // 5 nudge
      T('D', { x: -227, y: 100, w: 1283, h: 20 }),                                 // 6 marquee
      T('E', { x: 30, y: 200, w: 100, h: 17 }),                                    // 7 wraps, left: widen
      T('F', { x: 15, y: 300, w: 200, h: 17, size: 40 }, { desktop: { tA: 'center' } }), // 8 wraps, big text: taller
      T('G', { x: 0, y: 400, w: 100, h: 20 }),                                     // 9 box overlaps H, ink doesn't
      T('H', { x: 50, y: 400, w: 100, h: 20 }),                                    // 10
      T('I', { x: 200, y: 250, w: 100, h: 20 }),                                   // 11
      T('J', { x: 200, y: 270, w: 100, h: 20 }),                                   // 12 too close under I
      T('K', { x: 200, y: 470, w: 100, h: 40 }),                                    // 13 text 10px past bottom
      T('L', { x: -5, y: 150, w: 100, h: 20 }, { lockEditing: true }),              // 14 locked: report only
      T('M', { x: 200, y: 330, w: 100, h: 17 }, { wp: { field: 'post_content' } }), // 15 WordPress: wrap ignored
      T('P', { x: 150, y: 30, w: 40, h: 20 }),                                      // 16
      T('Q', { x: 200, y: 30, w: 40, h: 20 }),                                      // 17
      T('R', { x: 150, y: 50, w: 100, h: 20 }),                                     // 18 tight under P and Q: one fix
      T('S', { x: 250, y: 130, w: 100, h: 20 }),                                    // 19 box off screen, letters inside: fine
      T('U', { x: 250, y: 160, w: 100, h: 20 }),                                    // 20 letters spill 20px: slide left
    ],
  }];
  blocks.push({ id: 'C', name: 'Meta', visible: 'a', mobile: { h: 100 }, elements: [
    T('Location:', { x: 10, y: 10, w: 60, h: 15, size: 10 }),   // grows into its value: manual layout
    T('Paris', { x: 75, y: 10, w: 60, h: 15, size: 14 }),       // value next to it
    T('Country:', { x: 10, y: 24, w: 60, h: 15, size: 14 }),    // row 2, tight under row 1...
    T('France', { x: 75, y: 24, w: 60, h: 15, size: 14 }),      // ...moved together with its label
  ] });
  const ink = {
    'C.elements.0': { dx: 0, dy: 2, w: 60, h: 12, lines: 1 },
    'C.elements.1': { dx: 0, dy: 2, w: 60, h: 12, lines: 1 },
    'C.elements.2': { dx: 0, dy: 2, w: 60, h: 12, lines: 1 },
    'C.elements.3': { dx: 0, dy: 2, w: 60, h: 12, lines: 1 },
    'B.elements.7': { dx: 0, dy: 3, w: 100, h: 37, lines: 2 },
    'B.elements.8': { dx: 0, dy: 3, w: 290, h: 37, lines: 2 },
    'B.elements.9': { dx: 0, dy: 3, w: 40, h: 15, lines: 1 },
    'B.elements.10': { dx: 0, dy: 3, w: 40, h: 15, lines: 1 },
    'B.elements.11': { dx: 0, dy: 3, w: 40, h: 15, lines: 1 },
    'B.elements.12': { dx: 0, dy: 3, w: 40, h: 15, lines: 1 },
    'B.elements.13': { dx: 0, dy: 3, w: 40, h: 15, lines: 1 },
    'B.elements.15': { dx: 0, dy: 3, w: 100, h: 37, lines: 2 },
    'B.elements.16': { dx: 0, dy: 3, w: 40, h: 15, lines: 1 },
    'B.elements.17': { dx: 0, dy: 3, w: 40, h: 15, lines: 1 },
    'B.elements.18': { dx: 0, dy: 3, w: 100, h: 15, lines: 1 },
    'B.elements.19': { dx: 0, dy: 3, w: 40, h: 15, lines: 1 },
    'B.elements.20': { dx: 0, dy: 3, w: 90, h: 15, lines: 1 },
  };
  const got = audit({ blocks, theme, ink }).map(i => `${i.id} ${i.problem.split(' (')[0]} ${JSON.stringify(i.fix)}`);
  assert.deepStrictEqual(got, [
    'B.elements.1 off screen sideways null',
    'B.elements.3 sticks out below section {"sectionH":536}',
    'B.elements.3 text 10px, under 12px {"size":12}',
    'B.elements.5 off screen sideways {"x":0,"w":320}',
    'B.elements.6 off screen sideways null',
    'B.elements.7 text wraps past its box {"w":275}',
    'B.elements.8 text wraps past its box {"h":42}',
    'B.elements.13 sticks out below section {"sectionH":516}',
    'B.elements.14 off screen sideways null',
    'B.elements.20 off screen sideways {"x":220,"also":[{"id":"B.elements.19","fix":{"x":220}}]}',
    'B.elements.3 overlaps text "B" null',
    'B.elements.12 too close to text above {"y":271}',
    'B.elements.18 too close to text above {"y":51}',
    'C.elements.0 text 10px, under 12px; at 12px it would run into "Paris", needs a manual layout null',
    'C.elements.2 too close to text above {"y":28,"also":[{"id":"C.elements.3","fix":{"y":28}}]}',
  ]);
  console.log('selftest ok');
}

async function main(page) {
  const { eachPage, readLog } = require('./editor'); // lazy: editor.js requires this file
  const seenShared = new Set();
  // Fixes that were tried and made things worse (fix.js logs them): report as needing a person.
  const skips = new Set(readLog().filter(e => e.skip).map(e => e.skip));
  let total = 0, fixable = 0;
  for await (const name of eachPage(page)) {
    // Shared sections (Header/Footer) appear on every page: report them once.
    const issues = audit(await readModel(page)).filter(i => !i.shared || !seenShared.has(i.id + i.problem));
    for (const i of issues) if (i.fix && skips.has(i.id + JSON.stringify(i.fix))) { i.fix = null; i.problem += '; fixing it made things worse before, needs a person'; }
    issues.filter(i => i.shared).forEach(i => seenShared.add(i.id + i.problem));
    console.log(`
#### Page: ${name} (${issues.length} issue(s))`);
    let last;
    for (const i of issues) {
      if (i.block !== last) console.log(`== ${last = i.block}${i.shared ? ' (shared, all pages)' : ''}`);
      console.log(`  ${i.what}: ${i.problem}${i.fix ? '  [fixable]' : ''}   [${i.id}]`);
    }
    total += issues.length; fixable += issues.filter(i => i.fix).length;
  }
  console.log(`
${total} issue(s), ${fixable} fixable.`);
}

module.exports = { audit, readModel, textSize, textAlign, plain, onMobile, MOBILE_W, EDGE };
if (require.main === module) {
  if (process.argv.includes('--selftest')) selftest();
  else require('./connect').run(main);
}
