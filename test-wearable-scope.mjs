/**
 * test-wearable-scope.mjs — wearable data belongs to exactly one person.
 *
 * Run:  node test-wearable-scope.mjs      (plain node, no network, no browser)
 *
 * The bug this guards was invisible from the screen, because every number it
 * showed was a real number belonging to a real person. `loadWearables()` sent
 * no user filter, on the reasoning that RLS would limit the rows to the signed-
 * in person's own. That holds for a client. It does not hold for the coach: the
 * live policy on all three wearable tables is
 *
 *     (user_id = auth.uid()) OR is_coach_of(user_id)
 *
 * and the coach signs in to his own client app like anyone else, so his session
 * satisfies the second branch. Simulated under RLS, Henna's identity returned 49
 * rows and Ville's 121; the coach's returned 273 — Henna plus Ville plus his
 * own. On 2026-09-26 his app showed 84, which was Henna's night; his own was 83.
 *
 * Two independent defects produced that, and both are pinned here:
 *   SCOPE     — the query must name the person. RLS is a backstop, not a filter.
 *   COLLAPSE  — one row per day, by a declared vendor preference, so slices and
 *               averages count days rather than array entries.
 *
 * It runs against the real src/core/wearables.js. The two imports that need the
 * app around them are stubbed out the way verify-wearables.mjs already does it;
 * the Supabase client is a fake that records the filters it was handed, so
 * nothing here touches a network.
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import assert from "node:assert/strict";

const SRC = "src/core/wearables.js";
const TMP = "./.test-wearable-scope.tmp.mjs";

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === "function") throw new Error("test callback must be synchronous");
    pass++; console.log(`  ok   ${name}`);
  } catch (err) { fail++; console.log(`  FAIL ${name}\n       ${err.message.split("\n")[0]}`); }
};
const okAsync = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok   ${name}`); }
  catch (err) { fail++; console.log(`  FAIL ${name}\n       ${err.message.split("\n")[0]}`); }
};

/* ------------------------------ the seam ---------------------------------- */
// A fake Supabase client. It answers the query-builder shape wearables.js uses
// and records every filter it was given, so the assertion is about the query
// that was built — not about a network call that may or may not have happened.
const recorded = [];
let fakeClient = null;

function makeQuery(table) {
  const entry = { table, eq: {}, gte: {}, select: null, ordered: [] };
  recorded.push(entry);
  const q = {
    select(cols) { entry.select = cols; return q; },
    eq(col, val) { entry.eq[col] = val; return q; },
    gte(col, val) { entry.gte[col] = val; return q; },
    order(col, opts) { entry.ordered.push([col, opts]); return q; },
    // Awaiting the builder is what runs it in supabase-js.
    then(res) { return Promise.resolve({ data: [], error: null }).then(res); },
  };
  return q;
}

function buildStub() {
  let src;
  try { src = readFileSync(SRC, "utf8"); }
  catch { console.log(`Cannot read ${SRC} — run this from the repo root.`); process.exit(1); }
  const stripped = src
    .replace(
      /import \{ getClient, isConfigured \} from "\.\/supabase\.js";/,
      "const getClient = () => globalThis.__fakeClient; const isConfigured = () => true;"
    )
    .replace(
      /import \{ SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY \} from "\.\.\/config\.jsx";/,
      'const SUPABASE_URL = "x"; const SUPABASE_PUBLISHABLE_KEY = "y";'
    )
    // The tmp file lives at the repo root, not src/core, so wearables.js's own
    // relative import needs the path adjusted the same way the two above do.
    .replace(
      /import \{ isRealSession \} from "\.\/cardio\.js";/,
      'import { isRealSession } from "./src/core/cardio.js";'
    );
  if (stripped === src) {
    console.log("Import lines did not match — wearables.js has changed shape. Update this script.");
    process.exit(1);
  }
  writeFileSync(TMP, stripped);
  return stripped;
}

buildStub();
globalThis.__fakeClient = null;
const W = await import(TMP);
unlinkSync(TMP);

const TABLES = ["wearable_connections", "wearable_days", "wearable_workouts"];

/* ------------------------------- 1. scope --------------------------------- */

const JUHA = "11111111-1111-1111-1111-111111111111";
const HENNA = "22222222-2222-2222-2222-222222222222";
const VILLE = "33333333-3333-3333-3333-333333333333";

