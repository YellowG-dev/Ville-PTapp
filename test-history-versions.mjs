/**
 * test-history-versions.mjs — Phase 7: every day is scored against the
 * programme version that was in force on THAT day.
 *
 * Run:  node test-history-versions.mjs      (plain node, no node_modules)
 *
 * It exists because the bug it guards is silent. Before Phase 7 the app passed
 * one programme — the one resolved at startup for today — to every date-bearing
 * engine call. Nothing threw, nothing logged; a day logged under Block 1 simply
 * started reporting a different percentage the morning Block 2 began, and the
 * Calendar quietly repainted the past. There is no way to notice that from the
 * screen, so it has to be pinned here.
 *
 * Two halves:
 *
 *   EQUIVALENCE — with a single version, passing a resolver must produce output
 *                 DEEPLY EQUAL to passing the object. This is the acceptance bar
 *                 for shipping Phase 7: every client has one version in force
 *                 today, so Phase 7 must be invisible to all four of them.
 *   VERSIONING  — with two versions, each day must resolve to the right one.
 *
 * It runs against the real src/core/engine.js and src/core/programs.js, not a
 * copy, and names no client: app.jsx and this file are byte-identical across the
 * four client repos, so the compiled programme is discovered the way
 * verify-program-delivery.mjs discovers it.
 */
import { readdirSync } from "node:fs";
import assert from "node:assert/strict";

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try {
    const r = fn();
    // A promise here would mean the assertions inside never reached this catch.
    if (r && typeof r.then === "function") throw new Error("test callback must be synchronous");
    pass++; console.log(`  ok   ${name}`);
  } catch (err) { fail++; console.log(`  FAIL ${name}\n       ${err.message.split("\n")[0]}`); }
};

const {
  buildHistoryRows, buildSections, resolveSchedule, resolveTesting,
} = await import("./src/core/engine.js");
const { makeProgramResolver, selectRows } = await import("./src/core/programs.js");
const { validate } = await import("./src/core/program-schema.js");

const programFiles = readdirSync("src/core")
  .filter((f) => /^program-.*\.js$/.test(f) && f !== "program-schema.js");
if (programFiles.length !== 1) {
  console.error(`\nEXPECTED exactly one src/core/program-*.js, found: ${programFiles.join(", ") || "none"}`);
  process.exit(1);
}
const CLIENT = programFiles[0].replace(/^program-|\.js$/g, "");
const PROGRAM = (await import(`./src/core/${programFiles[0]}`)).default;
console.log(`  (client: ${CLIENT})`);

/* --------------------------------- fixtures -------------------------------- */

const key = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// 70 consecutive days from a Monday, so every weekday and both ISO week types
// (A and B) are covered several times over. Start late enough to be past any
// client's startDate.
const START = new Date(2026, 9, 5);          // Mon 5 Oct 2026
const DAYS = 70;
const dates = Array.from({ length: DAYS }, (_, i) => addDays(START, i));

/**
 * A log that exercises the parts of a row that can differ between versions:
 * ticked tasks, scales, numbers, choices, a per-day hrMax, a stored weekType and
 * a gentler flag. Deterministic — no Math.random, so a failure is reproducible.
 */
function syntheticLog() {
  const log = {};
  dates.forEach((d, i) => {
    const rec = { done: {}, scales: {}, numbers: {}, choices: {} };
    // Tick roughly two thirds of whatever the day happens to hold.
    const sections = buildSections(d, { weekType: "auto", overrides: {} }, PROGRAM);
    sections.flatMap((s) => s.tasks).forEach((t, j) => {
      if ((i + j) % 3 === 0) return;
      if (t.type === "scale") rec.scales[t.id] = ((i + j) % 5) + 1;
      else if (t.type === "number") rec.numbers[t.id] = 60 + ((i * 7 + j) % 30);
      else if (t.type === "choice") rec.choices[t.id] = String((t.options && t.options[0] && t.options[0].value) ?? "x");
      else rec.done[t.id] = true;
    });
    if (i % 11 === 0) rec.hrMax = 175;
    if (i % 13 === 0) rec.weekType = i % 26 === 0 ? "A" : "B";
    if (i % 17 === 0) rec.gentler = true;
    log[key(d)] = rec;
  });
  return log;
}

