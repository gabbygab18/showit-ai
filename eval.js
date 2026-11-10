// Scores the rules on the layout dataset (test/fixtures), offline: nothing touches Showit.
//   node eval.js             summary
//   node eval.js --verbose   every miss, false alarm and leftover
//   node eval.js --strict    exit 1 when accuracy drops below the floors or the baseline (npm test)
//   node eval.js --update-baseline   record the current results as the baseline
//
// For every page in the dataset it breaks layouts on purpose, in the ways real sites break (labelled),
// then checks: did the audit catch it (detection)? did it flag anything else (false alarms)? and after
// the full Fix (patches + automatic rebuild, simulated), is the page clean (end to end)?
const fs = require('fs');
const path = require('path');
const { audit, textSize, textAlign, MOBILE_W } = require('./audit');
const rb = require('./rebuild');

const DIR = path.join(__dirname, 'test', 'fixtures');
const VERBOSE = process.argv.includes('--verbose');
const clone = o => JSON.parse(JSON.stringify(o));

// ---- offline Showit ------------------------------------------------------------------------------

const { findEl } = require('./editor');

// Re-wrap measured text after a width or size change, like the browser would (approximately):
// keep its total one-line width ("mass") and line height, scaled by the size change.
function reflow(model, id, el, ratio = 1, prevW = el.mobile.w) {
  const k = model.ink[id];
  if (!k || el.type !== 'text') return;
  const lines0 = Math.max(1, k.lines || 1);
  const mass = (k._mass ?? k.w * lines0) * ratio;
  const lineH = (k._lineH ?? k.h / lines0) * ratio;
  const nowrap = k._nowrap ?? (lines0 === 1 && k.w > (prevW || 0) + 2); // marquee-style single line (judged before the change)
  const w = el.mobile.w || 1;
  const lines = nowrap ? 1 : Math.max(1, Math.ceil(mass / Math.max(1, w - 2)));
  const iw = nowrap ? mass : Math.min(mass, w);
  const al = textAlign(el, model.theme);
  model.ink[id] = { _mass: mass, _lineH: lineH, _nowrap: nowrap, lines, w: iw, h: lines * lineH,
    dy: (k.dy || 0) * ratio, dx: al === 'center' ? (w - iw) / 2 : al === 'right' ? w - iw : 0 };
}

// A group's box follows its children (Showit recomputes it).
function regroup(model, id) {
  const parts = id.split('.');
  if (parts.length < 5 || parts[1] === 'states') return;
  const g = findEl(model, parts.slice(0, 3).join('.'));
  const kids = Object.values(g.elements || {}).filter(c => c.mobile);
  g.mobile.w = Math.max(...kids.map(c => (c.mobile.x || 0) + c.mobile.w));
  g.mobile.h = Math.max(...kids.map(c => (c.mobile.y || 0) + c.mobile.h));
}

function apply(model, id, target) {
  const el = findEl(model, id);
  if (!el) throw new Error(`no element ${id}`);
  const s0 = el.type === 'text' ? textSize(el, model.theme) : 1, w0 = el.mobile.w;
  for (const [k, v] of Object.entries(target)) el.mobile[k] = Math.round(v);
  if (el.type === 'text') reflow(model, id, el, textSize(el, model.theme) / s0, w0);
  regroup(model, id);
  return model;
}

const sim = {
  RUN: 'eval',
  findEl,
  say: async () => {},
  applyMobile: async (page, model, id, target) => apply(model, id, target),
  setSectionHeight: async (page, model, bid, h) => { model.blocks.find(b => b.id === bid).mobile.h = Math.round(h); return model; },
};
rb.useEditor(sim);

// ---- the Fix button, simulated (same steps as fix.js) ----------------------------------------------

const key = i => i.id + JSON.stringify(i.fix);
const problems = (model, bid) => audit(model).filter(x => !x.fix && x.id.split('.')[0] === bid)
  .map(x => `${x.what}: ${x.problem.split(' (')[0]}`);

