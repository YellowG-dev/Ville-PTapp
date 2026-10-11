/**
 * test-wearable-results.mjs — one tick per cardio session, result fields from the watch.
 *
 * Run:  node test-wearable-results.mjs     (plain node, no network)
 *
 * Covers the validator rules for block.cardio.{distance,hrAvg,hrMax}TaskId,
 * result fields excluded from the count, the single session tick (confirmed
 * from a watch OR a typed duration, manual un-tick wins), resultWritesFromWorkout,
 * the strength OK as a non-cardio activity on its block, and weeklyCardioMinutes
 * staying unchanged. Identical across the repos; uses its own small programme.
 */
import assert from "node:assert/strict";
import { validate } from "./src/core/program-schema.js";
import { buildSections, countableTasks, isTaskDone, buildHistoryRows, resolveSchedule } from "./src/core/engine.js";
import { activityFromWorkout, resultWritesFromWorkout, sessionTaskIdFor, weeklyCardioMinutes, isCardioActivity } from "./src/core/cardio.js";

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (err) { fail++; console.log(`  FAIL ${name}\n       ${err.message.split("\n")[0]}`); }
};
const clone = (o) => JSON.parse(JSON.stringify(o));

const RUN = {
  label: "Run — Long", cat: "run",
  cardio: { durationTaskId: "run-min", distanceTaskId: "run-dist", hrAvgTaskId: "run-hr-avg", hrMaxTaskId: "run-hr-max" },
  exercises: [
    { id: "run-long", name: "Long run", presc: "easy", sets: null },
    { id: "run-min", name: "Duration", type: "number", unit: "min" },
    { id: "run-dist", name: "Distance", type: "number", unit: "km" },
    { id: "run-hr-avg", name: "Avg HR", type: "number", unit: "bpm" },
    { id: "run-hr-max", name: "Max HR", type: "number", unit: "bpm" },
  ],
};
const PROG = {
  id: "t", clientName: "T", slots: ["run", "strength"],
  blocks: { run: { long: RUN }, strength: { c: { label: "Strength C", cat: "strength", exercises: [{ id: "sq", name: "Squat", presc: "3x8", sets: 3 }] } } },
  schedule: { A: { 0: { run: "long", strength: "c" }, 1: { run: "long", strength: "c" }, 2: { run: "long", strength: "c" }, 3: { run: "long", strength: "c" },
                   4: { run: "long", strength: "c" }, 5: { run: "long", strength: "c" }, 6: { run: "long", strength: "c" } }, B: null },
  daily: [], tracking: {}, restLabel: "Rest",
  slotMeta: { run: { label: "Run", color: "#4CB6C4" }, strength: { label: "Strength", color: "#112233" } },
  slotOptions: { run: [{ value: null, label: "None" }, { value: "long", label: "Long" }], strength: [{ value: null, label: "None" }, { value: "c", label: "C" }] },
};
// weekType "A" is forced below so the test does not depend on the ISO week parity.
PROG.schedule.B = PROG.schedule.A; // weeklyCardioMinutes picks the week type itself
const D = new Date(2026, 9, 7); // Wed 7 Oct 2026
const secs = (rec) => buildSections(D, { weekType: "A", record: rec }, PROG);
const runTasks = (rec) => secs(rec).find((s) => s.key === "run").tasks;

console.log("\nvalidator: result-field task ids");
ok("the test programme validates clean", () => { const r = validate(PROG); assert.equal(r.ok, true, r.errors.join("; ")); });
for (const f of ["distanceTaskId", "hrAvgTaskId", "hrMaxTaskId"]) {
  ok(`${f} naming a missing task is an error`, () => {
    const d = clone(PROG); d.blocks.run.long.cardio[f] = "nope";
    const r = validate(d); assert.equal(r.ok, false); assert.ok(r.errors.some((e) => e.includes(f) && e.includes("not the id of a task")));
  });
  ok(`${f} naming a non-number task is an error`, () => {
    const d = clone(PROG); d.blocks.run.long.cardio[f] = "run-long";
    const r = validate(d); assert.equal(r.ok, false); assert.ok(r.errors.some((e) => e.includes(f) && e.includes('type "number"')));
  });
  ok(`${f} that is not a string is an error`, () => {
    const d = clone(PROG); d.blocks.run.long.cardio[f] = 5;
    const r = validate(d); assert.equal(r.ok, false); assert.ok(r.errors.some((e) => e.includes(f) && e.includes("string")));
  });
}