// Overrides that move sessions about, skip days and add activities — the things
// that make a past day's task list differ from the bare template.
function syntheticOverrides() {
  const ov = {};
  const slot0 = PROGRAM.slots[0];
  const values = Object.keys(PROGRAM.blocks[slot0] || {});
  dates.forEach((d, i) => {
    const k = key(d);
    if (i % 9 === 0) ov[k] = { ...(ov[k] || {}), skip: ["sick", "travel", "injured"][i % 3] };
    if (i % 7 === 0 && values.length) ov[k] = { ...(ov[k] || {}), [slot0]: values[i % values.length] };
    if (i % 8 === 0) ov[k] = { ...(ov[k] || {}), [slot0]: null };
    if (i % 10 === 0) ov[k] = { ...(ov[k] || {}), activities: [{ id: `a${i}`, name: "Padel" }] };
    if (i % 14 === 0) ov[k] = { ...(ov[k] || {}), deload: true };
  });
  return ov;
}

const LOG = syntheticLog();
const OVERRIDES = syntheticOverrides();
assert.ok(Object.keys(LOG).length >= 60, "the fixture log must span at least 60 days");

/* ------------------------------- EQUIVALENCE ------------------------------- */
// One version, two ways of passing it. Any difference here is a Phase 7 bug,
// and would be a live change to four people's history.

console.log("\nEQUIVALENCE — a resolver equals an object when there is one version");

const asFn = () => PROGRAM;

ok("buildHistoryRows over a 70-day log", () => {
  assert.deepStrictEqual(
    buildHistoryRows(LOG, OVERRIDES, asFn),
    buildHistoryRows(LOG, OVERRIDES, PROGRAM),
  );
});

ok("buildHistoryRows rows are non-trivial (the fixture actually logs work)", () => {
  const rows = buildHistoryRows(LOG, OVERRIDES, PROGRAM);
  assert.equal(rows.length, DAYS);
  assert.ok(rows.some((r) => r.total > 0), "no row has any countable task");
  assert.ok(rows.some((r) => r.doneCount > 0), "nothing is ticked anywhere");
  assert.ok(rows.some((r) => r.skip), "no skipped day in the fixture");
});

ok("buildSections, every day", () => {
  for (const d of dates) {
    const opts = { weekType: "auto", overrides: OVERRIDES, hrMax: 175, record: LOG[key(d)] };
    assert.deepStrictEqual(
      buildSections(d, opts, asFn),
      buildSections(d, opts, PROGRAM),
      `differs on ${key(d)}`,
    );
  }
});

ok("resolveSchedule, every day and both week types", () => {
  for (const d of dates) {
    for (const wk of ["auto", "A", "B"]) {
      assert.deepStrictEqual(
        resolveSchedule(d, wk, OVERRIDES, asFn),
        resolveSchedule(d, wk, OVERRIDES, PROGRAM),
        `differs on ${key(d)} (${wk})`,
      );
    }
  }
});

ok("resolveTesting, every day", () => {
  for (const d of dates) {
    assert.deepStrictEqual(
      resolveTesting(d, OVERRIDES, asFn),
      resolveTesting(d, OVERRIDES, PROGRAM),
      `differs on ${key(d)}`,
    );
  }
});

/* -------------------------------- VERSIONING ------------------------------- */
// Two versions with genuinely different schedules. `-infinity` is what PostgREST
// sends for a row with no start date, and the engine has to treat it as "since
// forever" rather than as a date string.

console.log("\nVERSIONING — each day resolves to the version in force on it");

const SWITCH = new Date(2026, 10, 16);       // Mon 16 Nov 2026, mid-fixture
const SWITCH_KEY = key(SWITCH);

const slot = PROGRAM.slots[0];
const blockKeys = Object.keys(PROGRAM.blocks[slot] || {});
assert.ok(blockKeys.length >= 1, "the compiled programme needs at least one block to fork");

/** A copy of the compiled programme whose whole week runs `value` in slot 0. */
function forked(id, value) {
  const p = JSON.parse(JSON.stringify(PROGRAM));
  p.id = id;
  for (const wk of ["A", "B"]) {
    p.schedule[wk] = p.schedule[wk] || {};
    for (let dow = 0; dow < 7; dow++) {
      p.schedule[wk][String(dow)] = { ...(p.schedule[wk][dow] || {}), [slot]: value };
    }
  }
  delete p.startDate;      // both versions cover the whole fixture range
  return p;
}

// Version 2 runs a block that exists only in version 2, with exercise ids that
// appear nowhere else. Reusing two of the client's own blocks is not enough:
// different blocks can hold the same NUMBER of tasks in the same category, and
// with none of them ticked the two versions then score a day identically — which
// happened for Henna and made this test pass for the wrong reason.
const MARKER_BLOCK = "phase7-block-2";
const MARKER_TASKS = ["phase7-x", "phase7-y", "phase7-z"];

