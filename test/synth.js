// Synthetic Showit pages in the shapes templates use (hero, split, cards, testimonials, pricing,
// gallery, footer), so the rules are scored on more than one site's style. Each section comes in two
// phone versions:
//   broken: the desktop layout shrunk onto the phone (never designed for mobile)
//   good:   a hand-made phone layout (one column, sensible sizes): the audit must not flag it
// Text is "measured" from its length and size (the browser does this on real pages).

const CHAR = 0.5, LINE = 1.3; // average glyph width and line height, as a share of the font size

let seq = 0;
const T = (text, d, size, msize, extra = {}) => ({ type: 'text', visible: 'a', content: { text }, desktop: { ...d, size }, mobile: { size: msize }, ...extra, _len: text.length });
const G = (d, type = 'graphic') => ({ type, visible: 'a', content: {}, desktop: d, mobile: {} });
const I = d => G(d, 'icon');
const B = d => ({ type: 'button', visible: 'a', content: {}, desktop: d, mobile: {} });

// Desktop layouts (1200 wide). Coordinates are typical of template sections.
const SECTIONS = {
  hero: () => [G({ x: 0, y: 0, w: 1200, h: 800 }), T('Websites that make your brand impossible to overlook', { x: 150, y: 220, w: 900, h: 200 }, 80, 36),
    T('Elevated, strategic websites for ambitious coaches', { x: 300, y: 450, w: 600, h: 30 }, 16, 13), B({ x: 500, y: 520, w: 200, h: 50 })],
  split: () => [G({ x: 60, y: 60, w: 520, h: 640 }), T('Meet the designer', { x: 660, y: 120, w: 480, h: 70 }, 56, 32),
    T('I help service providers build a brand and website that feels like them, from the first click to the booked call. ' +
      'Every project starts with strategy and ends with a site you are proud to share.', { x: 660, y: 220, w: 460, h: 160 }, 16, 14),
    B({ x: 660, y: 420, w: 200, h: 50 })],
  cards: () => [0, 1, 2].map(i => ({
    type: 'group', visible: 'a', desktop: { x: 60 + i * 380, y: 120, w: 340, h: 520 }, mobile: {}, elementOrder: ['p', 't', 'x'], elements: {
      p: G({ x: 0, y: 0, w: 340, h: 380 }),
      t: T(['For the coaches', 'For e-commerce', 'For creatives'][i], { x: 0, y: 400, w: 340, h: 40 }, 28, 22),
      x: T('Sophisticated websites to showcase your expertise and attract your dream clients.', { x: 0, y: 450, w: 320, h: 60 }, 15, 14),
    } })).concat([T('Two paths. One elevated experience.', { x: 200, y: 30, w: 800, h: 60 }, 40, 26)]),
  testimonials: () => [0, 1, 2].flatMap(i => [
    ...[0, 1, 2, 3, 4].map(s => I({ x: 80 + i * 370 + s * 28, y: 120, w: 24, h: 24 })),
    T('“Working with her felt like a calm, artful process. Our new site books clients for us every week.”', { x: 80 + i * 370, y: 160, w: 320, h: 140 }, 20, 15),
    T(['— Sophie D.', '— Clara V.', '— Julien M.'][i], { x: 80 + i * 370, y: 320, w: 200, h: 24 }, 14, 12),
  ]),
  pricing: () => [0, 1, 2].flatMap(i => [
    T(['Starter', 'Signature', 'Luxe'][i], { x: 80 + i * 370, y: 80, w: 300, h: 40 }, 30, 24),
    T(['$2,500', '$4,800', '$7,900'][i], { x: 80 + i * 370, y: 140, w: 300, h: 70 }, 56, 40),
    T('Custom design, five pages, mobile layout, launch support and training videos.', { x: 80 + i * 370, y: 230, w: 300, h: 100 }, 16, 14),
    B({ x: 80 + i * 370, y: 360, w: 220, h: 50 }),
  ]),
  gallery: () => [0, 1, 2, 3].map(i => G({ x: 40 + i * 285, y: 80, w: 265, h: 360 })).concat([T('Recent work', { x: 40, y: 20, w: 400, h: 50 }, 36, 26)]),
  footer: () => [T('Studio Name', { x: 60, y: 60, w: 300, h: 60 }, 44, 30),
    ...['Home', 'About', 'Services'].map((t, i) => T(t, { x: 500, y: 70 + i * 34, w: 160, h: 22 }, 14, 12)),
    ...['Portfolio', 'Blog', 'Contact'].map((t, i) => T(t, { x: 700, y: 70 + i * 34, w: 160, h: 22 }, 14, 12)),
    ...[0, 1, 2].map(i => I({ x: 960 + i * 40, y: 70, w: 28, h: 28 })),
    T('© 2026 Studio Name. All rights reserved. Website by a designer you love.', { x: 300, y: 300, w: 600, h: 22 }, 13, 12)],
};
const DH = { hero: 800, split: 760, cards: 680, testimonials: 400, pricing: 460, gallery: 480, footer: 360 };

