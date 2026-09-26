/**
 * verify-program-delivery.mjs — build check for Step 8 (in-app program delivery).
 *
 * Run:  node verify-program-delivery.mjs
 * Exits 1 on any failure, and on a missing file, so it can gate a deploy.
 *
 * It checks two different things, because each catches a different mistake:
 *   STRUCTURE  — app.jsx no longer reads slot metadata off the compiled file.
 *                A reintroduced direct read is the regression that brings back
 *                the silent divergence between a delivered and a compiled block.
 *   BEHAVIOUR  — the real engine resolves a delivered programme that introduces
 *                a slot this bundle never compiled, without throwing.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const need = (path) => {
  if (!existsSync(path)) { console.error(`\nMISSING FILE: ${path}`); process.exit(1); }
  return readFileSync(path, "utf8");
};

const appSrc     = need("src/app.jsx");
const schemaSrc  = need("src/core/program-schema.js");
const programsSrc = need("src/core/programs.js");

/* ------------------------------- STRUCTURE -------------------------------- */
console.log("\nSTRUCTURE — app.jsx reads metadata off PROGRAM, not the compiled file");

// Strip comments so a mention of a name in prose is not mistaken for a read.
const code = appSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

for (const name of ["SLOT_META", "SLOT_OPTIONS", "BLOCKS", "MOBILITY"]) {
  const hits = (code.match(new RegExp(`\\b${name}\\b`, "g")) || []).length;
  ok(`no reference to compiled ${name}`, hits === 0, `${hits} found`);
}
ok("imports the defended accessors",
   /from\s+"\.\/core\/program-schema\.js"/.test(code));
for (const fn of ["blocksFor", "slotMetaFor", "slotOptionsFor"]) {
  ok(`uses ${fn}`, new RegExp(`\\b${fn}\\s*\\(`).test(code));
}
ok("day detail derives meta via slotMetaFor",
   /const meta = slotMetaFor\(PROGRAM, slotName\)/.test(code));
ok("day detail derives block via blocksFor",
   /blocksFor\(PROGRAM, slotName\)\[value\]/.test(code));
ok("the Change picker cannot throw on an unknown slot",
   /slotOptionsFor\(PROGRAM, slotName\)\.map/.test(code));

console.log("\nSTRUCTURE — program-schema.js exposes the contract");
for (const sym of ["SCHEMA_VERSION", "validate", "resolveForDate",
                   "slotMetaFor", "slotOptionsFor", "blocksFor", "mobilityFor"]) {
  ok(`exports ${sym}`, new RegExp(`export (const|function)\\s+${sym}\\b`).test(schemaSrc));
}

console.log("\nSTRUCTURE — delivery is wired in, and guarded");

// The programme must be resolved once, synchronously, from cache.
ok("app.jsx aliases the compiled programme",
   /PROGRAM as COMPILED_PROGRAM/.test(code));