const OLD = forked("block-1", blockKeys[0]);
const NEW = forked("block-2", MARKER_BLOCK);
NEW.blocks[slot] = {
  ...NEW.blocks[slot],
  [MARKER_BLOCK]: {
    label: "Block 2 session",
    cat: (NEW.slotMeta[slot] && NEW.slotMeta[slot].cat) || slot,
    exercises: MARKER_TASKS.map((id, i) => ({ id, name: `Marker lift ${i + 1}`, presc: "3 x 8" })),
  },
};
NEW.slotOptions[slot] = [
  ...(NEW.slotOptions[slot] || []),
  { value: MARKER_BLOCK, label: "Block 2" },
];
NEW.restLabel = "Block 2 rest";
const ROWS = [
  { id: "block-1", effective_from: "-infinity", name: "Block 1", definition: OLD },
  { id: "block-2", effective_from: SWITCH_KEY, name: "Block 2", definition: NEW },
];

const resolver = makeProgramResolver({
  compiled: PROGRAM, clientName: PROGRAM.clientName, rows: ROWS,
});

ok("the day before the switch resolves to the old version", () => {
  assert.equal(resolver(addDays(SWITCH, -1)).id, "block-1");
});
ok("the switch day itself resolves to the new version", () => {
  assert.equal(resolver(SWITCH).id, "block-2");
});
ok("a day well after the switch resolves to the new version", () => {
  assert.equal(resolver(addDays(SWITCH, 30)).id, "block-2");
});
ok("a day long before either resolves to the -infinity version", () => {
  assert.equal(resolver(new Date(2020, 0, 1)).id, "block-1");
});

ok("buildHistoryRows scores each day against its own version", () => {
  const rows = buildHistoryRows(LOG, OVERRIDES, resolver);
  const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));
  const before = buildHistoryRows(LOG, OVERRIDES, OLD);
  const after = buildHistoryRows(LOG, OVERRIDES, NEW);
  const beforeByDate = Object.fromEntries(before.map((r) => [r.date, r]));
  const afterByDate = Object.fromEntries(after.map((r) => [r.date, r]));
  for (const d of dates) {
    const k = key(d);
    const expected = k < SWITCH_KEY ? beforeByDate[k] : afterByDate[k];
    assert.deepStrictEqual(byDate[k], expected, `${k} scored against the wrong version`);
  }
});

ok("the two versions really do differ, so the test above can fail", () => {
  const withOld = buildHistoryRows(LOG, OVERRIDES, OLD);
  const withNew = buildHistoryRows(LOG, OVERRIDES, NEW);
  assert.notDeepStrictEqual(withOld, withNew);
});

ok("version 2's marker session appears only on and after the switch", () => {
  const names = (d) => JSON.stringify(
    buildSections(d, { weekType: "auto", overrides: {} }, resolver)
  );
  assert.ok(!names(addDays(SWITCH, -1)).includes(MARKER_TASKS[0]),
            "the new block leaked into a day before it took effect");
  assert.ok(names(SWITCH).includes(MARKER_TASKS[0]),
            "the new block is missing on its own first day");
  assert.ok(names(addDays(SWITCH, 20)).includes(MARKER_TASKS[0]),
            "the new block is missing well after it took effect");
});

ok("both forked versions still satisfy the schema contract", () => {
  // A fixture that fails validate() would be silently dropped by selectRows and
  // the resolver would fall back to `compiled`, making the versioning tests
  // above pass without ever resolving a version.
  for (const [label, def] of [["version 1", OLD], ["version 2", NEW]]) {
    const v = validate(def);
    assert.ok(v.ok, `${label} is invalid: ${v.errors.join("; ")}`);
  }
});

ok("buildSections follows the same rule", () => {
  const opts = (d) => ({ weekType: "auto", overrides: OVERRIDES, record: LOG[key(d)] });
  const beforeDay = addDays(SWITCH, -3);
  assert.deepStrictEqual(
    buildSections(beforeDay, opts(beforeDay), resolver),
    buildSections(beforeDay, opts(beforeDay), OLD),
  );
  assert.deepStrictEqual(
    buildSections(SWITCH, opts(SWITCH), resolver),
    buildSections(SWITCH, opts(SWITCH), NEW),
  );
});

ok("resolveSchedule and resolveTesting follow the same rule", () => {
  const beforeDay = addDays(SWITCH, -3);
  assert.deepStrictEqual(
    resolveSchedule(beforeDay, "auto", OVERRIDES, resolver),
    resolveSchedule(beforeDay, "auto", OVERRIDES, OLD),
  );
  assert.deepStrictEqual(
    resolveSchedule(SWITCH, "auto", OVERRIDES, resolver),
    resolveSchedule(SWITCH, "auto", OVERRIDES, NEW),
  );
  assert.deepStrictEqual(
    resolveTesting(SWITCH, OVERRIDES, resolver),
    resolveTesting(SWITCH, OVERRIDES, NEW),
  );
});

