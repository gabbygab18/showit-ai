// Read-only mobile audit. Needs the tool's Chrome window with the Showit editor open.
//   node audit.js                  the page that's open
//   node audit.js --page "About"   one page
//   node audit.js --all            every page
//   node audit.js --selftest

// <rules> (this part is also copied into the website's playground: website/scripts/sync-rules.mjs)
const MOBILE_W = 320;
const MIN_TEXT = 12; // px; ponytail: fixed threshold, make per-style if it flags intentional captions
const MAX_NUDGE = 40; // px; text spilling further than this whose letters can't fit on screen is a deliberate design (marquees etc.)
const EDGE = 15; // px; side margin kept when widening text
const MIN_GAP = 6; // px; minimum vertical breathing room between stacked small texts
const DESKTOP_W = 1200; // Showit's desktop canvas
const MIN_HERO = 480; // px; ponytail: one phone screen (568) minus browser bars, make per-site if heroes differ
// </rules>

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

// <rules>
// Runs inside the preview iframe. Where the text actually is, relative to its box, in design px.
function measureInk() {
  const out = {};
  for (const el of document.querySelectorAll('[id^="si_element_"]')) {
    // Top-level element (block_elements_3) or a child inside a group (block_elements_3_elements_<child id>).
    const m = el.id.match(/^si_element_(.+?)_elements_(\d+)(?:_elements_(.+))?$/);
    if (!m || !el.innerText.trim() || !el.offsetWidth) continue;
    const box = el.getBoundingClientRect();
    const s = box.width / el.offsetWidth; // preview is CSS-scaled by the editor zoom
    const r = document.createRange();
    r.selectNodeContents(el);
    const c = r.getBoundingClientRect();
    const lines = new Set([...r.getClientRects()].filter(q => q.height).map(q => Math.round(q.top / s / 4))).size;
    out[`${m[1]}.elements.${m[2]}${m[3] ? `.elements.${m[3]}` : ''}`] = { dx: (c.x - box.x) / s, dy: (c.y - box.y) / s, w: c.width / s, h: c.height / s, lines };
  }
  return out;
}

// Shown on phones: everywhere ('a') or phone-only ('m'); not desktop-only ('d') or hidden on both ('n').
const onMobile = x => x.visible !== 'd' && x.visible !== 'n';
const plain = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const styleOf = (el, theme) => theme.styles?.[el.mobile?.style || el.desktop?.style || 'paragraph'] || {};

