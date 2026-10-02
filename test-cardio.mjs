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
import { validate, STANDARD_SLOTS, NON_CARDIO_SLOTS, KNOWN_SPORTS } from "./src/core/program-schema.js";
import { dateKey } from "./src/core/dates.js";
import {
  isRealSession, recordedWorkouts, dedupe, matchDay, zoneBpm, pace,
  weeklyCardioMinutes, activityFromWorkout, isStrengthWorkout, isCardioActivity, nonCardioSlotFor,
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
// Rule set by John 29 Sep 2026: confirmed Oura rows count unless housework-type sports or a short walk.
ok("oura confirmed houseWork 16 min is not real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "houseWork", duration_minutes: 16 }), false));
ok("oura confirmed yardwork 16 min is not real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "yardwork", duration_minutes: 16 }), false));
ok("oura confirmed stretching 16 min is not real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "stretching", duration_minutes: 16 }), false));
ok("oura confirmed other 16 min is not real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "other", duration_minutes: 16 }), false));
ok("oura confirmed walking 29 min is not real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "walking", duration_minutes: 29 }), false));
ok("oura confirmed walking 30 min is real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "walking", duration_minutes: 30 }), true));
ok("oura confirmed walking is not real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "walking" }), false));
ok("oura confirmed running 49 min is real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "running", duration_minutes: 49 }), true));
ok("oura confirmed strengthTraining 49 min is real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "strengthTraining", duration_minutes: 49 }), true));
ok("oura confirmed yoga 49 min is real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "yoga", duration_minutes: 49 }), true));
ok("oura confirmed cycling 49 min is real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "cycling", duration_minutes: 49 }), true));
ok("oura confirmed hiking 49 min is real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "hiking", duration_minutes: 49 }), true));
ok("oura confirmed tennis 49 min is real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "tennis", duration_minutes: 49 }), true));
ok("oura confirmed HIIT 49 min is real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "HIIT", duration_minutes: 49 }), true));
ok("oura confirmed swimming 49 min is real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "swimming", duration_minutes: 49 }), true));
ok("oura confirmed paddleSports 49 min is real", () => assert.equal(isRealSession({ vendor: "oura", source: "confirmed", sport: "paddleSports", duration_minutes: 49 }), true));
ok("oura autodetected running is still not real", () => assert.equal(isRealSession({ vendor: "oura", source: "autodetected", sport: "running", duration_minutes: 49 }), false));
ok("oura manual housework still counts (client entered it)", () => assert.equal(isRealSession({ vendor: "oura", source: "manual", sport: "houseWork", duration_minutes: 16 }), true));
ok("polar rows are always real, no source field needed", () => assert.equal(isRealSession({ vendor: "polar" }), true));
ok("a missing workout is not real", () => assert.equal(isRealSession(null), false));

ok("recordedWorkouts filters out autodetected and non-sport confirmed Oura rows", () => {
  const rows = [
    { vendor: "oura", source: "autodetected", vendor_session_id: "a" },
    { vendor: "oura", source: "confirmed", sport: "houseWork", duration_minutes: 16, vendor_session_id: "b" },
    { vendor: "oura", source: "confirmed", sport: "running", duration_minutes: 49, vendor_session_id: "e" },
    { vendor: "oura", source: "manual", vendor_session_id: "c" },
    { vendor: "polar", vendor_session_id: "d" },
  ];
  const kept = recordedWorkouts(rows).map((w) => w.vendor_session_id);
  assert.deepEqual(kept, ["e", "c", "d"]);
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

console.log("\nstrength and yoga are not cardio");

const GYM = (vendor, id, extra = {}) => ({
  vendor, vendor_session_id: id, sport: "strengthTraining", source: "workout_heart_rate",
  day: "2026-09-28", started_at: "2026-09-28T17:00:00Z", duration_minutes: 55, ...extra,
});
const YOGA = (vendor, id, extra = {}) => ({
  vendor, vendor_session_id: id, sport: "yoga", source: "workout_heart_rate",
  day: "2026-09-28", started_at: "2026-09-28T19:00:00Z", duration_minutes: 40, ...extra,
});
const STR_INFO = { slots: { run: "easy", strength: "a" } };
const D28 = new Date(2026, 8, 28);
const ids = (r) => r.nonCardio.map((n) => n.workout.vendor_session_id);

ok("isStrengthWorkout (kept for one release) recognises strengthTraining only", () => {
  assert.equal(isStrengthWorkout(GYM("oura", "g")), true);
  assert.equal(isStrengthWorkout(RUN_WORKOUT), false);
  assert.equal(isStrengthWorkout(null), false);
});

ok("nonCardioSlotFor maps strength and yoga sports, and nothing else", () => {
  assert.equal(nonCardioSlotFor("strengthTraining"), "strength");
  assert.equal(nonCardioSlotFor("yoga"), "yoga");
  for (const sp of ["running", "walking", "cycling", "swimming", "HIIT", "tennis", "stretching", undefined]) {
    assert.equal(nonCardioSlotFor(sp), null, String(sp));
  }
});

ok("a strength workout goes to nonCardio with slot strength, never to planned or extras", () => {
  const r = matchDay(D28, STR_INFO, [GYM("oura", "g1"), RUN_WORKOUT], CARDIO_PROGRAM, {});
  assert.deepEqual(ids(r), ["g1"]);
  assert.equal(r.nonCardio[0].slot, "strength");
  assert.deepEqual(Object.keys(r.planned), ["run"]);
  assert.equal(r.extras.length, 0);
});

ok("a yoga workout goes to nonCardio with slot yoga, never to planned or extras", () => {
  const r = matchDay(D28, { slots: { run: "easy", yoga: "session" } }, [YOGA("oura", "y1"), WALK_WORKOUT], CARDIO_PROGRAM, {});
  assert.deepEqual(ids(r), ["y1"]);
  assert.equal(r.nonCardio[0].slot, "yoga");
  assert.deepEqual(Object.keys(r.planned), []);
  assert.deepEqual(r.extras.map((w) => w.vendor_session_id), ["w1"]);
});

ok("strength and yoga on one day are both reported, each with its slot", () => {
  const r = matchDay(D28, STR_INFO, [GYM("oura", "g1"), YOGA("oura", "y1")], CARDIO_PROGRAM, {});
  assert.deepEqual(r.nonCardio.map((n) => `${n.slot}:${n.workout.vendor_session_id}`).sort(), ["strength:g1", "yoga:y1"]);
});

ok("a non-cardio sport is nonCardio even when a cardio type lists it (the validator forbids that, the matcher is safe anyway)", () => {
  const prog = { cardioTypes: [{ id: "gym", label: "Gym", sports: ["strengthTraining", "yoga"], slot: "strength" }] };
  const r = matchDay(D28, STR_INFO, [GYM("oura", "g1"), YOGA("oura", "y1")], prog, {});
  assert.deepEqual(r.planned, {});
  assert.equal(r.extras.length, 0);
  assert.equal(r.nonCardio.length, 2);
});

ok("Polar beats Oura in a strength duplicate and in a yoga duplicate", () => {
  const r = matchDay(D28, STR_INFO, [GYM("oura", "g1"), GYM("polar", "p1", { source: null })], CARDIO_PROGRAM, {});
  assert.equal(r.nonCardio.length, 1);
  assert.equal(r.nonCardio[0].workout.vendor, "polar");
  const y = matchDay(D28, STR_INFO, [YOGA("oura", "y1"), YOGA("polar", "py1", { source: null })], CARDIO_PROGRAM, {});
  assert.equal(y.nonCardio.length, 1);
  assert.equal(y.nonCardio[0].workout.vendor, "polar");
});

ok("an autodetected Oura strength or yoga workout the client never accepted is not offered", () => {
  const r = matchDay(D28, STR_INFO, [GYM("oura", "g1", { source: "autodetected" }), YOGA("oura", "y1", { source: "autodetected" })], CARDIO_PROGRAM, {});
  assert.equal(r.nonCardio.length, 0);
});

ok("dismissed strength and yoga workouts are not re-offered", () => {
  const r = matchDay(D28, STR_INFO, [GYM("oura", "g1"), YOGA("oura", "y1")], CARDIO_PROGRAM,
    { "2026-09-28": { dismissedWorkouts: ["oura:g1", "oura:y1"] } });
  assert.equal(r.nonCardio.length, 0);
});

ok("confirmed strength and yoga extras are not re-offered", () => {
  const acts = [activityFromWorkout(GYM("oura", "g1"), CARDIO_PROGRAM), activityFromWorkout(YOGA("oura", "y1"), CARDIO_PROGRAM)];
  const r = matchDay(D28, { slots: {} }, [GYM("oura", "g1"), YOGA("oura", "y1")], CARDIO_PROGRAM, { "2026-09-28": { activities: acts } });
  assert.equal(r.nonCardio.length, 0);
});

ok("activityFromWorkout tags strength and yoga with kind and the catalogue label", () => {
  const g = activityFromWorkout(GYM("oura", "g1"), CARDIO_PROGRAM);
  assert.equal(g.kind, "strength"); assert.equal(g.name, "Strength"); assert.equal(g.typeId, null);
  assert.equal(g.durationMin, 55); assert.equal(g.source, "wearable");
  const y = activityFromWorkout(YOGA("oura", "y1"), CARDIO_PROGRAM);
  assert.equal(y.kind, "yoga"); assert.equal(y.name, "Yoga"); assert.equal(y.typeId, null); assert.equal(y.durationMin, 40);
});

ok("a cardio workout has no kind", () => {
  assert.equal("kind" in activityFromWorkout(RUN_WORKOUT, CARDIO_PROGRAM), false);
});

const WK_PROGRAM = { slots: ["strength"], blocks: { strength: {} }, schedule: { A: {}, B: {} } };

ok("a strength extra adds 0 to the weekly total; a cardio extra the same day still counts", () => {
  const ov = { "2026-09-28": { activities: [
    activityFromWorkout(GYM("oura", "g1"), CARDIO_PROGRAM),
    activityFromWorkout(WALK_WORKOUT, CARDIO_PROGRAM),
  ] } };
  assert.equal(weeklyCardioMinutes(new Date(2026, 8, 28), {}, ov, WK_PROGRAM), 20);
});

ok("a confirmed yoga extra adds 0; a cardio extra the same day still counts", () => {
  const ov = { "2026-09-28": { activities: [
    activityFromWorkout(YOGA("oura", "y1"), CARDIO_PROGRAM),
    activityFromWorkout(WALK_WORKOUT, CARDIO_PROGRAM),
  ] } };
  assert.equal(weeklyCardioMinutes(new Date(2026, 8, 28), {}, ov, WK_PROGRAM), 20);
});

ok("a planned yoga block with a durationTaskId adds 0; the same task on a run block counts", () => {
  const blocks = (slot) => ({ [slot]: { s: { label: "S", exercises: [{ id: "dur", name: "Dur", type: "number", unit: "min" }], cardio: { durationTaskId: "dur" } } } });
  const prog = (slot) => ({ slots: [slot], blocks: blocks(slot), schedule: { A: { 1: { [slot]: "s" } }, B: { 1: { [slot]: "s" } } } });
  const log = { "2026-09-28": { numbers: { dur: 45 } } };
  assert.equal(weeklyCardioMinutes(D28, log, {}, prog("yoga")), 0);
  assert.equal(weeklyCardioMinutes(D28, log, {}, prog("strength")), 0);
  assert.equal(weeklyCardioMinutes(D28, log, {}, prog("walk")), 45);
});

ok("a client-specific slot (tennis) counts as cardio", () => {
  const prog = { slots: ["tennis"], blocks: { tennis: { lesson: { label: "L", exercises: [{ id: "tdur", name: "T", type: "number" }], cardio: { durationTaskId: "tdur" } } } },
    schedule: { A: { 1: { tennis: "lesson" } }, B: { 1: { tennis: "lesson" } } } };
  assert.equal(weeklyCardioMinutes(D28, { "2026-09-28": { numbers: { tdur: 60 } } }, {}, prog), 60);
});

ok("isCardioActivity: true for legacy { id, name } and cardio; false for kind strength and kind yoga", () => {
  assert.equal(isCardioActivity({ id: "1", name: "Walk" }), true);
  assert.equal(isCardioActivity(activityFromWorkout(WALK_WORKOUT, CARDIO_PROGRAM)), true);
  assert.equal(isCardioActivity({ id: "2", name: "Gym", kind: "strength", durationMin: 50 }), false);
  assert.equal(isCardioActivity({ id: "3", name: "Yoga", kind: "yoga", durationMin: 50 }), false);
  assert.equal(isCardioActivity({ id: "4", name: "Run", kind: "run" }), true);
  assert.equal(isCardioActivity(null), false);
});

ok("an existing kind:strength entry written by Phase 5b still adds 0", () => {
  const old = { id: "oura:g9", name: "Strength training", kind: "strength", source: "wearable", durationMin: 55, workout: { vendor: "oura", vendorSessionId: "g9" } };
  assert.equal(weeklyCardioMinutes(D28, {}, { "2026-09-28": { activities: [old] } }, WK_PROGRAM), 0);
});

console.log("\nslot catalogue");

ok("STANDARD_SLOTS: the seven ids, in order, with unique colours and the agreed cardio flags", () => {
  assert.deepEqual(STANDARD_SLOTS.map((s) => s.id), ["strength", "run", "walk", "swim", "bike", "yoga", "cardio"]);
  assert.equal(new Set(STANDARD_SLOTS.map((s) => s.color)).size, 7);
  assert.ok(STANDARD_SLOTS.every((s) => /^#[0-9A-Fa-f]{6}$/.test(s.color) && s.label && Array.isArray(s.sports)));
  assert.deepEqual(STANDARD_SLOTS.filter((s) => !s.countsAsCardio).map((s) => s.id), ["strength", "yoga"]);
  assert.deepEqual(NON_CARDIO_SLOTS, ["strength", "yoga"]);
});

ok("STANDARD_SLOTS sports are the agreed defaults, and every one is a KNOWN_SPORT", () => {
  const by = Object.fromEntries(STANDARD_SLOTS.map((s) => [s.id, s.sports]));
  assert.deepEqual(by, {
    strength: ["strengthTraining"], run: ["running"], walk: ["walking", "hiking"], swim: ["swimming"],
    bike: ["cycling"], yoga: ["yoga"], cardio: ["HIIT", "stairExercise", "elliptical", "cardiovascularExercise"],
  });
  for (const sp of STANDARD_SLOTS.flatMap((s) => s.sports)) assert.ok(KNOWN_SPORTS.includes(sp), sp);
});

ok("the colours in STANDARD_SLOTS match the live slotMeta where the slot already exists", () => {
  const live = { strength: "#E3A23C", cardio: "#4CB6C4", bike: "#6FCF97", yoga: "#A99BC9" };
  for (const [id, color] of Object.entries(live)) assert.equal(STANDARD_SLOTS.find((s) => s.id === id).color, color, id);
});

const withTypes = (cardioTypes) => validate({ ...clone(BASE), cardioTypes });

ok("the validator errors on a cardio type that lists strengthTraining or yoga", () => {
  for (const sp of ["strengthTraining", "yoga"]) {
    const r = withTypes([{ id: "t", label: "T", sports: [sp] }]);
    assert.equal(r.ok, false, sp);
    assert.ok(r.errors.some((e) => e.includes(sp) && /not cardio/.test(e)), r.errors.join("; "));
  }
});

ok("the validator warns, not errors, on an unknown sport code (Joonatan's live-style 'Assault bike')", () => {
  const r = withTypes([{ id: "ab", label: "Assault bike", sports: ["Assault bike"] }, { id: "b", label: "Bike", sports: ["Bike"] }]);
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.equal(r.warnings.filter((w) => /not a known watch-sport code/.test(w)).length, 2);
});

ok("known sport codes raise no sport warning", () => {
  const r = withTypes([{ id: "r", label: "Run", sports: ["running"], slot: "run" }, { id: "w", label: "Walk", sports: ["walking", "hiking"] }]);
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.equal(r.warnings.filter((w) => /watch-sport/.test(w)).length, 0);
});

console.log(`\ntest-cardio: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
