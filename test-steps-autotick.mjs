// test-steps-autotick.mjs — a daily task ticks itself from the day's Oura steps
// (Step 10 Phase 1, decision D11). Run: node test-steps-autotick.mjs
//
// Three parts, byte-identical in all four client repos (the compiled programme
// and the storage prefix are discovered, not named):
//
//   1. stepsAutoTicks, the pure rule in engine.js: ticks at min and above, never
//      below, never on unknown steps, never over a manual un-tick (done[id] ===
//      false) or an existing tick; follows byDayType and dayOfWeek.
//   2. Version boundary: a day resolved to a programme version without `auto`
//      is never ticked, even at 20,000 steps.
//   3. The merge gate, driven through the REAL app in a fake browser with the
//      network stubbed (same method as test-notes.mjs and verify-otp.mjs).
//      pullAndMerge lets a pending local day win over the cloud copy, so a tick
//      queued before the first successful merge would replace a client's real
//      cloud day with a one-tick record. With the pull failing, nothing may be
//      written or queued; after a successful pull, the tick must land ON TOP of
//      the merged day, keeping everything else in it.
import { JSDOM } from "jsdom";
import fs from "fs";
import { readdirSync } from "node:fs";
import { execSync } from "child_process";
import assert from "node:assert/strict";

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try {
    const r = typeof fn === "function" ? fn() : fn;
    if (r === false) throw new Error("condition is false");
    pass++; console.log(`  ok   ${name}`);
  } catch (err) { fail++; console.log(`  FAIL ${name}\n       ${String(err.message).split("\n")[0]}`); }
};
const done = () => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); };
process.on("uncaughtException", (e) => { console.log("FAIL (crash): " + e.message); fail++; done(); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));

const { buildSections, stepsAutoTicks, dateKey } = await import("./src/core/engine.js");
const { validate } = await import("./src/core/program-schema.js");

const programFiles = readdirSync("src/core").filter((f) => /^program-.*\.js$/.test(f) && f !== "program-schema.js");
if (programFiles.length !== 1) { console.log(`EXPECTED one src/core/program-*.js, found: ${programFiles.join(", ")}`); process.exit(1); }
const COMPILED = clone((await import(`./src/core/${programFiles[0]}`)).default);
console.log(`  (client: ${programFiles[0].replace(/^program-|\.js$/g, "")})`);

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** The compiled programme with `auto` on one plain check task. Returns { def, id }. */
function withAuto(base, min) {
  const def = clone(base);
  const plain = [];
  (def.daily || []).forEach((sec) => (sec.tasks || []).forEach((t) => { if (t && t.type === undefined) plain.push(t); }));
  const prefer = ["chk-walk", "steps", "chk-walk-pk1"];
  const task = plain.find((t) => prefer.includes(t.id)) || plain[0];
  if (task) { task.auto = { source: "steps", min }; return { def, id: task.id }; }
  // No plain daily task in this programme: add one, so the test still runs.
  const sec = { key: "steps-test", cat: "check", title: "Steps", tasks: [{ id: "steps-test", name: "Walk", presc: "Daily step target", auto: { source: "steps", min } }] };
  def.daily = [...(def.daily || []), sec];
  return { def, id: "steps-test" };
}

/* ---------------------------- 1. the pure rule ----------------------------- */
console.log("--- 1. stepsAutoTicks ---");
const day = new Date(2026, 10, 12); // a Thursday
const secs = (tasks) => [{ key: "check", cat: "check", tasks }];
const T = { id: "walk", name: "Walk", type: "exercise", auto: { source: "steps", min: 10000 } };

