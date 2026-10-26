// Progress tab: one "Getting stronger" dropdown entry per movement.
// Run: node test-progress-merge.mjs   — MUST end "0 failed".
import { groupLoadKeysByName, computeLoadSeries } from "./src/core/engine.js";

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log("FAIL", msg); } };

// Names as published in Juha's live programme (effective 2026-10-12).
const names = {
  "up-1": "Incline dumbbell press", "fb-1": "Incline dumbbell press",
  "up-6": "Overhead triceps extension", "fb-7": "Overhead triceps extension",
  "up-8": "Weighted crunch", "lo-8": "Weighted crunch", "fb-5": "Weighted crunch",
  "lo-11": "Standing calf raise", "calf-seated": "Seated calf raise",
  "curl-ezbar": "Ez-bar curl", "db-bench": "Dumbbell bench press",
};
const nameFor = (id) => names[id] || id;

// Real load keys from Juha's day_logs (subset covering every merge case).
const keys = [
  "up-1", "fb-1", "up-6", "fb-7", "press-closegrip-db::overhead-triceps-extension",
  "up-8", "lo-8", "fb-5", "lo-11", "calf-seated::standing-calf-raise",
  "calf-seated", "fb-8::seated-calf-raise", "curl-ezbar", "fb-6::ez-bar-curl",
  "curl-ezbar::cable-curl", "curl-incline-db::cable-curl", "db-bench",
];
const groups = groupLoadKeysByName(keys, nameFor);
const by = Object.fromEntries(groups.map((g) => [g.name, g.keys]));

ok(groups.length === 8, `8 movements expected, got ${groups.length}: ${groups.map((g) => g.name)}`);
ok(new Set(groups.map((g) => g.name)).size === groups.length, "no duplicate names in dropdown");
ok(by["Incline dumbbell press"]?.length === 2, "up-1 + fb-1 merged");
ok(by["Overhead triceps extension"]?.length === 3, "triceps: two slots + swap merged");
ok(by["Weighted crunch"]?.length === 3, "crunch: three slots merged");
ok(by["Standing calf raise"]?.length === 2, "calf swap merged with lo-11");
ok(by["Seated calf raise"]?.length === 2, "seated calf + swap merged");
ok(by["Ez-bar curl"]?.length === 2, "programme spelling wins over swap slug 'Ez bar curl'");
ok(by["Cable curl"]?.length === 2, "two swaps of the same lift merged");
ok(by["Dumbbell bench press"]?.length === 1, "single-key movement untouched");
ok(groups.every((g, i) => i === 0 || groups[i - 1].name.localeCompare(g.name) <= 0), "sorted by name");

// Series across merged keys: a date appears once, at its heaviest set.
const log = {
  "2026-09-06": { loads: { "fb-1": [{ w: 20, r: 10 }] } },
  "2026-09-10": { loads: { "up-1": [{ w: 22, r: 8 }, { w: 24, r: 6 }] } },
  "2026-09-12": { loads: { "up-1": [{ w: 24 }], "fb-1": [{ w: 26 }] } },
  "2026-09-14": { loads: { "up-1": [{ w: null, r: 8 }] } },
  "2026-09-16": { loads: { "up-1": [18] } }, // legacy numeric entry
};
const s = computeLoadSeries(log, ["up-1", "fb-1"], "2099-01-01");
ok(s.length === 4, `4 dated points expected, got ${s.length}`);
ok(s.map((p) => p.maxWeight).join() === "20,24,26,18", `heaviest per day, got ${s.map((p) => p.maxWeight)}`);
ok(computeLoadSeries(log, "up-1", "2099-01-01").length === 3, "single string id still works (back-compat)");
ok(computeLoadSeries(log, ["up-1", "fb-1"], "2026-09-12").length === 3, "today excluded");

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
