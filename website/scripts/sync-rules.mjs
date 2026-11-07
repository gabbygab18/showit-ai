// Copies the app's checking rules (the `// <rules>` parts of ../audit.js) into lib/rules.js, so the
// playground runs exactly the same checks as the app. Runs before dev/build; if ../audit.js isn't
// there (e.g. a host that only uploads this folder), the committed lib/rules.js is kept.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const src = new URL("../../audit.js", import.meta.url);
const out = new URL("../lib/rules.js", import.meta.url);
if (!existsSync(src)) {
  console.log("sync-rules: ../audit.js not found, keeping lib/rules.js");
  process.exit(0);
}
const parts = [...readFileSync(src, "utf8").matchAll(/\/\/ <rules>.*\n([\s\S]*?)\/\/ <\/rules>/g)].map((m) => m[1]);
if (parts.length < 2) throw new Error("sync-rules: no // <rules> regions found in audit.js");
writeFileSync(
  out,
  `// GENERATED from ../audit.js by scripts/sync-rules.mjs. Edit the rules there, not here.\n/* eslint-disable */\n${parts.join("\n")}\nexport { audit, measureInk, MOBILE_W };\n`,
);
console.log(`sync-rules: wrote lib/rules.js (${parts.length} parts)`);