ok("ticks at exactly min", () => assert.deepEqual(stepsAutoTicks(secs([T]), {}, 10000), ["walk"]));
ok("ticks above min", () => assert.deepEqual(stepsAutoTicks(secs([T]), { done: {} }, 18000), ["walk"]));
ok("does not tick below min", () => assert.deepEqual(stepsAutoTicks(secs([T]), {}, 9999), []));
ok("does not tick when steps is null", () => assert.deepEqual(stepsAutoTicks(secs([T]), {}, null), []));
ok("does not tick when steps is undefined", () => assert.deepEqual(stepsAutoTicks(secs([T]), {}, undefined), []));
ok("does not tick when steps is NaN", () => assert.deepEqual(stepsAutoTicks(secs([T]), {}, NaN), []));
ok("never re-ticks a manual un-tick (done[id] === false)", () => assert.deepEqual(stepsAutoTicks(secs([T]), { done: { walk: false } }, 20000), []));
ok("leaves an existing tick alone (done[id] === true)", () => assert.deepEqual(stepsAutoTicks(secs([T]), { done: { walk: true } }, 20000), []));
ok("ticks with no record at all", () => assert.deepEqual(stepsAutoTicks(secs([T]), null, 12000), ["walk"]));
ok("ignores tasks without auto", () => assert.deepEqual(stepsAutoTicks(secs([{ id: "water", type: "exercise" }, T]), {}, 12000), ["walk"]));
ok("ignores an auto with another source", () => assert.deepEqual(stepsAutoTicks(secs([{ ...T, auto: { source: "sleep", min: 1 } }]), {}, 12000), []));

// Through buildSections: byDayType and dayOfWeek decide whether the task exists.
const mini = {
  slots: ["strength"], schedule: { A: { 4: { strength: "a" } }, B: { 4: { strength: "a" } } },
  blocks: { strength: { a: { label: "A", exercises: [{ id: "sq", name: "Squat", sets: 3, presc: "5" }] } } },
  daily: [
    { key: "check", cat: "check", title: "Checks",
      byDayType: {
        training: { tasks: [{ id: "steps-t", name: "Walk", presc: "Training-day steps", auto: { source: "steps", min: 6000 } }] },
        rest: { tasks: [{ id: "steps-r", name: "Walk", presc: "Rest-day steps", auto: { source: "steps", min: 10000 } }] },
      } },
    { key: "fri", cat: "check", title: "Friday", dayOfWeek: 5, tasks: [{ id: "steps-fri", name: "Walk", auto: { source: "steps", min: 1000 } }] },
  ],
};
const restDay = new Date(2026, 10, 11); // Wednesday, nothing scheduled
const friday = new Date(2026, 10, 13);
ok("byDayType: a training day uses the training variant's task and min", () =>
  assert.deepEqual(stepsAutoTicks(buildSections(day, { weekType: "A" }, mini), {}, 7000), ["steps-t"]));
ok("byDayType: a rest day uses the rest variant's task and min", () => {
  assert.deepEqual(stepsAutoTicks(buildSections(restDay, { weekType: "A" }, mini), {}, 7000), []);
  assert.deepEqual(stepsAutoTicks(buildSections(restDay, { weekType: "A" }, mini), {}, 10000), ["steps-r"]);
});
ok("dayOfWeek: the task exists only on its day", () => {
  // Friday is a rest day here: the rest variant (min 10,000) stays unticked at 2,000.
  assert.deepEqual(stepsAutoTicks(buildSections(friday, { weekType: "A" }, mini), {}, 2000), ["steps-fri"]);
  assert.ok(!stepsAutoTicks(buildSections(day, { weekType: "A" }, mini), {}, 2000).includes("steps-fri"));
});
ok("buildSections carries auto only on the task that declares it", () => {
  const all = buildSections(day, { weekType: "A" }, mini).flatMap((s) => s.tasks);
  assert.deepEqual(all.filter((t) => "auto" in t).map((t) => t.id), ["steps-t"]);
});