async function simulateFix(model) {
  model = clone(model);
  const reverted = new Set();
  let rebuilt = 0;
  const passes = () => {
    for (let pass = 1; pass <= 6; pass++) {
      const seen = new Set();
      const issues = audit(model).filter(i => i.fix && !reverted.has(key(i)) && !seen.has(i.id) && seen.add(i.id));
      if (!issues.length) break;
      for (const i of issues) {
        const { also = [], ...main } = i.fix;
        // A fix that changes nothing (it's already that way) won't help: leave it to the rebuild.
        const cur = !main.sectionH && findEl(model, i.id);
        if (cur && Object.entries(main).every(([k, v]) => Math.round(v) === (k === 'size' ? textSize(cur, model.theme) : cur.mobile?.[k]))) { reverted.add(key(i)); continue; }
        const bid = i.id.split('.')[0];
        const before = new Set(problems(model, bid));
        const snap = clone(model);
        if (main.sectionH) model.blocks.find(b => b.id === bid).mobile.h = main.sectionH;
        else { apply(model, i.id, main); for (const a of also) apply(model, a.id, a.fix); }
        if (problems(model, bid).some(p => !before.has(p))) { model = snap; reverted.add(key(i)); }
      }
    }
  };
  passes();
  const stuck = [...new Set(audit(model).filter(i => !/intentional|locked/.test(i.problem))
    .map(i => i.id.split('.')[0]))];
  const log = console.log;
  console.log = () => {};
  try {
    for (const bid of stuck) {
      const block = model.blocks.find(b => b.id === bid);
      if (!block || (block.canvasSet && block.mobile?.h <= 1)) continue;
      try { model = await rb.rebuild(null, model, block, true); } catch { continue; } // e.g. a slideshow in the way
      rebuilt++;
      // New layout: fixes that were undone in the old one get another chance.
      for (const k of [...reverted]) if (k.startsWith(bid + '.')) reverted.delete(k);
    }
  } finally { console.log = log; }
  if (rebuilt) passes();
  return { model, rebuilt };
}

const real = i => !/intentional/.test(i.problem);

// How a laid-out section reads on a phone (pro templates' medians as the bar): text away from the
// edges, paragraphs big enough, buttons easy to tap, headings not too tall.
const ux = { margin: [0, 0], body: [0, 0], button: [0, 0], heading: [0, 0], shapes: [0, 0] };
function quality(model, bid) {
  const b = model.blocks.find(x => x.id === bid);
  // A shape (colour block) alone in the column, touching nothing: an empty box. It should sit with something.
  const boxes = b.elements.filter(e => e.visible !== 'd' && e.visible !== 'n' && e.mobile?.w).map(e => e.mobile);
  for (const e of b.elements.filter(e => e.type === 'simple' && e.visible !== 'd' && e.visible !== 'n' && e.mobile?.w)) {
    const m = e.mobile, alone = !boxes.some(o => o !== m && o.x < m.x + m.w && m.x < o.x + o.w && o.y < m.y + m.h && m.y < o.y + o.h);
    ux.shapes[1]++; if (!alone) ux.shapes[0]++;
  }
  for (const [i, e] of b.elements.entries()) {
    if (e.visible === 'd' || e.visible === 'n' || !e.mobile?.w || e.mobile.a) continue;
    const k = model.ink[`${bid}.elements.${i}`];
    const tick = (key, ok) => { ux[key][1]++; if (ok) ux[key][0]++; };
    if (e.type === 'button') tick('button', e.mobile.h >= 40);
    if (e.type !== 'text' || !k || k.w > MOBILE_W) continue;
    const l = e.mobile.x + k.dx;
    tick('margin', l >= 12 && l + k.w <= MOBILE_W - 12);
    const sz = textSize(e, model.theme);
    if (k.lines >= 3 && sz < 24) tick('body', sz >= 14);
    if (sz >= 32) tick('heading', k.lines <= 3);
  }
}
const sig = i => `${i.id}|${i.problem.split(/[(,;]/)[0].trim()}`;