ok("app.jsx resolves the active programme at startup",
   /activeProgramAtStartup\(\s*COMPILED_PROGRAM/.test(code));
ok("PROGRAM is bound from that result",
   /const PROGRAM = PROGRAM_SOURCE\.program/.test(code));
ok("app.jsx refreshes after sign-in", /refreshPrograms\(/.test(code));

// THE guard. In the coach's own app an unfiltered query returns every client's
// programme, and from 2026-09-28 the most recent one is Ville's. Proved in SQL
// on 26 Sep 2026. If this check ever fails, the coach's app can load a client's
// programme, so it is worth failing the build over.
ok("the programs query filters by assigned_to",
   /\.eq\(\s*["']assigned_to["']/.test(programsSrc));
ok("rows are re-checked against the signed-in user",
   /row\.assigned_to !== userId/.test(programsSrc));
ok("rows are re-checked against this app's client",
   /def\.clientName !== clientName/.test(programsSrc));
ok("a delivered definition is validated before use",
   /validate\(def\)/.test(programsSrc));
ok("the cache is stamped with its owner",
   /cached\.userId !== userId/.test(programsSrc));
for (const sym of ["activeProgramAtStartup", "refreshPrograms", "cachedRows",
                   "pickActive", "selectRows", "readCache", "writeCache", "clearCache"]) {
  ok(`programs.js exports ${sym}`, new RegExp(`export (async )?function\\s+${sym}\\b`).test(programsSrc));
}
// supabase.js must NOT be imported at the top of programs.js: it pulls in
// config.jsx, which node cannot parse, and would make this check impossible.
ok("programs.js keeps supabase.js out of its top-level imports",
   !/^import[^;]*["']\.\/supabase\.js["']/m.test(programsSrc));

/* ------------------------------- BEHAVIOUR -------------------------------- */
console.log("\nBEHAVIOUR — against the live engine");

const { validate, SCHEMA_VERSION, slotMetaFor, slotOptionsFor, blocksFor, resolveForDate }
  = await import("./src/core/program-schema.js");
const { resolveSchedule, buildSections } = await import("./src/core/engine.js");
// Find this repo's own program file. app.jsx is byte-identical across the four
// client repos, so this check must be too — it cannot name a client.
const programFiles = readdirSync("src/core")
  .filter((f) => /^program-.*\.js$/.test(f) && f !== "program-schema.js");
if (programFiles.length !== 1) {
  console.error(`\nEXPECTED exactly one src/core/program-*.js, found: ${programFiles.join(", ") || "none"}`);
  process.exit(1);
}
const CLIENT = programFiles[0].replace(/^program-|\.js$/g, "");
console.log(`  (client: ${CLIENT})`);
const PROGRAM = (await import(`./src/core/${programFiles[0]}`)).default;

ok("compiled programme is schemaVersion " + SCHEMA_VERSION, PROGRAM.schemaVersion === SCHEMA_VERSION);
const base = validate(PROGRAM);
ok("compiled programme validates", base.ok, base.errors.join("; "));

// Walk forward from the programme's start until a day with a scheduled slot
// turns up. Which weekday that is differs per client, so it is discovered, not
// assumed — Joonatan has one slot, Ville has four.
const searchStart = typeof PROGRAM.startDate === "string"
  ? new Date(PROGRAM.startDate + "T00:00:00")
  : new Date(2026, 8, 1);
let mon = null, resolved = null, busySlot = null;
for (let i = 0; i < 28 && !busySlot; i++) {
  const d = new Date(searchStart); d.setDate(d.getDate() + i);
  const info = resolveSchedule(d, "auto", {}, PROGRAM);
  const hit = PROGRAM.slots.find((sl) => info.slots[sl]);
  if (hit) { mon = d; resolved = info; busySlot = hit; }
}
ok("engine resolves a scheduled day within 28 days of the start",
   Boolean(busySlot), "no scheduled day found");
if (busySlot) {
  const blk = blocksFor(PROGRAM, busySlot)[resolved.slots[busySlot]];
  ok("block resolves through blocksFor", blk && typeof blk.label === "string",
     `${busySlot}=${resolved.slots[busySlot]}`);
}
// buildSections(date, opts, program) — it resolves the schedule itself.
const sections = buildSections(mon || searchStart, { weekType: "auto", overrides: {} }, PROGRAM);
ok("buildSections runs on the compiled programme", Array.isArray(sections) && sections.length > 0,
   `got ${typeof sections} len=${sections && sections.length}`);
ok("the scheduled block appears in the built sections",
   busySlot ? JSON.stringify(sections).includes(blocksFor(PROGRAM, busySlot)[resolved.slots[busySlot]].label) : false,
   sections.map((x) => x.key).join(","));

// The winter-programme case: a delivered definition adds a slot this bundle has
// never compiled. Before Step 8 this was a white screen on the Calendar.
console.log("\nBEHAVIOUR — a delivered slot the bundle never compiled");
{
  const winter = JSON.parse(JSON.stringify(PROGRAM));
  if (winter.slots.includes("ski")) { console.error("fixture clash: client already has a ski slot"); process.exit(1); }
  winter.slots = [...winter.slots, "ski"];
  winter.blocks.ski = { classic: { label: "Classic ski", exercises: [] } };
  winter.slotMeta.ski = { label: "Ski", color: "#7FB8D4" };
  winter.slotOptions.ski = [{ value: null, label: "None" }, { value: "classic", label: "Classic" }];
  for (const wk of ["A", "B"]) {
    winter.schedule[wk]["3"] = { ...(winter.schedule[wk]["3"] || {}), ski: "classic" };
  }

  const full = validate(winter);
  ok("a complete winter definition validates", full.ok, full.errors.join("; "));

  const wed = new Date(2026, 11, 2);   // a Wednesday
  const r = resolveSchedule(wed, "auto", {}, winter);
  ok("engine resolves the new slot", r.slots.ski === "classic", JSON.stringify(r.slots));
  const winterSections = buildSections(wed, { weekType: "auto", overrides: {} }, winter);
  ok("buildSections renders a day containing the new slot",
     Array.isArray(winterSections) && winterSections.length > 0,
     `len=${winterSections && winterSections.length}`);

  // Now the failure case: metadata missing, as it would be mid-deploy.
  const missing = JSON.parse(JSON.stringify(winter));
  delete missing.slotMeta.ski;
  delete missing.slotOptions.ski;
  const bad = validate(missing);
  ok("an incomplete definition is REJECTED by validate", !bad.ok);
  ok("rejection names slotMeta.ski", bad.errors.some((e) => /slotMeta\.ski/.test(e)));

  // And the second line of defence: even unvalidated, rendering must not throw.
  let threw = null;
  try {
    for (const slot of missing.slots) {
      const meta = slotMetaFor(missing, slot);
      void meta.cat;                                   // the old crash
      void meta.label.toLowerCase();
      void meta.color;
      void slotOptionsFor(missing, slot).map((o) => o.label);
      void blocksFor(missing, slot)["classic"];
    }
  } catch (err) { threw = err; }
  ok("accessors survive the rejected definition", threw === null, threw && threw.message);
}

console.log("\nBEHAVIOUR — version in force on a date");
{
  const rows = [
    { id: "b1", effective_from: "2026-09-28" },
    { id: "b2", effective_from: "2026-11-16" },
  ];
  ok("mid-block-1 scores against b1", resolveForDate(rows, "2026-10-20").id === "b1");
  ok("block-2 start scores against b2", resolveForDate(rows, "2026-11-16").id === "b2");
  ok("a day before any version has none", resolveForDate(rows, "2026-09-01") === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