// Phone layouts. broken: desktop scaled into 320px (text keeps its phone font, so it spills and collides).
// good: one column, 20px margins, measured heights, rows of icons kept.
function phone(els, how, sectionDH) {
  const k = 320 / 1200;
  if (how === 'broken') {
    for (const e of els) {
      if (e.type === 'group') { e.mobile = { x: e.desktop.x * k, y: e.desktop.y * k, w: e.desktop.w * k, h: e.desktop.h * k }; phone(Object.values(e.elements), 'broken'); continue; }
      e.mobile = { ...e.mobile, x: e.desktop.x * k, y: e.desktop.y * k, w: e.desktop.w * k, h: e.desktop.h * k };
    }
    return Math.round(sectionDH * k);
  }
  let y = 40;
  const order = [...els].sort((a, b) => a.desktop.y - b.desktop.y || a.desktop.x - b.desktop.x);
  const isBg = e => e.type === 'graphic' && e.desktop.w >= 1080;
  for (let i = 0; i < order.length; i++) {
    const e = order[i];
    if (isBg(e)) continue;
    if (e.type === 'icon') { // keep the row of icons
      // one testimonial's stars (same line, next to each other), not every star on the line
      const row = order.filter(o => o.type === 'icon' && Math.abs(o.desktop.y - e.desktop.y) < 5 && o.desktop.x >= e.desktop.x && o.desktop.x - e.desktop.x < 200 && !o.mobile.w);
      row.forEach((o, j) => { o.mobile = { x: 100 + j * 26, y, w: 20, h: 20 }; });
      y += 20 + 16;
      continue;
    }
    if (e.mobile.w) continue;
    if (e.type === 'group') {
      let gy = 0;
      for (const c of Object.values(e.elements)) {
        const h = c.type === 'text' ? textH(c, 280) : Math.round(c.desktop.h * 280 / c.desktop.w);
        c.mobile = { ...c.mobile, x: 0, y: gy, w: 280, h };
        gy += h + 12;
      }
      e.mobile = { x: 20, y, w: 280, h: gy - 12 };
      y += gy + 16;
      continue;
    }
    const w = e.type === 'text' ? 280 : e.type === 'button' ? 200 : 280;
    const h = e.type === 'text' ? textH(e, w) : e.type === 'button' ? 46 : Math.round(e.desktop.h * w / e.desktop.w);
    e.mobile = { ...e.mobile, x: Math.round((320 - w) / 2), y, w, h };
    y += h + 16;
  }
  for (const e of order.filter(isBg)) e.mobile = { x: 0, y: 0, w: 320, h: y + 24 };
  return y + 24;
}
const textH = (e, w) => { const s = e.mobile.size; return Math.ceil(Math.max(1, Math.ceil(e._len * CHAR * s / (w - 2))) * LINE * s) + 4; };

// Ink for every text, as measured from the phone layout.
function measure(model) {
  const ink = {};
  const one = (id, e) => {
    if (e.type !== 'text' || !e.mobile.w) return;
    const s = e.mobile.size, mass = e._len * CHAR * s, w = e.mobile.w;
    const lines = Math.max(1, Math.ceil(mass / Math.max(1, w - 2)));
    const iw = Math.min(mass, w);
    ink[id] = { _mass: mass, _lineH: LINE * s, lines, w: iw, h: lines * LINE * s, dy: 1, dx: (w - iw) / 2 };
  };
  for (const b of model.blocks) b.elements.forEach((e, i) => {
    one(`${b.id}.elements.${i}`, e);
    if (e.type === 'group') for (const [c, k] of Object.entries(e.elements)) one(`${b.id}.elements.${i}.elements.${c}`, k);
  });
  return ink;
}

// One page per phone version, every section kind on it.
function pages() {
  return ['broken', 'good'].map(how => {
    const blocks = Object.entries(SECTIONS).map(([name, make]) => {
      const elements = make();
      const h = phone(elements, how, DH[name]);
      return { id: `S${++seq}`, name, visible: 'a', desktop: { h: DH[name] }, mobile: { h }, elements };
    });
    for (const b of blocks) for (const e of b.elements) { if (e.type === 'text') e.desktop.tA = 'center'; if (e.elements) for (const c of Object.values(e.elements)) if (c.type === 'text') c.desktop.tA = 'center'; }
    const model = { site: 'synthetic', page: how, theme: { styles: {} }, blocks };
    model.ink = measure(model);
    return model;
  });
}

module.exports = { pages };
