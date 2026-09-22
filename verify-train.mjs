// Train tab verification — run: node verify-train.mjs
//
// Needs no node_modules. Reads src/app.jsx as TEXT, same as verify-theme.mjs,
// so it runs in any of the three client repos unchanged.
//
// What it guards (Step 5, Phases 1-2):
//   1. Rules of Hooks in AppInner. Every hook call must sit ABOVE the
//      `if (loading)` early return. A hook below it registers on the second
//      render but not the first, and React unmounts the whole tree — the exact
//      failure that blanked the coach app in Phase 6. The client repos had no
//      check for this until now.
//   2. The Train tab is wired: tab entry, view branches, compact Today card.
//   3. The ring is untouched: `countable` is still built from ALL sections.
//      The Train tab is render-only by owner decision (21 Sep 2026); if the
//      ring's task list ever changes, every historical percentage and the
//      coach's adherence figures change with it.
//
// The mount-level evidence (old vs new rendered side by side in jsdom on real
// data) lives outside the repo because it needs jsdom and real client logs,
// and these repos are public. This file is the part that can live here.

import fs from "fs";

const src = fs.readFileSync("./src/app.jsx", "utf8");
let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? `\n        ${detail}` : ""}`);
}

/* ----------------------------- 1. hook order ------------------------------ */

console.log("--- Rules of Hooks: AppInner ---");
const start = src.indexOf("function AppInner(");
const next = src.indexOf("\nfunction ", start + 1);
ok("AppInner found", start !== -1 && next !== -1);
const body = src.slice(start, next);
const earlyReturn = body.search(/\n  if \(loading\) \{/);
ok("AppInner has its `if (loading)` early return", earlyReturn !== -1);

// Strip comments and string literals so a word like "useMemo(" in a comment
// cannot produce a false result either way.
const code = body
  .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
  .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
  .replace(/"(?:\\.|[^"\\\n])*"/g, (m) => '"' + " ".repeat(m.length - 2) + '"');
const HOOK = /\b(useState|useEffect|useMemo|useCallback|useRef|useContext|useTheme|useLayoutEffect|useReducer)\s*\(/g;
const hooks = [...code.matchAll(HOOK)];
const below = hooks.filter((m) => m.index > earlyReturn);
ok(`all ${hooks.length} hook calls in AppInner sit above the early return`, below.length === 0,
   below.map((m) => `${m[1]} at line ${src.slice(0, start + m.index).split("\n").length}`).join(", "));
ok("scanner actually found hooks (guards against a regex that matches nothing)", hooks.length >= 30,
   `found ${hooks.length}`);

/* ------------------------------ 2. wiring --------------------------------- */

console.log("\n--- Train tab wiring ---");
ok("tab list has Today, Train, Calendar, Progress, Program in that order",
   src.includes('[["today", "Today"], ["train", "Train"], ["calendar", "Calendar"], ["history", "Progress"], ["program", "Program"]]'));
ok("Train sections are the Today sections filtered to strength (one definition of a session)",
   src.includes('const trainSections = useMemo(() => sections.filter((s) => s.cat === "strength"), [sections]);'));
ok("Train forces sections open", src.includes("const isOpen = inTrain || ("));
ok("Train forces exercises open", src.includes("const open = inTrain || Boolean(expanded[task.id]);"));
ok("Today renders strength as a compact card with Open in Train",
   src.includes('if (!inTrain && section.cat === "strength")') && src.includes("Open in Train"));
ok("empty state points at the next strength session", src.includes("Go to that day") && src.includes("nextStrength"));
ok("Train uses the same day navigation as Today", src.includes('{view === "today" || view === "train" ? ('));

/* --------------------------- 3. ring untouched ---------------------------- */

console.log("\n--- auto-tick (Phase 2) ---");
ok("both set inputs pass today's set count to commitLoad",
   src.includes('commitLoad(lk, si, "w", e.target.value, count)') && src.includes('commitLoad(lk, si, "r", e.target.value, count)'));
ok("auto-tick fires on the incomplete -> complete transition only (manual un-tick respected)",
   src.includes("if (!complete(before) && complete(arr)) next.done = { ...r.done, [exId]: true };"));
ok("a set counts as logged by its reps (bodyweight sets carry no weight)",
   src.includes("every((_, i) => a[i]?.r != null)"));
ok("swapped exercises are skipped", src.includes('!exId.includes("::")'));
ok("auto-tick only ever writes true, never un-ticks", !/next\.done = \{[^}]*\]: false/.test(src));

console.log("\n--- completion ring ---");
ok("ring still counts every section (render-only change)",
   src.includes("const countable = useMemo(() => countableTasks(sections), [sections]);"));
ok("ring percentage formula unchanged",
   src.includes("const pct = countable.length ? doneCount / countable.length : 0;"));

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
