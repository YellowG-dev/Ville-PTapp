/**
 * test-cardio-client.mjs — Step 9 Phase 5: cardio in the client apps.
 *
 * Run:  node test-cardio-client.mjs      (plain node, no network, no browser)
 *
 * Covers the D1 engine change (extras survive a skip day, a skip day is still
 * not a training day), and the data shapes the client UI writes when a wearable
 * workout is confirmed or dismissed. The UI itself lives in app.jsx and cannot
 * be imported under node, so these checks apply the same writes the UI makes
 * and read them back through the shared logic. Identical across the four
 * client repos.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { resolveSchedule, buildSections } from "./src/core/engine.js";
import { matchDay, weeklyCardioMinutes, activityFromWorkout } from "./src/core/cardio.js";

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (err) { fail++; console.log(`  FAIL ${name}\n       ${err.message.split("\n")[0]}`); }
};

// 2026-10-05 is a Monday. Both week types run on Monday so the test does not
// depend on which ISO week parity it falls in.
const MON = new Date(2026, 9, 5);
const DAY = "2026-10-05";
const PROGRAM = {
  id: "t", clientName: "T", slots: ["run", "strength"],
  cardioTypes: [{ id: "run", label: "Run", sports: ["running"], slot: "run" }, { id: "bike", label: "Cycling", sports: ["cycling"] }],
  hrZones: [{ id: "z2", label: "Zone 2", pctMin: 60, pctMax: 70 }],
  blocks: {
    run: { easy: { label: "Run — Easy", exercises: [{ id: "run-dur", name: "Run duration", type: "number", unit: "min" }], cardio: { durationMin: 40, zoneAvg: "z2", durationTaskId: "run-dur" } } },
    strength: { a: { label: "Session A", cat: "strength", exercises: [] } },
  },
  schedule: { A: { 1: { run: "easy", strength: null } }, B: { 1: { run: "easy", strength: null } } },
  daily: [], tracking: {},
  slotMeta: {}, slotOptions: {},
};
const run = (id, over = {}) => ({ vendor: "polar", vendor_session_id: id, day: DAY, sport: "running", started_at: `${DAY}T07:00:00Z`, duration_minutes: 42, distance_km: 7, hr_avg: 150, hr_max: 170, ...over });
const bike = (id) => run(id, { sport: "cycling", started_at: `${DAY}T17:00:00Z`, duration_minutes: 60 });
const legacy = { id: "1", name: "Walk" };

console.log("\nD1: extras on a skip day");

ok("skip day with an extra: activities returned, slots null, not a training day", () => {
  const info = resolveSchedule(MON, "auto", { [DAY]: { skip: "sick", activities: [legacy] } }, PROGRAM);
  assert.equal(info.activities.length, 1);
  assert.equal(info.slots.run, null);
  assert.equal(info.scheduled.run, "easy");
  assert.equal(info.isTrainingDay, false);
});
ok("skip day, no extras: unchanged (nothing returned, not a training day)", () => {
  const info = resolveSchedule(MON, "auto", { [DAY]: { skip: "sick" } }, PROGRAM);
  assert.deepEqual(info.activities, []);
  assert.equal(info.isTrainingDay, false);
});
ok("same day without a skip: scheduled run and extra both make it a training day", () => {
  const info = resolveSchedule(MON, "auto", { [DAY]: { activities: [legacy] } }, PROGRAM);
  assert.equal(info.slots.run, "easy");
  assert.equal(info.isTrainingDay, true);
});
ok("an extra alone still makes a no-skip rest day a training day (as before)", () => {
  const info = resolveSchedule(MON, "auto", { [DAY]: { run: null, activities: [legacy] } }, PROGRAM);
  assert.equal(info.isTrainingDay, true);
});
ok("buildSections on a skip day: skip notice, Extra Activity section, no rest section", () => {
  const sections = buildSections(MON, { overrides: { [DAY]: { skip: "sick", activities: [legacy] } } }, PROGRAM);
  const keys = sections.map((s) => s.key);
  assert.ok(keys.includes("skip") && keys.includes("activity"));
  assert.ok(!keys.includes("rest") && !keys.includes("run"));
});
ok("the skip notice counts scheduled slots only, not extras", () => {
  const sections = buildSections(MON, { overrides: { [DAY]: { skip: "sick", activities: [legacy, { id: "2", name: "Swim" }] } } }, PROGRAM);
  assert.match(sections.find((s) => s.key === "skip").subtitle, /1 session removed/);
});
ok("weekly total counts a skip-day extra exactly once", () => {
  const ov = { [DAY]: { skip: "sick", activities: [{ id: "x", name: "Walk", durationMin: 30 }] } };
  assert.equal(weeklyCardioMinutes(MON, {}, ov, PROGRAM), 30);
});
ok("a legacy {id, name} entry counts 0 minutes", () => {
  assert.equal(weeklyCardioMinutes(MON, {}, { [DAY]: { activities: [legacy] } }, PROGRAM), 0);
});

console.log("\nconfirm / dismiss: what the UI writes");

ok("planned match: the sport lands in planned[run], nothing is written yet", () => {
  const m = matchDay(MON, resolveSchedule(MON, "auto", {}, PROGRAM), [run("a")], PROGRAM, {});
  assert.equal(m.planned.run.vendor_session_id, "a");
  assert.equal(weeklyCardioMinutes(MON, {}, {}, PROGRAM), 0);
});
ok("confirming a planned match writes minutes to the declared task and adds no activity", () => {
  const w = run("a");
  const log = { [DAY]: { done: {}, numbers: { "run-dur": Number(w.duration_minutes) } } };
  const ov = { [DAY]: { dismissedWorkouts: [`${w.vendor}:${w.vendor_session_id}`] } };
  assert.equal(ov[DAY].activities, undefined);
  assert.equal(weeklyCardioMinutes(MON, log, ov, PROGRAM), 42);
});
ok("a confirmed planned match is not offered again", () => {
  const ov = { [DAY]: { dismissedWorkouts: ["polar:a"] } };
  const m = matchDay(MON, resolveSchedule(MON, "auto", ov, PROGRAM), [run("a")], PROGRAM, ov);
  assert.deepEqual(m.planned, {});
  assert.deepEqual(m.extras, []);
});
ok("confirming an extra writes one activity, counts once, and is not re-offered", () => {
  const w = bike("b");
  const ov = { [DAY]: { activities: [activityFromWorkout(w, PROGRAM)] } };
  assert.equal(ov[DAY].activities[0].durationMin, 60);
  assert.equal(weeklyCardioMinutes(MON, {}, ov, PROGRAM), 60);
  const m = matchDay(MON, resolveSchedule(MON, "auto", ov, PROGRAM), [bike("b")], PROGRAM, ov);
  assert.deepEqual(m.extras, []);
});
ok("a dismissed extra is not re-offered and counts nothing", () => {
  const ov = { [DAY]: { dismissedWorkouts: ["polar:b"] } };
  const m = matchDay(MON, resolveSchedule(MON, "auto", ov, PROGRAM), [bike("b")], PROGRAM, ov);
  assert.deepEqual(m.extras, []);
  assert.equal(weeklyCardioMinutes(MON, {}, ov, PROGRAM), 0);
});
ok("an unconfirmed workout counts for nothing", () => {
  assert.equal(weeklyCardioMinutes(MON, {}, {}, PROGRAM), 0);
});
ok("a skip day offers the recorded workout as an extra, never as a planned match", () => {
  const ov = { [DAY]: { skip: "sick" } };
  const m = matchDay(MON, resolveSchedule(MON, "auto", ov, PROGRAM), [run("a")], PROGRAM, ov);
  assert.deepEqual(m.planned, {});
  assert.equal(m.extras.length, 1);
});
ok("a programme with no cardioTypes offers every recorded workout as an extra", () => {
  const bare = { ...PROGRAM, cardioTypes: undefined, hrZones: undefined };
  const m = matchDay(MON, resolveSchedule(MON, "auto", {}, bare), [run("a")], bare, {});
  assert.deepEqual(m.planned, {});
  assert.equal(m.extras.length, 1);
});

console.log("\nwearable rows carry vendor_session_id");

ok("loadWearables selects vendor_session_id from wearable_workouts", () => {
  const src = readFileSync("src/core/wearables.js", "utf8");
  const sel = src.match(/\.from\("wearable_workouts"\)\s*\.select\("([^"]+)"\)/);
  assert.ok(sel, "wearable_workouts select not found");
  assert.ok(sel[1].split(",").map((c) => c.trim()).includes("vendor_session_id"));
});
ok("without vendor_session_id the keys would collapse (why the column is needed)", () => {
  const w = run(undefined);
  assert.equal(`${w.vendor}:${w.vendor_session_id}`, "polar:undefined");
});

console.log(`\ntest-cardio-client: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
