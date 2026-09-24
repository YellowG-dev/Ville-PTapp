// verify-wearables.mjs — checks the wearable shaping rules that the UI relies on.
// Run from a client repo root:  node verify-wearables.mjs
//
// Deliberately offline: it imports nothing that needs a network or a session,
// and tests only the pure functions. The parts that talk to Supabase are proven
// by connecting a real account, not by a stub that agrees with itself.

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

const SRC = "src/core/wearables.js";
const TMP = "./.verify-wearables.tmp.mjs";

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
}

// Strip the two imports that need the app around them; everything tested below
// is pure and does not touch them.
let src;
try {
  src = readFileSync(SRC, "utf8");
} catch {
  console.log(`Cannot read ${SRC} — run this from the repo root.`);
  process.exit(1);
}
const stripped = src
  .replace(/import \{ getClient, isConfigured \} from "\.\/supabase\.js";/, "const getClient = () => null; const isConfigured = () => false;")
  .replace(/import \{ SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY \} from "\.\.\/config\.jsx";/, 'const SUPABASE_URL = "x"; const SUPABASE_PUBLISHABLE_KEY = "y";');
if (stripped === src) {
  console.log("Import lines did not match — wearables.js has changed shape. Update this script.");
  process.exit(1);
}
writeFileSync(TMP, stripped);
const W = await import(TMP);
unlinkSync(TMP);

/* --- what counts as a session ------------------------------------------- */
// Oura files walking and housework as workouts. Counting them as training
// would have shown 385 sessions where there were 54 on one real account.
check("oura auto-detected is not a session", W.isRealSession({ vendor: "oura", source: "confirmed" }), false);
check("oura heart-rate workout is a session", W.isRealSession({ vendor: "oura", source: "workout_heart_rate" }), true);
check("oura manual entry is a session", W.isRealSession({ vendor: "oura", source: "manual" }), true);
check("polar rows are sessions", W.isRealSession({ vendor: "polar", source: null }), true);
check("nothing is not a session", W.isRealSession(null), false);

/* --- formatting ---------------------------------------------------------- */
check("sleep formats as hours and minutes", W.fmtSleep(361), "6h 01m");
check("missing sleep is a dash", W.fmtSleep(null), "—");
check("missing number is a dash", W.fmtNum(null), "—");
check("numbers round", W.fmtNum(48.6), "49");

/* --- recovery ------------------------------------------------------------ */
const days = [
  { day: "2026-09-24", steps: 900 },                                               // today, no night yet
  { day: "2026-09-23", sleep_minutes: 361, readiness: 82, resting_hr: 51, hrv: 48 },
  { day: "2026-09-22", sleep_minutes: 403, readiness: 57, resting_hr: 59, hrv: 29 },
];
const workouts = [
  { vendor: "oura", source: "confirmed", sport: "houseWork", day: "2026-09-23", duration_minutes: 20 },
  { vendor: "oura", source: "workout_heart_rate", sport: "strengthTraining", day: "2026-09-23", duration_minutes: 75 },
];
const r = W.buildRecovery(days, workouts);

// Today's row exists from midnight with steps only; showing it as last night
// would read as a night with no sleep.
check("last night skips a row with no sleep", r.latest.day, "2026-09-23");
check("only real sessions counted", r.sessions30, 1);
check("session minutes exclude housework", r.sessionMinutes30, 75);
check("nights counts nights with sleep", r.nights, 2);
// A night with no reading must stay empty. A zero here would read as a
// sleepless night, which is a different and alarming claim.
check("missing night stays null", r.series.find((p) => p.day === "2026-09-24").sleepH, null);
check("no data at all gives nothing to render", W.buildRecovery([], []), null);

/* --- connection labels --------------------------------------------------- */
check("no connection", W.connectionLabel(null), "not connected");
check("connected but never synced", W.connectionLabel({ status: "connected" }), "connected");
check("expired authorisation", W.connectionLabel({ status: "needs_reauth" }), "needs reconnecting");
check("fresh sync", W.connectionLabel({ status: "connected", last_synced_at: new Date().toISOString() }), "up to date");

console.log(`\nverify-wearables: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
