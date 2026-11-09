// Fix mobile issues found by audit.js, typing into Showit's own fields.
//   node fix.js [--page "About" | --all]           tour: cursor shows each fix, edits nothing
//   node fix.js [--page "About" | --all] --apply   make the edits (undo with: node restore.js); sections a
//                                                   patch can't fix are rebuilt from desktop (--no-rebuild: don't)
// Shared sections (Header/Footer) are done last on a page; a change there applies to every page.
const { audit, readModel, textSize } = require('./audit');
const { rebuild } = require('./rebuild');
const { FIELD, RUN, eachPage, toPage, select, findEl, applyMobile, setSectionHeight, say, log, readLog } = require('./editor');

const key = i => i.id + JSON.stringify(i.fix);
// Plain-language reason for a failed edit (the raw error is logged too, for debugging).
const reason = e => {
  const m = e.message;
  if (e.name === 'TimeoutError') return "Showit didn't respond in time";
  if (/could not select/.test(m)) return "Showit wouldn't let the tool select it (grouped, hidden or covered)";
  if (/not found in/.test(m)) return "Showit didn't show the field needed to change it";
  if (/is disabled in/.test(m)) return "Showit doesn't allow changing that here (a group's size, for example)";
  if (/locked/.test(m)) return 'it is locked in Showit';
  if (/expected mobile value/.test(m)) return 'Showit showed a different value than expected, so nothing was typed';
  if (/check failed/.test(m)) return "the change didn't take or touched desktop, so it was undone";
  return m.split('\n')[0];
};
// Report-only problems in one section (overlaps, spills...), as comparable strings.
const problems = (model, blockId) => audit(model).filter(x => !x.fix && x.id.split('.')[0] === blockId)
  .map(x => `${x.what}: ${x.problem.split(' (')[0]}`);

async function main(page) {
  const apply = process.argv.includes('--apply');
  let done = 0, failed = 0, rebuilt = 0;
  for await (const name of eachPage(page)) {
    // Fixes that made things worse (this run or an earlier one) aren't retried.
    const reverted = new Set(readLog().filter(e => e.skip).map(e => e.skip));
    const passes = async () => {
      // Several passes: a fix can reveal the next (widen first, then grow height if still wrapping).
      for (let pass = 1; pass <= (apply ? 6 : 1); pass++) {
        if (pass > 1) await toPage(page); // shared-section edits leave "Main Site" open
        let model = await readModel(page);
        const seen = new Set();
        const issues = audit(model).filter(i => i.fix && !reverted.has(key(i)) && !seen.has(i.id) && seen.add(i.id))
          .sort((a, b) => a.shared - b.shared);
        if (!issues.length) break;
        console.log(`\n${name}, pass ${pass}: ${issues.length} fix(es) ${apply ? 'to apply' : 'planned (tour only; add --apply to edit)'}`);
        for (const i of issues) {
          const { also = [], ...main } = i.fix;
          const plan = Object.entries(main).map(([k, v]) => `${FIELD[k]?.[1] ?? 'section height'} ${v}`).join(', ')
            + (also.length ? ` (+${also.length} aligned element(s) moved with it)` : '');
          console.log(`- ${i.block}${i.shared ? ' (shared, all pages)' : ''}: ${i.what}: ${i.problem} -> ${plan}`);
          await say(page, `${i.problem.split(' (')[0]}. ${apply ? 'Fixing' : 'Would set'}: ${plan}`);
          if (!apply) { await select(page, i.id); await page.waitForTimeout(1800); continue; }
          const blockId = i.id.split('.')[0];
          try {
            const before = new Set(problems(model, blockId));
            let undo;
            if (main.sectionH) {
              const prevH = model.blocks.find(b => b.id === blockId).mobile.h;
              model = await setSectionHeight(page, model, blockId, main.sectionH, i.problem);
              undo = async why => { model = await setSectionHeight(page, model, blockId, prevH, why); };
            } else {
              // The element plus any aligned siblings, applied as one change and undone as one.
              const group = [{ id: i.id, fix: main }, ...also];
              const prev = group.map(g => {
                const el = findEl(model, g.id);
                return { id: g.id, fix: Object.fromEntries(Object.keys(g.fix).map(k => [k, k === 'size' ? textSize(el, model.theme) : el.mobile[k]])) };
              });
              for (const g of group) model = await applyMobile(page, model, g.id, g.fix, i.problem);
              undo = async why => { for (const p of prev.reverse()) model = await applyMobile(page, model, p.id, p.fix, why); };
            }
            // Never make it worse: a fix that creates a new overlap etc. in its section is undone.
            const worse = problems(model, blockId).filter(p => !before.has(p));
            if (worse.length) {
              await undo(`revert: ${worse[0]}`);
              reverted.add(key(i));
              log({ page: name, id: i.id, note: 'skip next time', skip: key(i) });
              console.log(`  reverted, it caused: ${worse.join('; ')}. Left for a human.`);
              continue;
            }
            done++;
            console.log('  ok');
          } catch (e) {
            // One element Showit won't let us edit (hidden, grouped, odd panel...) must not end the run.
            if (/Stopped by you/.test(e.message)) throw e;
            failed++;
            reverted.add(key(i));
            const why = reason(e);
            log({ page: name, id: i.id, note: `skip next time: ${why}`, skip: key(i), error: e.message.split('\n')[0] });
            console.log(`  could not edit it (${why}). Left for a human.`);
            await page.keyboard.press('Escape').catch(() => {});
            await toPage(page).catch(() => {});
            model = await readModel(page);
          }
        }
      }
    };
    await passes();
    if (!apply || process.argv.includes('--no-rebuild')) continue;
    // What a patch can't sort out (text on text, elements Showit won't let us edit, layouts that need
    // reflowing) gets that section laid out again from its desktop design, then patched once more.
    await toPage(page);
    let model = await readModel(page);
    const was = rebuilt;
    const stuck = [...new Set(audit(model)
      .filter(i => (!i.fix || reverted.has(key(i))) && !/intentional|locked/.test(i.problem))
      .map(i => i.id.split('.')[0]))];
    for (const id of stuck) {
      const block = model.blocks.find(b => b.id === id);
      // A header floating over the page (height ~0) holds the menu: too easy to break, report instead.
      if (!block || (block.canvasSet && block.mobile?.h <= 1)) continue;
      try {
        model = await rebuild(page, model, block, true);
        rebuilt++;
      } catch (e) {
        if (/Stopped by you/.test(e.message)) throw e;
        failed++;
        console.log(`  could not rebuild ${block.name.trim()} (${reason(e)}). Left for a human.`);
        log({ page: name, id: block.id, note: `rebuild failed: ${reason(e)}`, error: e.message.split('\n')[0] });
        await page.keyboard.press('Escape').catch(() => {});
        await toPage(page).catch(() => {});
        model = await readModel(page);
      }
    }
    if (rebuilt > was) await passes();
  }
  const left = failed ? ` ${failed} couldn't be edited, see Issues.` : '';
  const re = rebuilt ? ` ${rebuilt} section(s) laid out again.` : '';
  const msg = apply ? (done || rebuilt ? `Done: ${done} fix(es) applied.${re}${left} Undo with: node restore.js ${RUN}` : failed ? `Nothing fixed.${left}` : 'Nothing to fix on mobile.') : 'Tour done.';
  console.log(`\n${msg}`);
  await say(page, msg.split(' Undo')[0]);
}

if (require.main === module) require('./connect').run(main);