await okAsync("loadWearables filters every one of the three queries by the id given", async () => {
  recorded.length = 0;
  globalThis.__fakeClient = { from: (t) => makeQuery(t) };
  const res = await W.loadWearables(JUHA);
  assert.equal(res.ok, true, "the stubbed read should have succeeded");

  assert.deepEqual(recorded.map((r) => r.table).sort(), [...TABLES].sort(),
    "all three wearable tables must be read");
  for (const table of TABLES) {
    const q = recorded.find((r) => r.table === table);
    assert.equal(q.eq.user_id, JUHA,
      `${table} was queried without user_id = the signed-in person — this is the bug`);
  }
});

await okAsync("loadWearables with no id returns the empty shape and issues no query at all", async () => {
  for (const missing of [undefined, null, ""]) {
    recorded.length = 0;
    globalThis.__fakeClient = { from: (t) => makeQuery(t) };
    const res = await W.loadWearables(missing);
    assert.deepEqual(res, { ok: false, connections: [], days: [], workouts: [] },
      `a missing id (${JSON.stringify(missing)}) must return the empty shape`);
    assert.equal(recorded.length, 0,
      "a missing id must never fall back to an unfiltered query — that is how the coach saw everyone");
  }
});

globalThis.__fakeClient = null;

/* ----------------------------- 2. collapse -------------------------------- */
// Values from the real incident. His own readings on the left, what his app
// showed on the right: 2026-09-26 read 84, which was Henna's night.
const OWN = {
  "2026-09-27": { sleep_minutes: 401, readiness: 80, resting_hr: 51, hrv: 48, steps: 8400 },
  "2026-09-26": { sleep_minutes: 397, readiness: 83, resting_hr: 52, hrv: 46, steps: 7700 },
  "2026-09-25": { sleep_minutes: 412, readiness: 83, resting_hr: 50, hrv: 49, steps: 9100 },
  "2026-09-24": { sleep_minutes: 388, readiness: 78, resting_hr: 53, hrv: 44, steps: 6600 },
  "2026-09-23": { sleep_minutes: 361, readiness: 82, resting_hr: 51, hrv: 48, steps: 7200 },
  "2026-09-22": { sleep_minutes: 403, readiness: 57, resting_hr: 59, hrv: 29, steps: 5100 },
  "2026-09-21": { sleep_minutes: 430, readiness: 86, resting_hr: 49, hrv: 52, steps: 10200 },
  "2026-09-20": { sleep_minutes: 372, readiness: 74, resting_hr: 54, hrv: 41, steps: 4800 },
  "2026-09-19": { sleep_minutes: 419, readiness: 80, resting_hr: 50, hrv: 47, steps: 8800 },
  "2026-09-18": { sleep_minutes: 385, readiness: 76, resting_hr: 52, hrv: 45, steps: 7400 },
};
const DAYS_DESC = Object.keys(OWN).sort().reverse();
const row = (day, vendor, user_id, over = {}) => ({ day, vendor, user_id, ...OWN[day], ...over });

ok("two vendors on one day give ONE point for that day, and it is Oura's", () => {
  const days = [
    row("2026-09-27", "polar", JUHA, { readiness: 56, sleep_minutes: 300 }),
    row("2026-09-27", "oura", JUHA),
  ];
  const r = W.buildRecovery(days, [], JUHA);
  const points = r.series.filter((p) => p.day === "2026-09-27");
  assert.equal(points.length, 1, "a day with two vendor rows must plot once, not twice");
  assert.equal(points[0].readiness, 80, "Oura is the readiness source and must win the day");
  assert.equal(r.latest.vendor, "oura", "last night should read from Oura");
  assert.equal(r.nights, 1, "one day with two rows is one night, not two");
});

ok("Polar still carries a day Oura did not record", () => {
  const days = [
    row("2026-09-27", "oura", JUHA),
    row("2026-09-26", "polar", JUHA),
  ];
  const r = W.buildRecovery(days, [], JUHA);
  assert.equal(r.series.length, 2, "both days must survive");
  assert.equal(W.collapseDays(days, JUHA).find((d) => d.day === "2026-09-26").vendor, "polar",
    "the preference is an order, not an Oura-only filter");
});

ok("the vendor preference is data, and an unknown vendor sorts last", () => {
  assert.deepEqual(W.VENDOR_PREFERENCE, ["oura", "polar"]);
  const days = [row("2026-09-27", "whoop", JUHA, { readiness: 12 }), row("2026-09-27", "polar", JUHA)];
  assert.equal(W.collapseDays(days, JUHA)[0].vendor, "polar",
    "a vendor nobody has declared must not outrank a declared one");
});

/* ------------------------- 3. averages over days -------------------------- */