// A font size typed by mistake on mobile (1410 for 14): far above desktop. phoneSize: what to put back,
// the style's phone size (or half the desktop size, at least the minimum).
const blownUp = (el, theme) => {
  const s = textSize(el, theme), ds = el.desktop?.size ?? styleOf(el, theme).desktop?.size;
  return ds && s > 2 * ds && s > 60 ? ds : 0;
};
const phoneSize = (el, theme) => {
  const st = styleOf(el, theme), ds = el.desktop?.size ?? st.desktop?.size;
  return Math.max(MIN_TEXT, st.mobile?.size ?? (ds ? Math.min(ds, Math.round(ds / 2)) : MIN_TEXT));
};
// How much two boxes overlap, as a share of the smaller one (0..1).
const overlapShare = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.max(1, Math.min(a.w * a.h, b.w * b.h)) : 0;
};

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
  const idOf = (b, e) => e._id ?? `${b.id}.elements.${b.elements.indexOf(e)}`;
  // Groups: Showit stores a group's children relative to the group. Check the children like any other
  // element, in page coordinates, and convert their fixes back to the group's coordinates.
  const offs = new Map(); // child id -> group's mobile position
  const flat = b => (b.elements || []).flatMap((e, i) => {
    const id = `${b.id}.elements.${i}`;
    if (e.type !== 'group' || !e.elements || !onMobile(e)) return [{ ...e, _id: id }];
    const g = e.mobile || {}, gd = e.desktop || {};
    const at = (r, o) => r && { ...r, x: (r.x || 0) + (o.x || 0), y: (r.y || 0) + (o.y || 0) };
    const kids = (e.elementOrder || Object.keys(e.elements)).filter(c => e.elements[c]).map(c => {
      const k = e.elements[c], kid = `${id}.elements.${c}`;
      offs.set(kid, { x: g.x || 0, y: g.y || 0 });
      return { ...k, _id: kid, _child: true, lockEditing: k.lockEditing || e.lockEditing, mobile: at(k.mobile, g), desktop: at(k.desktop, gd) };
    });
    return [{ ...e, _id: id }, ...kids];
  });
  const rel = (id, f) => {
    const o = offs.get(id);
    if (!o || !f) return f;
    const r = { ...f };
    if ('x' in r) r.x -= o.x;
    if ('y' in r) r.y -= o.y;
    return r;
  };
  // fix: mobile values to set (x/y/w/h/size/sectionH); null = report only
  const add = (block, el, problem, fix = null) => {
    if (fix && el) { fix = rel(idOf(block, el), fix); if (fix.also) fix.also = fix.also.map(a => ({ ...a, fix: rel(a.id, a.fix) })); }
    issues.push({
      block: block.name.trim(),
      shared: !!block.canvasSet, // Header/Footer etc: edited in "Main Site", applies to every page
      id: el ? idOf(block, el) : block.id,
      what: el ? `${el.type}${el.type === 'text' ? ` "${plain(el.content?.text).slice(0, 40)}"` : ''}` : '(section)',
      problem,
      fix,
    });
  };
  // Where a text's letters roughly sit on desktop (no desktop measurement: the phone one, scaled by
  // font size, inside the desktop box, by its alignment). Boxes are often much wider than the words.
  const deskInk = (b, e) => {
    const k = ink[idOf(b, e)], d = e.desktop;
    if (!k) return d;
    const ms = textSize(e, theme) || 1, ds = e.desktop?.size ?? styleOf(e, theme).desktop?.size ?? ms;
    const w = Math.min(d.w, (k._mass ?? k.w * Math.max(1, k.lines || 1)) * ds / ms);
    const al = e.desktop?.tA ?? styleOf(e, theme).desktop?.tA ?? 'left';
    return { x: d.x + (al === 'center' ? (d.w - w) / 2 : al === 'right' ? d.w - w : 0), y: d.y, w, h: d.h };
  };
  const inkRect = (b, e) => {
    const k = ink[idOf(b, e)], m = e.mobile;
    return k ? { x: m.x + k.dx, y: m.y + k.dy, w: k.w, h: k.h } : m;
  };

  for (const b of blocks.filter(onMobile)) {
    const els = flat(b).filter(onMobile);
    const bh = b.mobile?.h;
    // Photo hero (full screen on desktop, only a background in it) squashed into a strip on mobile.
    const bgOnly = els.length && els.every(e => e.type === 'graphic' && e.desktop && b.desktop?.h && e.desktop.w >= 0.9 * DESKTOP_W && e.desktop.h >= 0.9 * b.desktop.h);
    if (bgOnly && b.desktop.nature === 'wH' && bh > 1 && bh < MIN_HERO)
      add(b, null, `photo section only ${bh}px tall on mobile (full screen on desktop)`, { sectionH: MIN_HERO });
    for (const e of els) {
      const m = e.mobile;
      if (!m) { add(b, e, 'no mobile layout'); continue; }
      const d = e.desktop;
      // Full-bleed background (covers its section on desktop): on mobile it must cover the section too.
      if (e.type === 'graphic' && d && b.desktop?.h && d.w >= 0.9 * DESKTOP_W && d.h >= 0.9 * b.desktop.h) {
        if (bh > 1 && (m.x > 0.5 || m.y > 0.5 || m.x + m.w < MOBILE_W - 0.5 || m.y + m.h < bh - 0.5))
          add(b, e, `background doesn't cover its section (x ${m.x}, y ${m.y}, ${m.w}×${m.h}; section is ${MOBILE_W}×${bh})`,
            { x: 0, y: 0, w: MOBILE_W, h: bh }); // same as a rebuild: exactly the section
        continue;
      }
      // Blown-up text (a typo like 1410 for 14): put the desktop size back first; the next pass re-checks the rest.
      if (e.type === 'text' && blownUp(e, theme)) {
        add(b, e, `text ${textSize(e, theme)}px on mobile but ${blownUp(e, theme)}px on desktop`, { size: phoneSize(e, theme) });
        continue;
      }
      // Text: judge by where the letters are; a box hanging off screen with its text inside is harmless.
      const k0 = e.type === 'text' ? ink[idOf(b, e)] : null;
      const left = k0 ? m.x + k0.dx : m.x, right = k0 ? m.x + k0.dx + k0.w : m.x + m.w;
      // Group children move with their group: the group itself is checked for this.
      if (!e._child && (left < -0.5 || right > MOBILE_W + 0.5)) {
        const spill = Math.max(-left, right - MOBILE_W);
        // Letters that fit on one screen are a real bug however far they spill (a heading pushed off the side).
        // Anything sitting inside the canvas on desktop but off it on mobile was knocked out of place.
        const inOnDesktop = d && d.x >= -2 && d.x + d.w <= DESKTOP_W + 2;
        // A group can only be moved (Showit locks its size): wider than the screen means its insides need laying out.
        const nudge = !(e.type === 'group' && m.w > MOBILE_W) && (inOnDesktop || e.type === 'text' && (spill <= MAX_NUDGE || right - left <= MOBILE_W));
        // Slide back on screen keeping the width (no new wrapping); shrink only if wider than the screen.
        const fix = m.w <= MOBILE_W ? { x: Math.min(Math.max(0, m.x), MOBILE_W - m.w) }
          : { x: Math.max(0, m.x), w: Math.min(m.x + m.w, MOBILE_W) - Math.max(0, m.x) };
        // Text lined up in a column with others: slide the whole column so it stays aligned.
        const dx = fix.x - m.x;
        if (e.type === 'text' && !fix.w && dx) {
          const col = els.filter(o => o !== e && o.type === 'text' && o.mobile && Math.abs(o.mobile.x - m.x) < 1.5);
          if (col.length && col.every(o => o.mobile.x + dx >= 0))
            fix.also = col.map(o => ({ id: idOf(b, o), fix: { x: o.mobile.x + dx } }));
        }
        add(b, e, `off screen sideways (x ${Math.round(left)} to ${Math.round(right)}, screen is 0 to ${MOBILE_W})${nudge ? '' : ', looks intentional, skipped'}`,
          nudge ? fix : null);
      }
      // Text past the section bottom is a bug (often after we push it down); images doing it are usually design.
      if (!e._child && bh > 1 && m.y + m.h > bh) add(b, e, `sticks out below section (bottom ${m.y + m.h}, section height ${bh})`,
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
          add(b, e, `text wraps past its box (${k.lines} lines need ${Math.ceil(k.dy + k.h)}px, box is ${m.h}px)`
            + (k.w > MOBILE_W ? ', wider than the screen, looks intentional, skipped' : ''), // giant background lettering
            k.w > MOBILE_W ? null : wrapFix(m, k, textAlign(e, theme), s));
        // A paragraph squeezed into a narrow column: a desktop multi-column layout shrunk onto the phone.
        // The section needs laying out again (fix.js rebuilds it).
        if (k && !e.wp && k.lines >= 3 && m.w < 0.55 * MOBILE_W)
          add(b, e, `text squeezed into a ${Math.round(m.w)}px column (${k.lines} lines), the section needs a phone layout`);
      }
    }
    // WordPress dynamic text (e.wp) is placeholder in the editor; its real size varies, so skip layout checks.
    const texts = els.filter(e => e.type === 'text' && e.mobile && !e.wp);
    // Text covered by a shape, photo or button on mobile that it isn't touching on desktop: a layout
    // that was never done for phones (e.g. a box added on desktop lands on top of the text on mobile).
    const solids = els.filter(e => !['text', 'line', 'group'].includes(e.type) && e.mobile && e.desktop?.w);
    for (const t of texts.filter(t => t.desktop?.w))
      for (const o of solids) {
        // Text laid on a photo on desktop (its middle on a bigger picture) stays on it on mobile: design.
        const d = t.desktop, od = o.desktop, cx = d.x + d.w / 2, cy = d.y + d.h / 2;
        const onPhoto = cx > od.x && cx < od.x + od.w && cy > od.y && cy < od.y + od.h && od.w * od.h > 1.5 * d.w * d.h;
        if (!onPhoto && overlap(inkRect(b, t), o.mobile) && overlapShare(d, od) < 0.5 * overlapShare(inkRect(b, t), o.mobile)) {
          add(b, t, `covered by a ${o.type === 'simple' ? 'shape' : o.type} on mobile (not on desktop)`);
          break;
        }
      }
    const push = new Map(); // lower element -> [px needed, gap]; one fix each, for the tightest gap
    for (let i = 0; i < texts.length; i++)
      for (let j = i + 1; j < texts.length; j++) {
        const a = inkRect(b, texts[i]), c = inkRect(b, texts[j]);
        if (overlap(a, c)) {
          // Text layered on text on desktop too (a word over a big decorative title) is the design.
          // Only when they overlap about as much on desktop: a word moved onto another on mobile is still a bug.
          const designed = texts[i].desktop?.w && texts[j].desktop?.w && overlapShare(deskInk(b, texts[i]), deskInk(b, texts[j])) >= 0.5 * overlapShare(a, c);
          if (!designed) add(b, texts[i], `overlaps text "${plain(texts[j].content?.text).slice(0, 30)}"`);
          continue;
        }
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
      add(b, el, `too close to text above (gap ${gap.toFixed(1)}px)${mates.length ? ', row moved together' : ''}`,
        { y: el.mobile.y + px, ...(mates.length ? { also: mates.map(o => ({ id: idOf(b, o), fix: { y: o.mobile.y + px } })) } : {}) });
    }
  }
  return issues;
}
// </rules>

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
      T('L', { x: -5, y: 150, w: 100, h: 20 }, { lockEditing: true }),              // 14 locked: still fixed (unlocked, then locked again)
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
  blocks.push({ id: 'D', name: 'Intro', visible: 'a', mobile: { h: 400 }, desktop: { h: 800 }, elements: [
    T('Heading', { x: 152, y: 10, w: 320, h: 89, size: 42 }),  // letters spill 138px but fit on screen: slide back
    T('Huge', { x: 0, y: 120, w: 325, h: 36 }),                // giant background lettering: leave it
    T('Typo', { x: 0, y: 160, w: 325, h: 36, size: 1410 }, { desktop: { size: 20 } }), // 1410 typed for 14: desktop size back
    { type: 'graphic', visible: 'a', mobile: { x: -51, y: 200, w: 117, h: 100 }, desktop: { x: 27, y: 0, w: 227, h: 300 } }, // inside on desktop: slide in
    { type: 'graphic', visible: 'a', mobile: { x: -94, y: 122, w: 320, h: 500 }, desktop: { x: 0, y: 0, w: 1200, h: 800 } }, // knocked-off background
  ] });
  blocks.push({ id: 'E', name: 'Hero', visible: 'a', mobile: { h: 114 }, desktop: { h: 812, nature: 'wH' }, elements: [
    { type: 'graphic', visible: 'a', mobile: { x: 0, y: 0, w: 320, h: 114 }, desktop: { x: 0, y: 0, w: 1200, h: 812 } }, // squashed photo hero
  ] });
  // A card group knocked off the left edge, with a too-small caption inside it.
  blocks.push({ id: 'G', name: 'Cards', visible: 'a', mobile: { h: 600 }, desktop: { h: 600 }, elements: [
    { type: 'group', visible: 'a', mobile: { x: -20, y: 100, w: 200, h: 200 }, desktop: { x: 100, y: 100, w: 300, h: 300 }, elementOrder: ['p', 'q'], elements: {
      p: { type: 'graphic', visible: 'a', mobile: { x: 0, y: 0, w: 200, h: 150 }, desktop: { x: 0, y: 0, w: 300, h: 220 } },
      q: T('Caption', { x: 0, y: 160, w: 200, h: 15, size: 10 }),
    } },
  ] });
  // A box added on desktop lands over the text on mobile; a text on its own coloured box is design.
  blocks.push({ id: 'H', name: 'Hero', visible: 'a', mobile: { h: 300 }, desktop: { h: 600 }, elements: [
    T('Covered', { x: 10, y: 10, w: 200, h: 30 }, { desktop: { x: 0, y: 0, w: 300, h: 40 } }),
    { type: 'simple', visible: 'a', mobile: { x: 0, y: 0, w: 320, h: 100 }, desktop: { x: 500, y: 0, w: 200, h: 200 } },
    T('On its box', { x: 10, y: 200, w: 200, h: 30 }, { desktop: { x: 0, y: 300, w: 300, h: 40 } }),
    T('Squeezed quote', { x: 160, y: 120, w: 150, h: 70 }, { desktop: { x: 700, y: 100, w: 400, h: 80 } }),
    { type: 'simple', visible: 'a', mobile: { x: 0, y: 190, w: 320, h: 60 }, desktop: { x: 0, y: 290, w: 400, h: 80 } },
  ] });
  const ink = {
    'H.elements.3': { dx: 0, dy: 0, w: 148, h: 68, lines: 4 },
    'D.elements.0': { dx: 13, dy: -4, w: 293, h: 90, lines: 2 },
    'D.elements.1': { dx: 0, dy: -14, w: 13054, h: 5102, lines: 3 },
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
    'B.elements.14 off screen sideways {"x":0}',
    'B.elements.20 off screen sideways {"x":220,"also":[{"id":"B.elements.19","fix":{"x":220}}]}',
    'B.elements.3 overlaps text "B" null',
    'B.elements.12 too close to text above {"y":271}',
    'B.elements.18 too close to text above {"y":51}',
    'C.elements.0 text 10px, under 12px; at 12px it would run into "Paris", needs a manual layout null',
    'C.elements.2 too close to text above {"y":28,"also":[{"id":"C.elements.3","fix":{"y":28}}]}',
    'D.elements.0 off screen sideways {"x":0}',
    'D.elements.1 off screen sideways null',
    'D.elements.1 text wraps past its box null',
    'D.elements.2 text 1410px on mobile but 20px on desktop {"size":12}',
    'D.elements.3 off screen sideways {"x":0}',
    "D.elements.4 background doesn't cover its section {\"x\":0,\"y\":0,\"w\":320,\"h\":400}",
    'D.elements.1 overlaps text "Typo" null',
    'E photo section only 114px tall on mobile {"sectionH":480}',
    'G.elements.0 off screen sideways {"x":0}',
    'G.elements.0.elements.q text 10px, under 12px {"size":12}',
    'H.elements.3 text squeezed into a 150px column null',
    'H.elements.0 covered by a shape on mobile null',
  ]);
  console.log('selftest ok');
}

async function main(page) {
  const { eachPage, readLog } = require('./editor'); // lazy: editor.js requires this file
  const seenShared = new Set();
  // Fixes that were tried and failed (fix.js logs them, with the reason): report with that reason.
  const skips = new Map(readLog().filter(e => e.skip).map(e => [e.skip, e.note.replace(/^skip next time:? ?/, '') || 'it made the layout worse']));
  let total = 0, fixable = 0;
  for await (const name of eachPage(page)) {
    // Shared sections (Header/Footer) appear on every page: report them once.
    const issues = audit(await readModel(page)).filter(i => !i.shared || !seenShared.has(i.id + i.problem));
    for (const i of issues) {
      const why = i.fix && skips.get(i.id + JSON.stringify(i.fix));
      if (why) { i.fix = null; i.problem += `; not fixed last time: ${why}`; }
    }
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

module.exports = { audit, readModel, textSize, textAlign, blownUp, phoneSize, plain, onMobile, MOBILE_W, MIN_TEXT, MIN_HERO, DESKTOP_W, EDGE };
if (require.main === module) {
  if (process.argv.includes('--selftest')) selftest();
  else require('./connect').run(main);
}
