// GENERATED from ../audit.js by scripts/sync-rules.mjs. Edit the rules there, not here.
/* eslint-disable */
const MOBILE_W = 320;
const MIN_TEXT = 12; // px; ponytail: fixed threshold, make per-style if it flags intentional captions
const MAX_NUDGE = 40; // px; text spilling further than this whose letters can't fit on screen is a deliberate design (marquees etc.)
const MIN_GAP = 6; // px; minimum vertical breathing room between stacked small texts
const DESKTOP_W = 1200; // Showit's desktop canvas
const MIN_HERO = 480; // px; ponytail: one phone screen (568) minus browser bars, make per-site if heroes differ

// Runs inside the preview iframe. Where the text actually is, relative to its box, in design px.
function measureInk() {
  const out = {};
  for (const el of document.querySelectorAll('[id^="si_element_"]')) {
    // Top-level element (block_elements_3) or a child inside a group (block_elements_3_elements_<child id>).
    const m = el.id.match(/^si_element_(.+?)_elements_(\d+)(?:_elements_(.+))?$/);
    if (!m || !el.innerText.trim() || !el.offsetWidth) continue;
    const box = el.getBoundingClientRect();
    const s = box.width / el.offsetWidth; // preview is CSS-scaled by the editor zoom
    if (Math.abs(box.height / el.offsetHeight - s) > 0.05 * s) continue; // rotated: its box is used instead
    const r = document.createRange();
    r.selectNodeContents(el);
    const c = r.getBoundingClientRect();
    const lines = new Set([...r.getClientRects()].filter(q => q.height).map(q => Math.round(q.top / s / 4))).size;
    out[`${m[1]}.elements.${m[2]}${m[3] ? `.elements.${m[3]}` : ''}`] = { dx: (c.x - box.x) / s, dy: (c.y - box.y) / s, w: c.width / s, h: c.height / s, lines };
  }
  return out;
}