// ---- ways layouts break (labelled) --------------------------------------------------------------

const S = 0.267; // desktop -> phone scale
const sections = model => model.blocks.filter(b => b.visible !== 'd' && !(b.canvasSet && b.mobile?.h <= 1) && b.elements?.length);
// WordPress text (blog templates) is placeholder in the editor; the rules skip it on purpose.
const els = b => b.elements.map((e, i) => ({ e, id: `${b.id}.elements.${i}` })).filter(({ e }) => e.visible === 'a' && e.mobile && e.desktop?.w && !e.wp);
// (reading text: not symbol-only glyphs like a big "&", which the rules leave alone)
const texts = b => els(b).filter(({ e }) => e.type === 'text' && e.desktop.w <= 1200 && /[\p{L}\p{N}]/u.test(String(e.content?.text || '').replace(/<[^>]*>/g, '')));
const inside = d => d.x >= 0 && d.x + d.w <= 1200;
const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; // touching on desktop

const BREAKS = {
  // Knocked two thirds off the right edge.
  // (text, or a photo/button/card: decorations bleeding off the edge are design, not tested)
  offscreen: (m, b) => els(b).filter(({ e }) => inside(e.desktop) && e.mobile.w <= MOBILE_W && (e.type === 'text' || (['graphic', 'gallery', 'video', 'button', 'group'].includes(e.type) && e.mobile.w >= 80))).slice(0, 2).map(({ e, id }) => ({
    targets: [id], expect: /off screen|doesn't cover/, go: x => apply(x, id, { x: MOBILE_W - Math.round(e.mobile.w / 3) }) })),
  // A typo'd tiny font.
  tiny: (m, b) => texts(b).slice(0, 2).map(({ id }) => ({ targets: [id], expect: /under 12px/, go: x => apply(x, id, { size: 8 }) })),
  // A typo'd huge font (1410 for 14).
  blowup: (m, b) => texts(b).slice(0, 1).map(({ e, id }) => ({
    targets: [id], expect: /on mobile but/, go: x => apply(x, id, { size: Math.max(200, textSize(e, m.theme) * 10) }) })),
  // One text dropped onto another.
  overlap: (m, b) => { const t = texts(b); return t.length < 2 ? [] : [{ targets: [t[0].id, t[1].id], expect: /overlaps|covered/,
    go: x => apply(x, t[0].id, { x: t[1].e.mobile.x, y: t[1].e.mobile.y }) }]; },
  // A photo or box lands on a text (added on desktop, never placed on mobile).
  // (a box drawn above the text: later in the section's order)
  covered: (m, b) => { const t = texts(b)[0], o = t && els(b).find(({ e, id }) => ['graphic', 'simple', 'button'].includes(e.type) && +id.split('.')[2] > +t.id.split('.')[2] && e.desktop.w < 1080 && e.mobile.w >= 10 && e.mobile.h >= 10 && !hits(e.desktop, t.e.desktop));
    return t && o ? [{ targets: [t.id, o.id], expect: /covered|overlaps/, go: x => apply(x, o.id, { x: t.e.mobile.x, y: t.e.mobile.y }) }] : []; },
  // A paragraph squeezed into a narrow column.
  squeeze: (m, b) => texts(b).filter(({ id }) => (m.ink[id]?.w || 0) * (m.ink[id]?.lines || 1) > 300).slice(0, 1).map(({ id }) => ({
    targets: [id], expect: /squeezed|wraps past/, go: x => apply(x, id, { w: 120 }) })),
  // Desktop layout shrunk onto the phone, never designed for mobile (the client case).
  scaled: (m, b) => els(b).length < 3 ? [] : [{ targets: els(b).map(x => x.id), expect: /./, go: x => {
    for (const { e, id } of els(b)) {
      if (e.type === 'text' && e.desktop.w > 1200) continue;
      apply(x, id, { x: e.desktop.x * S, y: e.desktop.y * 0.45, ...(e.type === 'text' ? { w: Math.max(40, e.desktop.w * S) } : {}) });
    }
  } }],
};

// ---- run ----------------------------------------------------------------------------------------

module.exports = { simulateFix, apply, BREAKS, quality };
if (require.main === module) (async () => {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
  const [synthBroken, synthGood] = require('./test/synth').pages();
  const data = files.map(f => [f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))])
    .concat([['synthetic--good', synthGood]]);
  const score = {};
  const add = (k, f, ok, note) => { (score[k] ??= { n: 0, ok: 0, bad: [] }).n++; if (ok) score[k].ok++; else if (note) score[k].bad.push(note); };
  let alarms = 0, cases = 0;
  const pageLeft = [];
  for (const [page, base] of data) {
    const f = page;
    const baseSigs = new Set(audit(base).map(sig));
    // The untouched page, fixed: what's left is what the tool can't clean up on its own.
    const fixedBase = (await simulateFix(base)).model;
    const leftBase = audit(fixedBase).filter(real);
    pageLeft.push([page, leftBase.length]);
    if (VERBOSE) for (const i of leftBase) console.log(`  left on ${page}: ${i.block} | ${i.what} | ${i.problem}`);
    const leftSigs = new Set(leftBase.map(sig));
    for (const b of sections(base)) for (const [kind, make] of Object.entries(BREAKS)) for (const c of make(base, b)) {
      // Already broken that way before we touched it: not a test of catching it.
      if (audit(base).some(i => c.targets.includes(i.id) && c.expect.test(i.problem) && real(i))) continue;
      const m = clone(base);
      try { c.go(m); } catch { continue; }
      cases++;
      const label = `${page} > ${b.name.trim()} [${kind}]`;
      const fresh = audit(m).filter(i => !baseSigs.has(sig(i)));
      const hit = fresh.some(i => c.targets.some(t => i.id === t || i.id.startsWith(t + '.') || i.id === b.id) && c.expect.test(i.problem));
      add(`catch: ${kind}`, f, hit, label);
      const stray = fresh.filter(i => i.id.split('.')[0] !== b.id);
      alarms += stray.length;
      if (VERBOSE) for (const i of stray) console.log(`  false alarm (${label}): ${i.block} | ${i.what} | ${i.problem}`);
      const { model: done, rebuilt } = await simulateFix(m);
      if (kind === 'scaled' && rebuilt) quality(done, b.id);
      const left = audit(done).filter(real).filter(i => !leftSigs.has(sig(i)));
      add(`clean after Fix: ${kind}`, f, !left.length, `${label}: ${left.map(i => `${i.what} ${i.problem.split(' (')[0]}`).join('; ')}`);
    }
  }
  // Synthetic template sections: the hand-made phone layout must pass untouched; the never-designed one
  // must be caught in every section and come out clean after Fix.
  const goodIssues = audit(synthGood).filter(real);
  if (VERBOSE) for (const i of goodIssues) console.log(`  false alarm (synthetic good): ${i.block} | ${i.what} | ${i.problem}`);
  alarms += goodIssues.length;
  const broken = audit(synthBroken).filter(real);
  // (a row of photos shrunk is still a fine photo row on a phone: nothing to catch there)
  for (const b of synthBroken.blocks.filter(b => b.name !== 'gallery')) add('catch: never designed (synth)', 'synth', broken.some(i => i.id.split('.')[0] === b.id), b.name);
  const { model: fixedSynth } = await simulateFix(synthBroken);
  for (const b of synthBroken.blocks) {
    const left = audit(fixedSynth).filter(real).filter(i => i.id.split('.')[0] === b.id);
    add('clean after Fix: never designed (synth)', 'synth', !left.length, `${b.name}: ${left.map(i => `${i.what} ${i.problem.split(' (')[0]}`).join('; ')}`);
  }
  console.log(`\nDataset: ${files.length} real pages + ${synthBroken.blocks.length * 2} synthetic template sections, ${cases} broken layouts\n`);
  const pct = s => `${(100 * s.ok / s.n).toFixed(1).padStart(5)}%  (${s.ok}/${s.n})`;
  for (const [k, s] of Object.entries(score).sort()) {
    console.log(`${k.padEnd(28)} ${pct(s)}`);
    if (VERBOSE) for (const b of s.bad.slice(0, 8)) console.log(`    - ${b}`);
  }
  console.log(`${'false alarms (other sections)'.padEnd(28)} ${alarms}`);
  const pc = ([ok, n]) => (n ? `${(100 * ok / n).toFixed(0)}% (${ok}/${n})` : '-');
  console.log(`
Phone layout after rebuild (never-designed sections): text 12px+ from the edges ${pc(ux.margin)}, paragraphs 14px+ ${pc(ux.body)}, buttons 40px+ tall ${pc(ux.button)}, headings in 3 lines ${pc(ux.heading)}, shapes sitting with something (not empty boxes) ${pc(ux.shapes)}`);
  const dirty = pageLeft.filter(([, n]) => n);
  console.log(`${'untouched pages left unclean'.padEnd(28)} ${dirty.length}/${pageLeft.length}${dirty.length ? '  ' + dirty.map(([p, n]) => `${p} (${n})`).join(', ') : ''}`);
  // npm test: accuracy below these floors fails the build (keeps it from sliding back). Not 100%: some
  // 'breaks' look fine on a phone (a photo grid shrunk is still a photo grid), and catching those would
  // mean false alarms on real templates.
  const FLOOR = { catch: 0.9, clean: 0.97 };
  const low = Object.entries(score).filter(([k, s]) => s.ok / s.n < (k.startsWith('catch') ? FLOOR.catch : FLOOR.clean));
  // ...and against the last recorded results (test/eval-baseline.json): no metric may drop more than
  // half a point, and no new false alarms or leftovers. Record new results with --update-baseline.
  const BASE = path.join(__dirname, 'test', 'eval-baseline.json');
  const now = { rates: Object.fromEntries(Object.entries(score).map(([k, s]) => [k, +(s.ok / s.n).toFixed(4)])),
    alarms, dirty: dirty.length, ux: Object.fromEntries(Object.entries(ux).map(([k, [ok, n]]) => [k, n ? +(ok / n).toFixed(4) : 1])) };
  if (process.argv.includes('--update-baseline')) { fs.writeFileSync(BASE, JSON.stringify(now, null, 1) + '\n'); console.log('baseline saved'); }
  const base = fs.existsSync(BASE) ? JSON.parse(fs.readFileSync(BASE, 'utf8')) : null;
  const slid = base ? [
    ...Object.entries(now.rates).filter(([k, r]) => base.rates[k] != null && r < base.rates[k] - 0.005).map(([k, r]) => `${k} ${(100 * r).toFixed(1)}% (was ${(100 * base.rates[k]).toFixed(1)}%)`),
    ...Object.entries(now.ux).filter(([k, r]) => base.ux?.[k] != null && r < base.ux[k] - 0.005).map(([k, r]) => `phone layout ${k} ${(100 * r).toFixed(1)}% (was ${(100 * base.ux[k]).toFixed(1)}%)`),
    ...(alarms > base.alarms ? [`false alarms ${alarms} (was ${base.alarms})`] : []),
    ...(dirty.length > base.dirty ? [`unclean pages ${dirty.length} (was ${base.dirty})`] : []),
  ] : [];
  if (process.argv.includes("--strict") && (alarms || dirty.length > 0.05 * pageLeft.length || low.length || slid.length)) {
    for (const [k, s] of low) console.error(`  below floor: ${k} ${(100 * s.ok / s.n).toFixed(1)}%`);
    for (const m of slid) console.error(`  worse than baseline: ${m}`);
    console.error('\neval: accuracy dropped (run node eval.js --verbose for details)');
    process.exitCode = 1;
  }
})().catch(e => { console.error(e); process.exit(1); });
