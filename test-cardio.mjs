/**
 * test-cardio.mjs — Step 9 Phase 2: repeatable cardio data shape and pure logic.
 *
 * Run:  node test-cardio.mjs      (plain node, no network, no browser)
 *
 * Covers the program-schema.js additions (hrZones, cardioTypes, block.cardio)
 * and every function in src/core/cardio.js. Identical across the four client
 * repos — the compiled programme it validates against is discovered at
 * runtime, the same way verify-program-delivery.mjs does it, so this file
 * needs no per-client edits.
 */
import { readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { validate } from "./src/core/program-schema.js";
import { dateKey } from "./src/core/dates.js";
import {
  isRealSession, recordedWorkouts, dedupe, matchDay, zoneBpm, pace,
  weeklyCardioMinutes, activityFromWorkout,
} from "./src/core/cardio.js";

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (err) { fail++; console.log(`  FAIL ${name}\n       ${err.message.split("\n")[0]}`); }
};
const okAsync = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok   ${name}`); }
  catch (err) { fail++; console.log(`  FAIL ${name}\n       ${err.message.split("\n")[0]}`); }
};

/* --------------------------- a minimal valid definition --------------------------- */

const BASE = {
  id: "x", clientName: "X", slots: ["run", "strength"],
  blocks: {
    run: { easy: { label: "Run — Easy", exercises: [{ id: "run-dur" }] } },
    strength: { a: { label: "Session A" } },
  },
  schedule: { A: {}, B: {} },
  daily: {}, tracking: {},
  slotMeta: { run: { label: "Run", color: "#4CB6C4" }, strength: { label: "Strength", color: "#112233" } },
  slotOptions: {
    run: [{ value: null, label: "None" }, { value: "easy", label: "Easy" }],
    strength: [{ value: null, label: "None" }, { value: "a", label: "A" }],
  },
};
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ============================== program-schema.js ================================ */

console.log("\nvalidator: hrZones / cardioTypes / block.cardio");

ok("the base definition validates clean", () => {
  const r = validate(BASE);
  assert.equal(r.ok, true, r.errors.join("; "));
});

await okAsync("each existing compiled programme in this repo validates unchanged", async () => {
  const files = readdirSync("src/core").filter((f) => /^program-.*\.js$/.test(f) && f !== "program-schema.js");
  assert.equal(files.length, 1, `expected exactly one program-*.js, found: ${files.join(", ")}`);
  const m = await import(`./src/core/${files[0]}`);
  const r = validate(m.default);
  assert.equal(r.ok, true, r.errors.join("; "));
});

ok("hrZones accepts a well-formed table", () => {
  const d = clone(BASE);
  d.hrZones = [{ id: "PK1", label: "PK1", pctMin: 60, pctMax: 70 }, { id: "PK2", label: "PK2", pctMin: 70, pctMax: 80 }];
  assert.equal(validate(d).ok, true);
});

ok("hrZones rejects pctMin >= pctMax", () => {
  const d = clone(BASE);
  d.hrZones = [{ id: "PK1", label: "PK1", pctMin: 70, pctMax: 60 }];
  const r = validate(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /pctMin/.test(e)), r.errors.join("; "));
});

ok("hrZones rejects pctMax over 100", () => {
  const d = clone(BASE);
  d.hrZones = [{ id: "PK1", label: "PK1", pctMin: 60, pctMax: 101 }];
  assert.equal(validate(d).ok, false);
});

ok("hrZones rejects a duplicate id", () => {
  const d = clone(BASE);
  d.hrZones = [{ id: "PK1", label: "A", pctMin: 60, pctMax: 70 }, { id: "PK1", label: "B", pctMin: 70, pctMax: 80 }];
  const r = validate(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /duplicate/.test(e)), r.errors.join("; "));
});

ok("hrZones rejects an empty id", () => {
  const d = clone(BASE);
  d.hrZones = [{ id: "", label: "A", pctMin: 60, pctMax: 70 }];
  assert.equal(validate(d).ok, false);
});

ok("cardioTypes accepts a well-formed list", () => {
  const d = clone(BASE);
  d.cardioTypes = [{ id: "run", label: "Run", sports: ["running"], slot: "run" }, { id: "walk", label: "Walk", sports: ["walking"] }];
  assert.equal(validate(d).ok, true);
});

ok("cardioTypes rejects a duplicate id", () => {
  const d = clone(BASE);
  d.cardioTypes = [{ id: "run", label: "Run", sports: ["running"] }, { id: "run", label: "Run2", sports: ["jogging"] }];
  assert.equal(validate(d).ok, false);
});

ok('cardioTypes rejects the reserved id "other"', () => {
  const d = clone(BASE);
  d.cardioTypes = [{ id: "other", label: "Other" }];
  const r = validate(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /reserved/.test(e)), r.errors.join("; "));
});

ok("cardioTypes rejects a slot not in slots", () => {
  const d = clone(BASE);
  d.cardioTypes = [{ id: "swim", label: "Swim", sports: ["swimming"], slot: "swimming" }];
  const r = validate(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /slot/.test(e)), r.errors.join("; "));
});

ok("cardioTypes rejects sports that is not an array of strings", () => {
  const d = clone(BASE);
  d.cardioTypes = [{ id: "run", label: "Run", sports: "running" }];
  assert.equal(validate(d).ok, false);
});

ok("cardioTypes warns when a sport is listed under two types", () => {
  const d = clone(BASE);
  d.cardioTypes = [{ id: "run", label: "Run", sports: ["running"] }, { id: "jog", label: "Jog", sports: ["running"] }];
  const r = validate(d);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /more than one cardio type/.test(w)), r.warnings.join("; "));
});

ok("block.cardio accepts a well-formed target", () => {
  const d = clone(BASE);
  d.hrZones = [{ id: "PK1", label: "PK1", pctMin: 60, pctMax: 70 }];
  d.blocks.run.easy.cardio = {
    durationMin: 45, distanceKm: 8, zoneAvg: "PK1", zoneMax: "PK1", pace: "5:45",
    note: "Flat route", durationTaskId: "run-dur",
  };
  const r = validate(d);
  assert.equal(r.ok, true, r.errors.join("; "));
});

ok("block.cardio rejects a non-positive number", () => {
  const d = clone(BASE);
  d.blocks.run.easy.cardio = { durationMin: 0 };
  assert.equal(validate(d).ok, false);
});

ok("block.cardio rejects a malformed pace", () => {
  const d = clone(BASE);
  d.blocks.run.easy.cardio = { pace: "5.45" };
  assert.equal(validate(d).ok, false);
});
ok("block.cardio accepts single-digit minutes in pace", () => {
  const d = clone(BASE);
  d.blocks.run.easy.cardio = { pace: "9:05" };
  assert.equal(validate(d).ok, true);
});

ok("block.cardio rejects a zoneAvg/zoneMax not in hrZones", () => {
  const d = clone(BASE);
  d.blocks.run.easy.cardio = { zoneAvg: "NOPE" };
  const r = validate(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /not an id in hrZones/.test(e)), r.errors.join("; "));
});

ok("block.cardio rejects a durationTaskId not in this block's exercises", () => {
  const d = clone(BASE);
  d.blocks.run.easy.cardio = { durationTaskId: "does-not-exist" };
  const r = validate(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /durationTaskId/.test(e)), r.errors.join("; "));
});

ok("block.cardio warns when the block's slot is strength", () => {
  const d = clone(BASE);
  d.blocks.strength.a.cardio = { durationMin: 10 };
  const r = validate(d);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /strength/.test(w)), r.warnings.join("; "));
});

/* ==================================== cardio.js ==================================== */

console.log("\nisRealSession");

ok("oura workout_heart_rate is real", () => assert.equal(isRealSession({ vendor: "oura", source: "workout_heart_rate" }), true));
ok("oura manual is real", () => assert.equal(isRealSession({ vendor: "oura", source: "manual" }), true));
ok("oura autodetected is not real", () => assert.equal(isRealSession({ vendor: "oura", source: "autodetected" }), false));
ok("oura confirmed is not real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed" }), false));
ok("polar rows are always real, no source field needed", () => assert.equal(isRealSession({ vendor: "polar" }), true));
ok("a missing workout is not real", () => assert.equal(isRealSession(null), false));

ok("recordedWorkouts filters out autodetected/confirmed Oura rows", () => {
  const rows = [
    { vendor: "oura", source: "autodetected", vendor_session_id: "a" },
    { vendor: "oura", source: "confirmed", vendor_session_id: "b" },
    { vendor: "oura", source: "manual", vendor_session_id: "c" },
    { vendor: "polar", vendor_session_id: "d" },
  ];
  const kept = recordedWorkouts(rows).map((w) => w.vendor_session_id);
  assert.deepEqual(kept, ["c", "d"]);
});

console.log("\ndedupe");

ok("an overlapping Polar+Oura pair collapses to one, Polar kept", () => {
  const rows = [
    { vendor: "oura", vendor_session_id: "o1", day: "2026-09-28", started_at: "2026-09-28T06:00:00Z", duration_minutes: 40 },
    { vendor: "polar", vendor_session_id: "p1", day: "2026-09-28", started_at: "2026-09-28T06:10:00Z", duration_minutes: 35 },
  ];
  const d = dedupe(rows);
  assert.equal(d.length, 1);
  assert.equal(d[0].vendor, "polar");
});

ok("a non-overlapping pair on the same day both survive", () => {
  const rows = [
    { vendor: "oura", vendor_session_id: "o1", day: "2026-09-28", started_at: "2026-09-28T06:00:00Z", duration_minutes: 30 },
    { vendor: "polar", vendor_session_id: "p1", day: "2026-09-28", started_at: "2026-09-28T18:00:00Z", duration_minutes: 30 },
  ];
  assert.equal(dedupe(rows).length, 2);
});

ok("the same two vendors on different days do not merge", () => {
  const rows = [
    { vendor: "oura", vendor_session_id: "o1", day: "2026-09-27", started_at: "2026-09-27T06:00:00Z", duration_minutes: 30 },
    { vendor: "polar", vendor_session_id: "p1", day: "2026-09-28", started_at: "2026-09-28T06:00:00Z", duration_minutes: 30 },
  ];
  assert.equal(dedupe(rows).length, 2);
});

console.log("\nmatchDay");

const CARDIO_PROGRAM = {
  cardioTypes: [
    { id: "run", label: "Run", sports: ["running"], slot: "run" },
    { id: "walk", label: "Walk", sports: ["walking"] }, // extras-only: no slot
  ],
};
const RUN_WORKOUT = {
  vendor: "oura", vendor_session_id: "r1", sport: "running", source: "workout_heart_rate",
  day: "2026-09-28", started_at: "2026-09-28T06:00:00Z", duration_minutes: 40,
};
const WALK_WORKOUT = {
  vendor: "oura", vendor_session_id: "w1", sport: "walking", source: "workout_heart_rate",
  day: "2026-09-28", started_at: "2026-09-28T09:00:00Z", duration_minutes: 20,
};

ok("a workout matching a scheduled slot is offered as a planned prefill; one with no slot is an extra", () => {
  const info = { slots: { run: "easy", strength: null } };
  const r = matchDay(new Date(2026, 8, 28), info, [RUN_WORKOUT, WALK_WORKOUT], CARDIO_PROGRAM, {});
  assert.deepEqual(Object.keys(r.planned), ["run"]);
  assert.equal(r.planned.run.vendor_session_id, "r1");
  assert.equal(r.extras.length, 1);
  assert.equal(r.extras[0].vendor_session_id, "w1");
});

ok("a workout whose slot is not scheduled that day falls through to extras", () => {
  const info = { slots: { run: null, strength: null } }; // run not happening today
  const r = matchDay(new Date(2026, 8, 28), info, [RUN_WORKOUT], CARDIO_PROGRAM, {});
  assert.deepEqual(r.planned, {});
  assert.equal(r.extras.length, 1);
});

ok("a dismissed workout is not re-offered as an extra", () => {
  const info = { slots: { run: "easy", strength: null } };
  const overrides = { "2026-09-28": { dismissedWorkouts: ["oura:w1"] } };
  const r = matchDay(new Date(2026, 8, 28), info, [RUN_WORKOUT, WALK_WORKOUT], CARDIO_PROGRAM, overrides);
  assert.ok(r.planned.run, "the run match must still be offered");
  assert.equal(r.extras.length, 0, "the dismissed walk must not reappear");
});

ok("an already-confirmed workout is not re-offered as a planned match", () => {
  const info = { slots: { run: "easy", strength: null } };
  const overrides = {
    "2026-09-28": { activities: [{ id: "a1", name: "Run", source: "wearable", workout: { vendor: "oura", vendorSessionId: "r1" } }] },
  };
  const r = matchDay(new Date(2026, 8, 28), info, [RUN_WORKOUT, WALK_WORKOUT], CARDIO_PROGRAM, overrides);
  assert.equal(r.planned.run, undefined, "the confirmed run must not reappear as a suggestion");
  assert.equal(r.extras.length, 1, "the walk is unaffected and still offered");
});

console.log("\nzoneBpm");

const ZONE_PROGRAM = { hrZones: [{ id: "PK1", label: "PK1", pctMin: 60, pctMax: 70 }] };
ok("zoneBpm with a max HR and a matching zone returns lo/hi", () => {
  assert.deepEqual(zoneBpm("PK1", 180, ZONE_PROGRAM), { lo: 108, hi: 126 });
});
ok("zoneBpm with no max HR returns null", () => assert.equal(zoneBpm("PK1", null, ZONE_PROGRAM), null));
ok("zoneBpm with no zone table returns null", () => assert.equal(zoneBpm("PK1", 180, {}), null));
ok("zoneBpm with an unknown zone id returns null", () => assert.equal(zoneBpm("NOPE", 180, ZONE_PROGRAM), null));

console.log("\npace");

ok("pace is derived, never stored", () => assert.equal(pace(45, 8), "5:38"));
ok("pace with no distance is null", () => assert.equal(pace(45, 0), null));
ok("pace with missing inputs is null", () => assert.equal(pace(null, 8), null));

console.log("\nweeklyCardioMinutes");

ok("legacy { id, name } activity counts 0 minutes", () => {
  const overrides = { "2026-09-21": { activities: [{ id: "a1", name: "Old-style activity" }] } };
  const total = weeklyCardioMinutes(new Date(2026, 8, 21), {}, overrides, BASE);
  assert.equal(total, 0);
});

ok("a planned block with no durationTaskId counts 0, even if something is logged", () => {
  const log = { "2026-09-21": { numbers: { "run-dur": 99 } } };
  const schedule = { A: { 1: { run: "easy" } }, B: { 1: { run: "easy" } } };
  const prog = { ...clone(BASE), schedule };
  const total = weeklyCardioMinutes(new Date(2026, 8, 21), log, {}, prog);
  assert.equal(total, 0);
});

ok("weekly total = planned logged duration + confirmed extras, across a programme-version boundary", () => {
  const mkProgram = (taskId) => ({
    ...clone(BASE),
    schedule: { A: { 0: { run: "easy" }, 1: { run: "easy" }, 2: { run: "easy" }, 3: { run: "easy" }, 4: { run: "easy" }, 5: { run: "easy" }, 6: { run: "easy" } },
                B: { 0: { run: "easy" }, 1: { run: "easy" }, 2: { run: "easy" }, 3: { run: "easy" }, 4: { run: "easy" }, 5: { run: "easy" }, 6: { run: "easy" } } },
    blocks: { ...clone(BASE.blocks), run: { easy: { label: "Run", exercises: [{ id: taskId }], cardio: { durationTaskId: taskId } } } },
  });
  const programA = mkProgram("run-durA"); // effective before 2026-09-24
  const programB = mkProgram("run-durB"); // effective from 2026-09-24
  const resolver = (d) => (dateKey(d) < "2026-09-24" ? programA : programB);

  const log = {
    "2026-09-21": { numbers: { "run-durA": 30 } },      // A-side, counted
    "2026-09-24": { numbers: { "run-durB": 25 } },      // B-side, counted
    "2026-09-22": { numbers: { "run-durB": 999 } },     // wrong version's task id on an A day — must not count
  };
  const overrides = {
    "2026-09-25": { activities: [{ id: "e1", name: "Walk", durationMin: 15, source: "manual" }] }, // confirmed extra
    "2026-09-26": { activities: [{ id: "e2", name: "Legacy" }] },                                   // legacy, 0
  };

  const total = weeklyCardioMinutes(new Date(2026, 8, 21), log, overrides, resolver);
  assert.equal(total, 30 + 25 + 15);
});

console.log("\nactivityFromWorkout");

ok("a matched workout's activity takes its name from the cardio type", () => {
  const a = activityFromWorkout(RUN_WORKOUT, CARDIO_PROGRAM);
  assert.equal(a.name, "Run");
  assert.equal(a.typeId, "run");
  assert.equal(a.source, "wearable");
  assert.deepEqual(a.workout, { vendor: "oura", vendorSessionId: "r1" });
  assert.equal(a.durationMin, 40);
});

ok("an unmatched sport falls back to a label derived from the sport", () => {
  const a = activityFromWorkout({ vendor: "oura", vendor_session_id: "s1", sport: "stairExercise", duration_minutes: 12 }, CARDIO_PROGRAM);
  assert.equal(a.typeId, null);
  assert.equal(a.name, "Stair Exercise");
});

console.log(`\ntest-cardio: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
