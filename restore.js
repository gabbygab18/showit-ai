// Undo a fix.js / rebuild.js run, using fixes-log.json.
//   node restore.js          list recent runs
//   node restore.js <run>    undo that run, newest change first
//   node restore.js <run> --page "About"   only that page's changes from the run
// Anything edited by hand since the run is left alone (reported), never overwritten.
const { readModel, textSize } = require('./audit');
const { flag, readLog, openPage, toPage, findEl, applyMobile, setSectionHeight, say } = require('./editor');

const undoable = () => readLog().filter(e => e.run && e.ok && e.undo && Object.keys(e.undo).length);

// Runs that can be undone, oldest first: [{ run, at, n, pages, notes }]
function runs() {
  const out = new Map();
  for (const e of undoable()) {
    const r = out.get(e.run) || { run: e.run, at: e.at, n: 0, pages: [], notes: [] };
    r.n++;
    if (!r.pages.includes(e.page)) r.pages.push(e.page);
    const note = e.note.split(' (')[0];
    if (!r.notes.includes(note)) r.notes.push(note);
    out.set(e.run, r);
  }
  return [...out.values()];
}

function list() {
  const all = runs();
  if (!all.length) return console.log('Nothing to restore.');
  console.log('Recent runs (newest last). Undo one with: node restore.js <run>\n');
  for (const r of all.slice(-15))
    console.log(`  ${r.run}  ${r.at.slice(0, 16).replace('T', ' ')}  ${r.n} change(s)  pages: ${r.pages.join(', ')}  (${r.notes.slice(0, 3).join('; ')})`);
}

async function main(page) {
  const run = process.argv[2];
  const only = flag('--page');
  const todo = undoable().filter(e => e.run === run && (!only || e.page === only)).reverse();
  if (!todo.length) throw new Error(`no changes logged for run ${run}. Run "node restore.js" to list runs.`);
  await toPage(page);
  let model = await readModel(page), skipped = 0;
  for (const e of todo) {
    // A shared section (header, footer) is logged under its own name and is on every page: if it's on
    // the page open, undo it right here.
    const blockId = e.id.split('.')[0];
    if (model.page.name !== e.page && !model.blocks.some(b => b.id === blockId && b.canvasSet)) { await openPage(page, e.page); model = await readModel(page); }
    const isSection = !e.id.includes('.');
    const now = isSection ? model.blocks.find(b => b.id === e.id) : findEl(model, e.id);
    // Only undo values that are still what this run left behind.
    const still = now && Object.keys(e.undo).every(k => isSection
      ? now.mobile.h === e.after.mobile.h
      : (k === 'size' ? textSize(now, model.theme) : now.mobile[k]) === (k === 'size' ? e.after.mobile.size : e.after.mobile[k]));
    if (!still) { skipped++; console.log(`  skipped ${e.id} (${e.page}): changed since, left as is`); continue; }
    await say(page, `Restoring ${e.note.split(' (')[0]}`);
    model = isSection
      ? await setSectionHeight(page, model, e.id, e.undo.sectionH, `restore ${run}`)
      : await applyMobile(page, model, e.id, e.undo, `restore ${run}`);
  }
  const msg = `Restored ${todo.length - skipped} change(s) from run ${run}${skipped ? `, skipped ${skipped}` : ''}.`;
  console.log(msg);
  await say(page, msg);
}

module.exports = { runs };
if (require.main === module) process.argv[2] ? require('./connect').run(main) : list(); // listing needs no browser