// Shown on phones: everywhere ('a') or phone-only ('m'); not desktop-only ('d') or hidden on both ('n').
// The box a rotated element really covers (Showit stores the unrotated box plus an angle "a").
const turned = r => {
  const a = (((r?.a || 0) % 180) + 180) % 180;
  if (!r || !a) return r;
  const t = (a * Math.PI) / 180, c = Math.abs(Math.cos(t)), n = Math.abs(Math.sin(t));
  const w = r.w * c + r.h * n, h = r.w * n + r.h * c;
  return { ...r, x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
};
const rotated = e => turned(e.mobile) !== e.mobile;

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

function audit({ blocks, theme, ink = {} }) {
  const issues = [];
  const idOf = (b, e) => e._id ?? `${b.id}.elements.${b.elements.indexOf(e)}`;
  // Groups: Showit stores a group's children relative to the group. Check the children like any other
  // element, in page coordinates, and convert their fixes back to the group's coordinates.
  const offs = new Map(); // child id -> group's mobile position
  const flat = b => (b.elements || []).flatMap((e, i) => {
    const id = `${b.id}.elements.${i}`;
    if (e.type !== 'group' || !e.elements || !onMobile(e)) return [{ ...e, _id: id, _z: i }];
    const g = e.mobile || {}, gd = e.desktop || {};
    const at = (r, o) => r && { ...r, x: (r.x || 0) + (o.x || 0), y: (r.y || 0) + (o.y || 0) };
    const kids = (e.elementOrder || Object.keys(e.elements)).filter(c => e.elements[c]).map((c, j) => {
      const k = e.elements[c], kid = `${id}.elements.${c}`;
      offs.set(kid, { x: g.x || 0, y: g.y || 0 });
      return { ...k, _id: kid, _z: i + (j + 1) / 1000, _child: true, lockEditing: k.lockEditing || e.lockEditing, mobile: at(k.mobile, g), desktop: at(k.desktop, gd) };
    });
    return [{ ...e, _id: id, _z: i }, ...kids];
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
    const k = ink[idOf(b, e)], d = turned(e.desktop);
    if (!k || d !== e.desktop) return d;
    const ms = textSize(e, theme) || 1, ds = e.desktop?.size ?? styleOf(e, theme).desktop?.size ?? ms;
    const w = Math.min(d.w, (k._mass ?? k.w * Math.max(1, k.lines || 1)) * ds / ms);
    const al = e.desktop?.tA ?? styleOf(e, theme).desktop?.tA ?? 'left';
    return { x: d.x + (al === 'center' ? (d.w - w) / 2 : al === 'right' ? d.w - w : 0), y: d.y, w, h: d.h };
  };
  const inkRect = (b, e) => {
    const k = !rotated(e) && ink[idOf(b, e)], m = e.mobile;
    return k ? { x: m.x + k.dx, y: m.y + k.dy, w: k.w, h: k.h } : turned(m);
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
      // Parked outside the canvas on desktop and off the phone too: hidden on purpose (hover tricks, notes).
      if (d?.w && (d.x >= DESKTOP_W || d.x + d.w <= 0) && (m.x >= MOBILE_W || m.x + m.w <= 0)) continue;
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
      const tb = turned(m), turn = tb !== m;
      const k0 = e.type === 'text' && !turn ? ink[idOf(b, e)] : null;
      const left = k0 ? m.x + k0.dx : tb.x, right = k0 ? m.x + k0.dx + k0.w : tb.x + tb.w;
      // Group children move with their group: the group itself is checked for this.
      // Shapes, lines, icons and small pictures bleeding off the edge are decoration (templates do it a
      // lot); a photo, button or card that is mostly off the phone (under 80% showing) was knocked out.
      const spillX = Math.max(-left, right - MOBILE_W), shown = Math.max(0, Math.min(MOBILE_W, right) - Math.max(0, left)) / Math.max(1, right - left);
      // A matching picture bleeding off the other side at the same height: a symmetric frame, design.
      const mirrored = e.type !== 'text' && els.some(o => o !== e && o.type === e.type && o.mobile && Math.abs(o.mobile.w - m.w) <= 0.1 * m.w &&
        Math.abs(o.mobile.y - m.y) <= 20 && (left < 0 ? o.mobile.x + o.mobile.w > MOBILE_W : o.mobile.x < 0));
      const decor = e.type !== 'text' && (mirrored || !['graphic', 'gallery', 'video', 'button', 'group'].includes(e.type) || tb.w < 80 || shown >= 0.8 || spillX <= 12);
      if (!e._child && !decor && (left < -0.5 || right > MOBILE_W + 0.5)) {
        const spill = spillX;
        // Letters that fit on one screen are a real bug however far they spill (a heading pushed off the side).
        // Anything sitting inside the canvas on desktop but off it on mobile was knocked out of place.
        const inOnDesktop = d && d.x >= -2 && d.x + d.w <= DESKTOP_W + 2;
        // A group can only be moved (Showit locks its size): wider than the screen means its insides need laying out.
        const nudge = !(e.type === 'group' && m.w > MOBILE_W) && (inOnDesktop || e.type === 'text' && (spill <= MAX_NUDGE || right - left <= MOBILE_W));
        // Slide back on screen keeping the width (no new wrapping); shrink only if wider than the screen.
        // (A rotated element is slid by where its turned box lands.)
        const fix = turn ? { x: m.x + Math.min(Math.max(0, tb.x), MOBILE_W - tb.w) - tb.x }
          : m.w <= MOBILE_W ? { x: Math.min(Math.max(0, m.x), MOBILE_W - m.w) }
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
      // Text past the section bottom is a bug (often after we push it down); shapes and images doing it
      // are design. Judged by where the letters end.
      const bottom = k0 ? m.y + k0.dy + k0.h : tb.y + tb.h;
      if (e.type === 'text' && !e._child && !(k0 && k0.w > MOBILE_W) && bh > 1 && bottom > bh + 0.5) add(b, e, `sticks out below section (bottom ${Math.round(bottom)}, section height ${bh})`,
        bottom - bh <= MAX_NUDGE ? { sectionH: Math.ceil(bottom + MIN_GAP) } : null);
      // A button too small to tap comfortably (templates use 30-44px).
      if (e.type === 'button' && m.h < 28) add(b, e, `button only ${m.h}px tall, hard to tap`, { h: 40 });
      // Letters touching the screen edge (on screen, under 4px away): give them a 12px margin.
      if (k0 && left >= -0.5 && right <= MOBILE_W + 0.5 && (left < 4 || right > MOBILE_W - 4)) {
        const x = Math.max(m.x, 12), w = Math.min(m.x + m.w, MOBILE_W - 12) - x;
        if (w >= 100) add(b, e, `text touching the screen edge (${Math.round(Math.min(left, MOBILE_W - right))}px away)`, { x, w });
      }
      if (e.type === 'text') {
        const s = textSize(e, theme);
        if (s < MIN_TEXT) {
          // Predict where the bigger text lands (grows from its alignment side). If it would run into
          // other text, e.g. a "Location:" label sitting right next to its value, a person must re-lay it.
          const k = !turn && ink[idOf(b, e)], r = MIN_TEXT / s, al = textAlign(e, theme);
          // 2px margin: bigger text also shifts down a little inside its box (line height).
          const grown = k && { w: k.w * r + 4, h: k.h * r + 4, y: m.y + k.dy - 2,
            x: m.x + k.dx - 2 - (al === 'center' ? k.w * (r - 1) / 2 : al === 'right' ? k.w * (r - 1) : 0) };
          const hit = grown && els.find(o => o !== e && o.type === 'text' && o.mobile && !o.wp && overlap(grown, inkRect(b, o)));
          if (hit) add(b, e, `text ${s}px, under ${MIN_TEXT}px; at ${MIN_TEXT}px it would run into "${plain(hit.content?.text).slice(0, 30)}", needs a manual layout`);
          else add(b, e, `text ${s}px, under ${MIN_TEXT}px`, { size: MIN_TEXT });
        }
        // (Text running past its own box isn't a problem by itself: Showit doesn't clip it. What it runs
        // into is: the overlap and section-bottom checks use where the letters really are.)
        const k = !turn && ink[idOf(b, e)]; // rotated text: no column check
        // A paragraph squeezed into a narrow column: a desktop multi-column layout shrunk onto the phone.
        // The section needs laying out again (fix.js rebuilds it).
        // Side-by-side columns that are all filled (three stats in a row) are a phone design: skip those.
        const beside = k && els.some(o => o !== e && o.mobile && !o._child === !e._child && turned(o.mobile).w < 0.9 * MOBILE_W && !overlap({ ...m, y: -1e6, h: 2e6 }, turned(o.mobile)) &&
          Math.min(turned(o.mobile).y + turned(o.mobile).h, m.y + k.dy + k.h) - Math.max(turned(o.mobile).y, m.y + k.dy) > 0.5 * k.h);
        if (k && !e.wp && k.lines >= 3 && m.w < 0.55 * MOBILE_W && !beside)
          add(b, e, `text squeezed into a ${Math.round(m.w)}px column (${k.lines} lines), the section needs a phone layout`);
      }
    }
    // WordPress dynamic text (e.wp) is placeholder in the editor; its real size varies, so skip layout checks.
    const texts = els.filter(e => e.type === 'text' && e.mobile && !e.wp);
    // Text covered by a shape, photo or button on mobile that it isn't touching on desktop: a layout
    // that was never done for phones (e.g. a box added on desktop lands on top of the text on mobile).
    // Only what is drawn ABOVE the text hides it; a box under the text is its background panel.
    const solids = els.filter(e => !['text', 'line', 'group'].includes(e.type) && e.mobile && e.desktop?.w);
    for (const t of texts.filter(t => t.desktop?.w))
      for (const o of solids.filter(o => o._z > t._z)) {
        // Text laid on a photo on desktop (its middle on a bigger picture) stays on it on mobile: design.
        const d = turned(t.desktop), od = turned(o.desktop), cx = d.x + d.w / 2, cy = d.y + d.h / 2;
        const onPhoto = cx > od.x && cx < od.x + od.w && cy > od.y && cy < od.y + od.h && od.w * od.h > 1.5 * d.w * d.h;
        // A see-through overlay (under 60% opacity) or a hairline box doesn't hide text; a solid box over
        // a good part of the letters does.
        const om = turned(o.mobile), hides = (o.mobile.o ?? o.desktop?.o ?? 100) >= 60 && Math.min(om.w, om.h) >= 6;
        const share = overlapShare(inkRect(b, t), om);
        if (!onPhoto && hides && share >= 0.3 && overlapShare(d, od) < 0.5 * share) {
          add(b, t, `covered by a ${o.type === 'simple' ? 'shape' : o.type} on mobile (not on desktop)`);
          break;
        }
      }
    const push = new Map(); // lower element -> [px needed, gap]; one fix each, for the tightest gap
    for (let i = 0; i < texts.length; i++)
      for (let j = i + 1; j < texts.length; j++) {
        const a = inkRect(b, texts[i]), c = inkRect(b, texts[j]);
        if (overlap(a, c) && overlapShare(a, c) >= 0.3) {
          // Text layered on text on desktop too (a word over a big decorative title) is the design.
          // Only when they overlap about as much on desktop: a word moved onto another on mobile is still a bug.
          const designed = texts[i].desktop?.w && texts[j].desktop?.w && overlapShare(deskInk(b, texts[i]), deskInk(b, texts[j])) >= 0.5 * overlapShare(a, c);
          // A big decorative word behind smaller text ("Our Story" at 120px behind a caption) is design too.
          const si = textSize(texts[i], theme), sj = textSize(texts[j], theme);
          const backdrop = Math.max(si, sj) >= 60 && Math.max(si, sj) >= 2.5 * Math.min(si, sj);
          if (!designed && !backdrop) add(b, texts[i], `overlaps text "${plain(texts[j].content?.text).slice(0, 30)}"`);
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

export { audit, measureInk, MOBILE_W };
