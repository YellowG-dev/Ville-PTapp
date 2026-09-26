// verify-start.mjs — program.startDate checks. Run: node verify-start.mjs
import fs from "fs";
process.on("uncaughtException", (e) => { console.log("FAIL (crash): " + e.message); process.exit(1); });
const { resolveSchedule } = await import("./src/core/engine.js");
// program-schema.js also matches /^program-.*\.js$/, and sorts before a client
// file whose name starts past "s" (program-ville.js), so without this guard the
// schema is imported instead of the programme and P.startDate throws.
const progFile = fs.readdirSync("./src/core").find((f) => /^program-.*\.js$/.test(f) && f !== "program-schema.js");
const P = (await import(`./src/core/${progFile}`)).default;
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "ok   " : "FAIL ") + n); };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const days = (from, n) => Array.from({ length: n }, (_, i) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + i));

const src = fs.readFileSync("./src/core/engine.js", "utf8");
check("engine reads program.startDate", src.includes("program.startDate"));

// 1. This repo's program: every day still matches its weekly template (after startDate if it has one).
let mism = 0;
for (const d of days(new Date(2026, 0, 1), 500)) {
  if (P.startDate && iso(d) < P.startDate) continue;
  const r = resolveSchedule(d, "auto", {}, P);
  const base = (P.schedule[r.weekType] || {})[d.getDay()] || {};
  for (const s of P.slots) if (r.slots[s] !== (base[s] || null)) mism++;
}
check(`${progFile}: 500 days match the weekly template`, mism === 0);

// 2. With a start date: empty before, template from the start day, overrides still work.
const T = { ...P, startDate: "2026-09-28" };
const before = days(new Date(2026, 8, 14), 14).every((d) => T.slots.every((s) => resolveSchedule(d, "auto", {}, T).slots[s] === null));
check("startDate: the two weeks before are empty", before);
const after = days(new Date(2026, 8, 28), 14).every((d) => { const r = resolveSchedule(d, "auto", {}, T); const b = (T.schedule[r.weekType] || {})[d.getDay()] || {}; return T.slots.every((s) => r.slots[s] === (b[s] || null)); });
check("startDate: from the start day the template applies", after);
const s0 = T.slots[0];
const anyVal = Object.values(T.blocks[s0])[0] && Object.keys(T.blocks[s0])[0];
const ov = { "2026-09-20": { [s0]: anyVal } };
check("startDate: a Calendar override before the start still shows", resolveSchedule(new Date(2026, 8, 20), "auto", ov, T).slots[s0] === anyVal);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
