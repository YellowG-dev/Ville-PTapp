/**
 * test-block-sports.mjs — a planned block names the watch sports that fill it.
 *
 * Run:  node test-block-sports.mjs      (plain node, no network, no browser)
 *
 * `blocks[slot][key].cardio.sports` (13 Nov 2026). The list belongs to the
 * block scheduled that day: Juha's Zone 2 takes a walk, his 4x4 does not, and
 * both sit in the same "cardio" slot. A block without a list matches through
 * `cardioTypes` exactly as before. Identical across the four client repos.
 */
import assert from "node:assert/strict";
import { resolveSchedule } from "./src/core/engine.js";
import { matchDay, resultWritesFromWorkout } from "./src/core/cardio.js";
import { validate } from "./src/core/program-schema.js";

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (err) { fail++; console.log(`  FAIL ${name}\n       ${err.message.split("\n")[0]}`); }
};

const MON = new Date(2026, 9, 5); // a Monday
const DAY = "2026-10-05";
const num = (id, name) => ({ id, name, type: "number" });
const PROGRAM = {
  id: "t", clientName: "T", slots: ["cardio", "run", "strength"],
  cardioTypes: [
    { id: "run", label: "Run", sports: ["running"], slot: "run" },
    { id: "walk", label: "Walk", sports: ["walking", "hiking"] },
    { id: "bike", label: "Bike", sports: ["cycling"] },
    { id: "cardio", label: "Cardio", slot: "cardio", sports: ["HIIT", "stairExercise", "elliptical", "cardiovascularExercise"] },
  ],
  hrZones: [{ id: "z2", label: "Zone 2", pctMin: 60, pctMax: 70 }],
  blocks: {
    cardio: {
      zone2: {
        label: "Zone 2", exercises: [{ id: "cv-z2", name: "Zone 2 continuous" }, num("cv-hr-peak", "Peak HR"), num("cv-hr-avg", "Average HR"), num("cardio-duration", "Duration")],
        cardio: { durationTaskId: "cardio-duration", hrAvgTaskId: "cv-hr-avg", hrMaxTaskId: "cv-hr-peak", sports: ["walking", "hiking", "running", "cycling", "rowing", "stairExercise", "elliptical", "cardiovascularExercise"] },
      },
      hard: {
        label: "4x4", exercises: [{ id: "cv-i1", name: "Interval 1" }, num("interval-duration", "Duration")],
        cardio: { durationTaskId: "interval-duration", sports: ["running", "stairExercise", "cycling", "rowing", "HIIT", "elliptical", "cardiovascularExercise"] },
      },
      plain: { label: "No list", exercises: [num("plain-duration", "Duration")], cardio: { durationTaskId: "plain-duration" } },
    },
    run: { easy: { label: "Run — Easy", exercises: [num("run-dur", "Run duration")], cardio: { durationTaskId: "run-dur" } } },
    strength: { a: { label: "Session A", cat: "strength", exercises: [] } },
  },
  schedule: { A: { 1: { cardio: "zone2", run: null, strength: null } }, B: { 1: { cardio: "zone2", run: null, strength: null } } },
  daily: [], tracking: {}, slotMeta: {}, slotOptions: {},
};
const w = (id, sport, over = {}) => ({ vendor: "oura", source: "workout_heart_rate", vendor_session_id: id, day: DAY, sport, started_at: `${DAY}T07:00:00Z`, duration_minutes: 56, distance_km: 5.1, hr_avg: null, hr_max: null, ...over });
const at = (h) => `${DAY}T${String(h).padStart(2, "0")}:00:00Z`;
const match = (workouts, ov = {}) => matchDay(MON, resolveSchedule(MON, "auto", ov, PROGRAM), workouts, PROGRAM, ov);
const ids = (list) => list.map((x) => x.vendor_session_id);

console.log("\nZone 2 day: the block's own list decides");

ok("a walk fills Zone 2 (it was an extra before)", () => {
  const m = match([w("a", "walking")]);
  assert.equal(m.planned.cardio.vendor_session_id, "a");
  assert.deepEqual(m.extras, []);
});
for (const sport of ["running", "cycling", "rowing", "stairExercise", "elliptical", "hiking"]) {
  ok(`${sport} fills Zone 2`, () => assert.equal(match([w("a", sport)]).planned.cardio.vendor_session_id, "a"));
}
ok("HIIT does not fill Zone 2 — it is on the slot's default list but not on this block's", () => {
  const m = match([w("a", "HIIT")]);
  assert.equal(m.planned.cardio, undefined);
  assert.deepEqual(ids(m.extras), ["a"]);
});
ok("swimming is not listed anywhere for the slot: extra", () => {
  assert.deepEqual(ids(match([w("a", "swimming")]).extras), ["a"]);
});
ok("two walks: the longest is the planned session, the other is an extra (either order)", () => {
  const short = w("s", "walking", { started_at: at(7), duration_minutes: 35 });
  const long = w("l", "walking", { started_at: at(17), duration_minutes: 56 });
  for (const order of [[short, long], [long, short]]) {
    const m = match(order);
    assert.equal(m.planned.cardio.vendor_session_id, "l");
    assert.deepEqual(ids(m.extras), ["s"]);
  }
});
ok("an auto-detected walk under 30 minutes still never counts", () => {
  const m = match([w("a", "walking", { source: "confirmed", duration_minutes: 13 })]);
  assert.equal(m.planned.cardio, undefined);
  assert.deepEqual(m.extras, []);
});
ok("a strength session is still nonCardio, never Zone 2", () => {
  const m = match([w("g", "strengthTraining")]);
  assert.equal(m.planned.cardio, undefined);
  assert.equal(m.nonCardio.length, 1);
});
ok("a dismissed walk is not offered again", () => {
  const ov = { [DAY]: { dismissedWorkouts: ["oura:a"] } };
  assert.equal(match([w("a", "walking")], ov).planned.cardio, undefined);
});