/* --------------------- an override naming a missing block ------------------- */
// The case that would otherwise throw: the client moved a session on a day, and
// the version in force on that day has never heard of the block they picked.
// Verified behaviour of today's engine, locked here: the slot is still reported
// as scheduled, no section is emitted for it, and nothing is counted.

console.log("\nROBUSTNESS — an override naming a block the version in force lacks");

const GHOST_DAY = addDays(SWITCH, -5);
const GHOST_KEY = key(GHOST_DAY);
const GHOST_OV = { [GHOST_KEY]: { [slot]: "a-block-that-never-existed" } };
const GHOST_LOG = { [GHOST_KEY]: { done: {} } };

ok("resolveSchedule still reports the slot", () => {
  const info = resolveSchedule(GHOST_DAY, "auto", GHOST_OV, resolver);
  assert.equal(info.slots[slot], "a-block-that-never-existed");
  assert.equal(info.moved[slot], true);
  assert.equal(info.isTrainingDay, true);
});

ok("buildSections emits no section for it and does not throw", () => {
  const secs = buildSections(GHOST_DAY, { weekType: "auto", overrides: GHOST_OV }, resolver);
  assert.ok(Array.isArray(secs));
  assert.equal(secs.filter((x) => x.key === slot).length, 0);
});

ok("buildHistoryRows counts only what existed", () => {
  const rows = buildHistoryRows(GHOST_LOG, GHOST_OV, resolver);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].byCat[slot], undefined);
  assert.ok(Number.isFinite(rows[0].pct));
});

ok("a slot absent from the version in force does not throw either", () => {
  const noSlot = JSON.parse(JSON.stringify(OLD));
  noSlot.slots = noSlot.slots.filter((s) => s !== slot);
  const rows = buildHistoryRows(GHOST_LOG, GHOST_OV, () => noSlot);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].byCat[slot], undefined);
});

/* ------------------------- validation runs exactly once -------------------- */
// validate() walks the entire definition. Per day it would run 70 times here and
// 57 times for John on every render of the history screen.

console.log("\nCOST — the resolver validates once, not per day");

ok("selectRows is called exactly once for a 70-day log", () => {
  let calls = 0;
  const counting = (args) => { calls += 1; return selectRows(args); };
  const r = makeProgramResolver({
    compiled: PROGRAM, clientName: PROGRAM.clientName, rows: ROWS, select: counting,
  });
  assert.equal(calls, 1, `after construction: ${calls}`);
  const rows = buildHistoryRows(LOG, OVERRIDES, r);
  assert.equal(rows.length, DAYS);
  assert.equal(calls, 1, `after scoring ${DAYS} days: ${calls}`);
});

ok("the same date is resolved once and cached by day, not by Date object", () => {
  const memoised = makeProgramResolver({
    compiled: PROGRAM, clientName: PROGRAM.clientName, rows: ROWS,
  });
  // A month grid asks for the same dates over and over, each time as a fresh
  // Date. Reference identity across those calls is the observable proof the
  // memo keys on the calendar day rather than the object.
  const first = memoised(new Date(2026, 10, 20));
  for (let i = 0; i < 50; i++) {
    assert.equal(memoised(new Date(2026, 10, 20)), first, "a repeat lookup re-resolved");
  }
  // Two different times of day are still one calendar day.
  const noon = new Date(2026, 10, 20, 12, 30, 45);
  assert.equal(memoised(noon), first, "the time of day leaked into the memo key");
  // And a different day is genuinely a different answer.
  assert.notEqual(memoised(new Date(2026, 10, 15)), first, "the switch date was not honoured");
});

ok("an empty row set falls back to the compiled programme", () => {
  const r = makeProgramResolver({ compiled: PROGRAM, clientName: PROGRAM.clientName, rows: [] });
  assert.equal(r(new Date(2026, 9, 14)), PROGRAM);
});

ok("a row for another client is rejected, not run", () => {
  const foreign = JSON.parse(JSON.stringify(NEW));
  foreign.clientName = "SomebodyElse";
  const r = makeProgramResolver({
    compiled: PROGRAM, clientName: PROGRAM.clientName,
    rows: [{ id: "foreign", effective_from: "-infinity", definition: foreign }],
  });
  assert.equal(r(new Date(2026, 9, 14)), PROGRAM);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
