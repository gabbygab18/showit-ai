// Layout dataset for measuring the rules (read-only on the site).
//   node dataset.js --site luce [--page "About" | --all]   save each page's model (sections, elements, measured text)
//                                               to test/fixtures/<site>--<page>.json (in the app: <data>/layout-data,
//                                               for clients to send in)
// eval.js replays the rules on these files, plus broken copies of them, and scores the results.
const fs = require('fs');
const path = require('path');
const { readModel } = require('./audit');

const DATA = process.env.SHOWIT_AI_DATA;
const DIR = DATA && path.resolve(DATA) !== path.resolve(__dirname) ? path.join(DATA, 'layout-data') : path.join(__dirname, 'test', 'fixtures');
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main(page) {
  const { eachPage } = require('./editor');
  fs.mkdirSync(DIR, { recursive: true });
  const at = process.argv.indexOf('--site');
  const site = slug(at > 0 ? process.argv[at + 1] : 'site');
  for await (const name of eachPage(page)) {
    const m = await readModel(page);
    // Keep what the rules read; drop the editor's selection state.
    for (const b of m.blocks) for (const e of b.elements || []) delete e.selected;
    const file = path.join(DIR, `${site}--${slug(name)}.json`);
    fs.writeFileSync(file, JSON.stringify({ site, page: name, captured: new Date().toISOString(), ...m }));
    console.log(`saved ${path.relative(__dirname, file)} (${m.blocks.length} sections)`);
  }
}

if (require.main === module) require('./connect').run(main);
