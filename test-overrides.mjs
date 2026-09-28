/**
 * test-overrides.mjs — removing an activity must not delete the rest of the
 * day's overrides.
 *
 * Run:  node test-overrides.mjs      (plain node, no network, no browser)
 *
 * removeActivity used to delete the whole override entry for a day once its
 * last extra activity went, unless the day happened to hold a slot name from
 * the CURRENT programme. That silently dropped `deload: true` (the weekly
 * deload toggle writes it onto every day), a `note`, or a slot override
 * stored under a slot name an older programme version used. Fixed by only
 * ever touching the `activities` key; the day entry is deleted only when
 * nothing else is left in it.
 */
import assert from "node:assert/strict";
import { removeActivityOverride } from "./src/core/overrides.js";

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (err) { fail++; console.log(`  FAIL ${name}\n       ${err.message.split("\n")[0]}`); }
};

const DAY = "2026-09-28";

ok("last activity removed on a day that also has deload: true — deload survives, activities key is gone", () => {
  const overrides = { [DAY]: { deload: true, activities: [{ id: "a1", name: "Walk" }] } };
  const next = removeActivityOverride(overrides, DAY, "a1");
  assert.deepEqual(next, { [DAY]: { deload: true } });
});

ok("same with a note — note survives, activities key is gone", () => {
  const overrides = { [DAY]: { note: "felt great", activities: [{ id: "a1", name: "Walk" }] } };
  const next = removeActivityOverride(overrides, DAY, "a1");
  assert.deepEqual(next, { [DAY]: { note: "felt great" } });
});

ok("same with a slot key not in the current programme's slots — it survives", () => {
  // Current slots for this client are strength/run/bike/yoga; `cardio` is an
  // older programme version's slot name. The function does not consult
  // PROGRAM.slots at all, so it survives regardless.
  const overrides = { [DAY]: { cardio: "zone2", activities: [{ id: "a1", name: "Walk" }] } };
  const next = removeActivityOverride(overrides, DAY, "a1");
  assert.deepEqual(next, { [DAY]: { cardio: "zone2" } });
});

ok("last activity removed on a day with nothing else — the date key is removed", () => {
  const overrides = { [DAY]: { activities: [{ id: "a1", name: "Walk" }] } };
  const next = removeActivityOverride(overrides, DAY, "a1");
  assert.deepEqual(next, {});
});

ok("one of two activities removed — the other stays", () => {
  const overrides = { [DAY]: { activities: [{ id: "a1", name: "Walk" }, { id: "a2", name: "Swim" }] } };
  const next = removeActivityOverride(overrides, DAY, "a1");
  assert.deepEqual(next, { [DAY]: { activities: [{ id: "a2", name: "Swim" }] } });
});

ok("unknown date — input returned unchanged", () => {
  const overrides = { [DAY]: { activities: [{ id: "a1", name: "Walk" }] } };
  const next = removeActivityOverride(overrides, "2099-01-01", "a1");
  assert.equal(next, overrides);
});

ok("unknown id — input returned unchanged", () => {
  const overrides = { [DAY]: { activities: [{ id: "a1", name: "Walk" }] } };
  const next = removeActivityOverride(overrides, DAY, "nope");
  assert.equal(next, overrides);
});

console.log(`\ntest-overrides: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