console.log("\nengine: one tick per session");
ok("result fields are flagged and left out of countableTasks", () => {
  const t = countableTasks(secs(null)).map((x) => x.id);
  assert.ok(t.includes("run-long"));
  for (const id of ["run-min", "run-dist", "run-hr-avg", "run-hr-max"]) assert.ok(!t.includes(id), id);
  assert.ok(t.includes("sq"));
});
ok("result fields are still in the section (shown, editable)", () => {
  assert.deepEqual(runTasks(null).map((x) => x.id), ["run-long", "run-min", "run-dist", "run-hr-avg", "run-hr-max"]);
});
ok("nothing logged: the session task is not done", () => {
  const t = runTasks({ done: {} }); assert.equal(isTaskDone(t[0], { done: {} }), false);
});
ok("a typed duration ticks the session task (D17)", () => {
  const rec = { done: {}, numbers: { "run-min": 45 } };
  assert.equal(isTaskDone(runTasks(rec)[0], rec), true);
});
ok("a typed distance alone does not tick it", () => {
  const rec = { done: {}, numbers: { "run-dist": 8 } };
  assert.equal(isTaskDone(runTasks(rec)[0], rec), false);
});
ok("a confirmed session (done flag) ticks it once", () => {
  const rec = { done: { "run-long": true }, numbers: { "run-min": 190, "run-dist": 15.34, "run-hr-avg": 116, "run-hr-max": 158 } };
  const done = countableTasks(secs(rec)).filter((t) => isTaskDone(t, rec) && t.cat !== "x").map((t) => t.id);
  assert.equal(done.filter((id) => id.startsWith("run")).length, 1);
});
ok("a manual un-tick (done = false) beats the derived tick", () => {
  const rec = { done: { "run-long": false }, numbers: { "run-min": 45 } };
  assert.equal(isTaskDone(runTasks(rec)[0], rec), false);
});
ok("buildHistoryRows re-scores a past day: duration only counts as one done, total drops the result fields", () => {
  const log = { "2026-10-07": { done: {}, numbers: { "run-min": 45, "run-dist": 8, "run-hr-avg": 130, "run-hr-max": 150 }, weekType: "A" } };
  const row = buildHistoryRows(log, {}, PROG)[0];
  assert.equal(row.total, 2); assert.equal(row.doneCount, 1);
});
ok("a block with no cardio declaration is untouched", () => {
  const d = clone(PROG); delete d.blocks.run.long.cardio;
  const t = buildSections(D, { weekType: "A" }, d).find((s) => s.key === "run").tasks;
  assert.ok(t.every((x) => !x.resultField && !x.viaTaskId));
});

console.log("\ncardio: resultWritesFromWorkout");
const W = { vendor: "polar", vendor_session_id: "9", sport: "Running", day: "2026-10-07", duration_minutes: 190, distance_km: 15.34, hr_avg: 115.6, hr_max: 158 };
ok("writes all four fields and names the session task", () => {
  const r = resultWritesFromWorkout(RUN, W, null);
  assert.deepEqual(r.numbers, { "run-min": 190, "run-dist": 15.34, "run-hr-avg": 116, "run-hr-max": 158 });
  assert.equal(r.sessionTaskId, "run-long");
});
ok("a value the client typed is kept, field by field", () => {
  const r = resultWritesFromWorkout(RUN, W, { "run-min": 180, "run-hr-max": 160 });
  assert.deepEqual(r.numbers, { "run-dist": 15.34, "run-hr-avg": 116 });
});
ok("fields the watch did not report are skipped", () => {
  const r = resultWritesFromWorkout(RUN, { ...W, distance_km: null, hr_avg: null }, null);
  assert.deepEqual(r.numbers, { "run-min": 190, "run-hr-max": 158 });
});
ok("a block declaring only a duration field writes only duration", () => {
  const b = clone(RUN); b.cardio = { durationTaskId: "run-min" };
  assert.deepEqual(resultWritesFromWorkout(b, W, null).numbers, { "run-min": 190 });
});
ok("sessionTaskIdFor skips number and notes tasks", () => {
  assert.equal(sessionTaskIdFor({ exercises: [{ id: "n", type: "notes" }, { id: "m", type: "number" }, { id: "s" }] }), "s");
  assert.equal(sessionTaskIdFor({ exercises: [{ id: "m", type: "number" }] }), null);
});

console.log("\nstrength / yoga OK recorded on the block");
const SW = { vendor: "oura", vendor_session_id: "abc", sport: "strengthTraining", day: "2026-10-07", duration_minutes: 81, hr_avg: 118, hr_max: 152 };
ok("activityFromWorkout with a placement carries slot + block, duration and HR, kind strength", () => {
  const a = activityFromWorkout(SW, PROG, { slot: "strength", block: "c" });
  assert.equal(a.slot, "strength"); assert.equal(a.block, "c"); assert.equal(a.kind, "strength");
  assert.equal(a.durationMin, 81); assert.equal(a.hrAvg, 118); assert.equal(a.hrMax, 152);
  assert.equal(isCardioActivity(a), false);
});
ok("without a placement the entry has no slot (an extra)", () => {
  assert.equal(activityFromWorkout(SW, PROG).slot, undefined);
});
const ovWith = (a) => ({ "2026-10-07": { activities: [a] } });
ok("resolveSchedule keeps a slot entry out of activities (no Extra Activity section) but in sessions", () => {
  const a = activityFromWorkout(SW, PROG, { slot: "strength", block: "c" });
  const info = resolveSchedule(D, "A", ovWith(a), PROG);
  assert.equal(info.activities.length, 0); assert.equal(info.sessions.length, 1); assert.equal(info.allActivities.length, 1);
  assert.ok(!buildSections(D, { weekType: "A", overrides: ovWith(a) }, PROG).some((s) => s.key === "activity"));
});
ok("a slot entry adds no countable task and no cardio minutes", () => {
  const a = activityFromWorkout(SW, PROG, { slot: "strength", block: "c" });
  const before = countableTasks(buildSections(D, { weekType: "A" }, PROG)).length;
  const after = countableTasks(buildSections(D, { weekType: "A", overrides: ovWith(a) }, PROG)).length;
  assert.equal(before, after);
  const ws = new Date(2026, 9, 5);
  assert.equal(weeklyCardioMinutes(ws, {}, ovWith(a), PROG), 0);
});
ok("weeklyCardioMinutes still reads only the duration field", () => {
  const log = { "2026-10-07": { numbers: { "run-min": 41.9, "run-dist": 9, "run-hr-avg": 120 } } };
  assert.equal(Math.round(weeklyCardioMinutes(new Date(2026, 9, 5), log, {}, PROG) * 10) / 10, 41.9);
});

console.log(`\ntest-wearable-results: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