ok("avg7 over 10 days with two vendors each averages 7 DAYS, not 7 rows", () => {
  // Twenty rows, ten days, both vendors every day. Polar's numbers are absurd on
  // purpose: if any of them reaches an average, the assertion fails loudly.
  const days = [];
  DAYS_DESC.forEach((d) => {
    days.push(row(d, "polar", JUHA, { sleep_minutes: 1, readiness: 1, resting_hr: 199, hrv: 1 }));
    days.push(row(d, "oura", JUHA));
  });
  const r = W.buildRecovery(days, [], JUHA);

  const first7 = DAYS_DESC.slice(0, 7);
  const want = (key) => first7.reduce((a, d) => a + OWN[d][key], 0) / 7;
  assert.equal(r.series.length, 10, "ten days of two-vendor rows are ten points");
  assert.equal(r.avg7.sleep, want("sleep_minutes"),
    "avg7 averaged rows, not days — with two vendors that is three and a half days");
  assert.equal(r.avg7.readiness, want("readiness"));
  assert.equal(r.avg7.rhr, want("resting_hr"));
  assert.equal(r.avg7.hrv, want("hrv"));
  // The old code took rows.slice(0, 7), which here is 3.5 days and half Polar.
  assert.notEqual(r.avg7.readiness, 1, "Polar's placeholder leaked into the average");
});

ok("a gap in the days does not shorten the 7-day window to fewer readings", () => {
  const kept = ["2026-09-27", "2026-09-26", "2026-09-24", "2026-09-22", "2026-09-21", "2026-09-19", "2026-09-18"];
  const days = kept.map((d) => row(d, "oura", JUHA));
  const r = W.buildRecovery(days, [], JUHA);
  const want = kept.reduce((a, d) => a + OWN[d].readiness, 0) / kept.length;
  assert.equal(r.avg7.readiness, want, "avg7 is the last seven days that HAVE a reading");
});

/* --------------------- 4. defence in depth on identity -------------------- */

ok("defence in depth: a second person's row cannot outrank the subject's own row for that day", () => {
  // Scoping in loadWearables should make this unreachable. It is pinned anyway,
  // because it was unreachable-by-reasoning that produced the bug in the first
  // place. Henna's row is Oura, so on vendor preference alone it would tie and
  // could win on arrival order; whose row it is must decide first.
  const days = [
    { day: "2026-09-26", vendor: "oura", user_id: HENNA, sleep_minutes: 424, readiness: 84, resting_hr: 55, hrv: 61 },
    row("2026-09-26", "oura", JUHA),
    { day: "2026-09-27", vendor: "oura", user_id: VILLE, sleep_minutes: 320, readiness: 56, resting_hr: 58, hrv: 33 },
    row("2026-09-27", "oura", JUHA),
  ];
  for (const ordered of [days, [...days].reverse()]) {
    const r = W.buildRecovery(ordered, [], JUHA);
    assert.equal(r.series.length, 2, "two days, whoever the rows belong to");
    const sep26 = r.series.find((p) => p.day === "2026-09-26");
    assert.equal(sep26.readiness, 83, "2026-09-26 showed Henna's 84; his own was 83");
    const sep27 = r.series.find((p) => p.day === "2026-09-27");
    assert.equal(sep27.readiness, 80, "2026-09-27 showed Ville's 56; his own was 80");
  }
});

ok("with no subject named, the vendor preference decides alone", () => {
  // buildRecovery is also called on rows already known to be one person's.
  const days = [row("2026-09-27", "polar", JUHA, { readiness: 56 }), row("2026-09-27", "oura", JUHA)];
  const r = W.buildRecovery(days, []);
  assert.equal(r.series.length, 1);
  assert.equal(r.series[0].readiness, 80);
});

/* ------------------------ 5. a missing day stays missing ------------------ */

ok("a day with a reading from neither vendor stays absent — never zero, never interpolated", () => {
  const days = [
    row("2026-09-27", "oura", JUHA),
    { day: "2026-09-26", vendor: "oura", user_id: JUHA, steps: 900 }, // today-from-midnight shape
    row("2026-09-25", "oura", JUHA),
  ];
  const r = W.buildRecovery(days, [], JUHA);
  const blank = r.series.find((p) => p.day === "2026-09-26");
  assert.equal(blank.sleepH, null, "a night with no reading must be null, not 0");
  assert.equal(blank.readiness, null);
  assert.equal(blank.hrv, null);
  assert.equal(blank.rhr, null);
  assert.equal(r.nights, 2, "the blank day is not a night");
  // 2026-09-24 was never in the data at all; it must not have been invented.
  assert.equal(r.series.find((p) => p.day === "2026-09-24"), undefined,
    "a day absent from the data must stay absent, not be filled in");
  assert.equal(r.latest.day, "2026-09-27");
  assert.equal(W.buildRecovery([], [], JUHA), null, "no data at all gives nothing to render");
});

console.log(`\ntest-wearable-scope: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