/* ------------------------- 2. the version boundary ------------------------- */
console.log("--- 2. version boundary ---");
const { def: AUTO_DEF, id: AUTO_ID } = withAuto(COMPILED, 10000);
ok("the compiled programme validates with auto added", () => {
  const v = validate(AUTO_DEF);
  assert.ok(v.ok, v.errors.join("; "));
});
{
  const switchDay = new Date(2026, 10, 14);
  const resolver = (d) => (dateKey(d) >= dateKey(switchDay) ? AUTO_DEF : COMPILED);
  const before = addDays(switchDay, -1);
  ok(`a day on the version without auto is never ticked, even at 20,000 steps (${AUTO_ID})`, () =>
    assert.deepEqual(stepsAutoTicks(buildSections(before, { weekType: "auto" }, resolver), {}, 20000), []));
  ok("the first day on the version with auto is ticked", () =>
    assert.deepEqual(stepsAutoTicks(buildSections(switchDay, { weekType: "auto" }, resolver), {}, 20000), [AUTO_ID]));
}

/* ----------------------- 3. the merge gate, in the app --------------------- */
console.log("--- 3. merge gate (real app, network stubbed) ---");
const prefix = (fs.readFileSync("src/config.jsx", "utf8").match(/STORAGE_PREFIX\s*=\s*"([^"]+)"/) || [])[1];
ok("storage prefix found in src/config.jsx", Boolean(prefix));
if (!prefix) done();

const BUNDLE = "/tmp/test-steps-autotick-bundle.js";
execSync(`npx esbuild src/entry.jsx --bundle --outfile=${BUNDLE} --loader:.jsx=jsx --log-level=error`);
const bundle = fs.readFileSync(BUNDLE, "utf8");

const UID = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";
const today = new Date();
const K = (n) => dateKey(addDays(today, -n));
const jwt = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const session = {
  access_token: `x.${jwt({ sub: UID, exp, email: "t@example.com", role: "authenticated" })}.y`,
  token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r1",
  user: { id: UID, email: "t@example.com", aud: "authenticated", role: "authenticated" },
};
// Version without auto for everything up to 4 days ago; the auto version from 3 days ago.
const rows = [
  { id: "v-old", assigned_to: UID, effective_from: "-infinity", name: "old", definition: COMPILED },
  { id: "v-auto", assigned_to: UID, effective_from: K(3), name: "auto", definition: AUTO_DEF },
];
const wearDays = [
  { user_id: UID, vendor: "oura", day: K(0), steps: 12000 },          // ticks, on top of the cloud day
  { user_id: UID, vendor: "oura", day: K(1), steps: 20000 },          // ticks, no cloud day
  { user_id: UID, vendor: "oura", day: K(2), steps: 20000 },          // manual un-tick in the cloud: stays
  { user_id: UID, vendor: "oura", day: K(3), steps: 5000 },           // below min
  { user_id: OTHER, vendor: "oura", day: K(3), steps: 50000 },        // someone else's row: ignored
  { user_id: UID, vendor: "oura", day: K(4), steps: 20000 },          // version without auto
];
const cloudLog = {
  [K(0)]: { done: { "cloud-tick": true }, notes: "From the other phone", numbers: { "cloud-num": 7 } },
  [K(2)]: { done: { [AUTO_ID]: false } },
};

