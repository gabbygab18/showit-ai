// GENERATED from ../audit.js by scripts/sync-rules.mjs. Edit the rules there, not here.
/* eslint-disable */
const MOBILE_W = 320;
const MIN_TEXT = 12; // px; ponytail: fixed threshold, make per-style if it flags intentional captions
const MAX_NUDGE = 40; // px; text spilling further than this whose letters can't fit on screen is a deliberate design (marquees etc.)
const EDGE = 15; // px; side margin kept when widening text
const MIN_GAP = 6; // px; minimum vertical breathing room between stacked small texts
const DESKTOP_W = 1200; // Showit's desktop canvas
const MIN_HERO = 480; // px; ponytail: one phone screen (568) minus browser bars, make per-site if heroes differ

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
      if (e.type === 'text') {
        const s = textSize(e, theme), ds = e.desktop?.size ?? styleOf(e, theme).desktop?.size;
        if (ds && s > 2 * ds && s > 60) { add(b, e, `text ${s}px on mobile but ${ds}px on desktop`, { size: ds }); continue; }
      }
      // Text: judge by where the letters are; a box hanging off screen with its text inside is harmless.
      const k0 = e.type === 'text' ? ink[idOf(b, e)] : null;
      const left = k0 ? m.x + k0.dx : m.x, right = k0 ? m.x + k0.dx + k0.w : m.x + m.w;
      if (left < -0.5 || right > MOBILE_W + 0.5) {
        const spill = Math.max(-left, right - MOBILE_W);
        // Letters that fit on one screen are a real bug however far they spill (a heading pushed off the side).
        // Anything sitting inside the canvas on desktop but off it on mobile was knocked out of place.
        const inOnDesktop = d && d.x >= -2 && d.x + d.w <= DESKTOP_W + 2;
        const nudge = inOnDesktop || e.type === 'text' && (spill <= MAX_NUDGE || right - left <= MOBILE_W);
        // Slide back on screen keeping the width (no new wrapping); shrink only if wider than the screen.
        const fix = m.w <= MOBILE_W ? { x: Math.min(Math.max(0, m.x), MOBILE_W - m.w) }
          : { x: Math.max(0, m.x), w: Math.min(m.x + m.w, MOBILE_W) - Math.max(0, m.x) };
        // Text lined up in a column with others: slide the whole column so it stays aligned.
        const dx = fix.x - m.x;
        if (e.type === 'text' && !fix.w && dx) {
          const col = els.filter(o => o !== e && o.type === 'text' && o.mobile && Math.abs(o.mobile.x - m.x) < 1.5);
          if (col.length && col.every(o => o.mobile.x + dx >= 0 && !o.lockEditing))
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
          add(b, e, `text wraps past its box (${k.lines} lines need ${Math.ceil(k.dy + k.h)}px, box is ${m.h}px)`
            + (k.w > MOBILE_W ? ', wider than the screen, looks intentional, skipped' : ''), // giant background lettering
            k.w > MOBILE_W ? null : wrapFix(m, k, textAlign(e, theme), s));
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

export { audit, measureInk, MOBILE_W };