console.log("\n4x4 day: same slot, different block");

const HARD = { [DAY]: { cardio: "hard" } };
ok("a walk on a 4x4 day stays an extra", () => {
  const m = match([w("a", "walking")], HARD);
  assert.equal(m.planned.cardio, undefined);
  assert.deepEqual(ids(m.extras), ["a"]);
});
for (const sport of ["running", "stairExercise", "cycling", "rowing", "HIIT"]) {
  ok(`${sport} fills the 4x4`, () => assert.equal(match([w("a", sport)], HARD).planned.cardio.vendor_session_id, "a"));
}

console.log("\nBlocks without a list, and other slots: unchanged");

const PLAIN = { [DAY]: { cardio: "plain" } };
ok("no list: HIIT fills the slot through cardioTypes, as before", () => {
  assert.equal(match([w("a", "HIIT")], PLAIN).planned.cardio.vendor_session_id, "a");
});
ok("no list: a walk is an extra, as before", () => {
  const m = match([w("a", "walking")], PLAIN);
  assert.equal(m.planned.cardio, undefined);
  assert.deepEqual(ids(m.extras), ["a"]);
});
ok("no list: the FIRST qualifying session wins, as before", () => {
  const m = match([w("a", "HIIT", { started_at: at(7), duration_minutes: 20 }), w("b", "HIIT", { started_at: at(17), duration_minutes: 40 })], PLAIN);
  assert.equal(m.planned.cardio.vendor_session_id, "a");
});
ok("Zone 2 and a Run slot on the same day: a run goes to Zone 2 (its block lists running), not to both", () => {
  const ov = { [DAY]: { run: "easy" } };
  const m = match([w("a", "running")], ov);
  assert.equal(m.planned.cardio.vendor_session_id, "a");
  assert.equal(m.planned.run, undefined);
});
ok("rest day: nothing planned, the walk is an extra", () => {
  const ov = { [DAY]: { cardio: null } };
  const m = match([w("a", "walking")], ov);
  assert.deepEqual(m.planned, {});
  assert.deepEqual(ids(m.extras), ["a"]);
});

console.log("\nHeart rate from the watch lands in the block's result fields");

ok("confirming writes duration, average HR and max HR", () => {
  const r = resultWritesFromWorkout(PROGRAM.blocks.cardio.zone2, w("a", "walking", { hr_avg: 118.4, hr_max: 141 }), null);
  assert.deepEqual(r.numbers, { "cardio-duration": 56, "cv-hr-avg": 118, "cv-hr-peak": 141 });
  assert.equal(r.sessionTaskId, "cv-z2");
});
ok("no HR on the workout: only duration is written", () => {
  const r = resultWritesFromWorkout(PROGRAM.blocks.cardio.zone2, w("a", "walking"), null);
  assert.deepEqual(r.numbers, { "cardio-duration": 56 });
});
ok("a value typed by hand is kept", () => {
  const r = resultWritesFromWorkout(PROGRAM.blocks.cardio.zone2, w("a", "walking", { hr_avg: 118, hr_max: 141 }), { "cv-hr-avg": 125 });
  assert.equal(r.numbers["cv-hr-avg"], undefined);
});

console.log("\nValidator");

ok("the programme with sport lists validates; an unseen code is a warning only", () => {
  // The fixture is deliberately minimal (no slotMeta / slotOptions), so only
  // errors about the sport lists are checked here.
  const v = validate(PROGRAM);
  assert.deepEqual(v.errors.filter((x) => /sports/.test(x)), []);
  assert.ok(v.warnings.some((x) => /cardio\.zone2\.cardio\.sports lists "rowing"/.test(x)));
});
ok("sports must be an array of strings", () => {
  const bad = JSON.parse(JSON.stringify(PROGRAM));
  bad.blocks.cardio.zone2.cardio.sports = "walking";
  assert.ok(validate(bad).errors.some((x) => /sports must be an array of strings/.test(x)));
});
ok("strength and yoga can never be listed", () => {
  const bad = JSON.parse(JSON.stringify(PROGRAM));
  bad.blocks.cardio.zone2.cardio.sports = ["walking", "strengthTraining"];
  const v = validate(bad);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((x) => /not cardio/.test(x)));
});

console.log(`\ntest-block-sports: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