async function boot({ pullFails }) {
  const dom = new JSDOM(`<!DOCTYPE html><div id="root"></div>`, {
    url: "https://yellowg-dev.github.io/Test-PTapp/", runScripts: "outside-only", pretendToBeVisual: true,
  });
  const w = dom.window;
  const calls = [];
  w.fetch = async (url, opt = {}) => {
    const u = String(url);
    const method = (opt.method || "GET").toUpperCase();
    calls.push({ u, method, body: opt.body ? String(opt.body) : null });
    let status = 200, json = [];
    if (u.includes("/rest/v1/day_logs") && method === "GET") {
      if (pullFails) { status = 500; json = { message: "stubbed failure", code: "XX000" }; }
      else json = Object.entries(cloudLog).map(([d, payload]) => ({ day: d, payload }));
    } else if (u.includes("/rest/v1/user_settings")) json = pullFails ? [] : null;
    else if (u.includes("/rest/v1/wearable_connections")) json = [{ user_id: UID, vendor: "oura", status: "active", connected_at: null, last_synced_at: new Date().toISOString() }];
    else if (u.includes("/rest/v1/wearable_days")) json = wearDays;
    else if (u.includes("/functions/v1/")) json = { ok: true };
    const text = JSON.stringify(json);
    return { ok: status < 300, status, statusText: status < 300 ? "OK" : "Error", headers: { get: (h) => (/content-type/i.test(h) ? "application/json" : null) }, json: async () => json, text: async () => text };
  };
  w.localStorage.setItem(prefix + "auth", JSON.stringify(session));
  w.localStorage.setItem(prefix + "programsV2", JSON.stringify({ rows, fetchedAt: new Date().toISOString(), userId: UID }));
  w.eval(bundle);
  await wait(4500); // past the 2.5 s upload debounce
  const log = () => JSON.parse(w.localStorage.getItem(prefix + "log") || "{}");
  const pending = () => JSON.parse(w.localStorage.getItem(prefix + "syncPending") || "{}");
  const uploads = () => calls.filter((c) => c.u.includes("/rest/v1/day_logs") && c.method === "POST");
  return { w, calls, log, pending, uploads, close: () => w.close() };
}

{
  const a = await boot({ pullFails: true });
  ok("the stubbed session signed the app in (wearables were read)", () => a.calls.some((c) => c.u.includes("/rest/v1/wearable_days")));
  ok("the stubbed pull failed", () => a.calls.some((c) => c.u.includes("/rest/v1/day_logs") && c.method === "GET"));
  ok("pull failed: no tick written to the local log", () => {
    const l = a.log();
    for (const k of [K(0), K(1), K(2), K(3), K(4)]) assert.equal(l[k]?.done?.[AUTO_ID], undefined, k);
  });
  ok("pull failed: nothing queued for upload", () => assert.deepEqual(Object.keys(a.pending().logs || {}), []));
  ok("pull failed: nothing uploaded", () => assert.equal(a.uploads().length, 0));
  a.close();
}
{
  const a = await boot({ pullFails: false });
  const l = a.log();
  ok("merged: today's tick lands on the cloud day", () => assert.equal(l[K(0)]?.done?.[AUTO_ID], true));
  ok("merged: the cloud day's other fields survive", () => {
    assert.equal(l[K(0)].done["cloud-tick"], true);
    assert.equal(l[K(0)].notes, "From the other phone");
    assert.equal(l[K(0)].numbers["cloud-num"], 7);
  });
  ok("merged: a day with no cloud record is ticked", () => assert.equal(l[K(1)]?.done?.[AUTO_ID], true));
  ok("merged: a manual un-tick from the cloud stays un-ticked at 20,000 steps", () => assert.equal(l[K(2)]?.done?.[AUTO_ID], false));
  ok("merged: below min is not ticked (and another person's 50,000 is ignored)", () => assert.equal(l[K(3)]?.done?.[AUTO_ID], undefined));
  ok("merged: a day on the version without auto is not ticked at 20,000", () => assert.equal(l[K(4)]?.done?.[AUTO_ID], undefined));
  ok("merged: the ticked days were uploaded, carrying the cloud fields", () => {
    const bodies = a.uploads().map((c) => c.body).join("\n");
    assert.ok(bodies.includes(K(0)) && bodies.includes(K(1)), "both ticked days uploaded");
    assert.ok(bodies.includes("From the other phone"), "today's upload kept the cloud note");
    assert.ok(!bodies.includes(K(2)) && !bodies.includes(K(4)), "untouched days not uploaded");
  });
  ok("display: the steps line reads presc · count / target", () =>
    assert.match(a.w.document.body.textContent, /· 12,000 \/ 10,000 steps/));
  a.close();
}

done();
