// Wearables: connecting Oura or Polar, pulling what they recorded, and turning
// it into the few numbers worth showing.
//
// Nothing here writes to the log. Imported data sits beside what you typed, it
// never replaces it — if you logged 12.4 km and the watch says 12.38, yours
// stands. The app's own log stays the single record of what was done.
//
// Two things behave differently from the rest of the app, both deliberate.
//
// This module needs a connection. Everything else works in a gym basement with
// no signal; a wearable reading that isn't on the device yet simply isn't
// available, so these calls fail quietly and the UI says so rather than
// pretending.
//
// And connecting leaves the app. Tapping Connect sends you to Oura or Polar to
// approve access, and on an installed iOS app that opens in Safari — a separate
// browser with separate storage, which is the same trap the magic link fell
// into. It works here because nothing has to come back into this app: the
// server stores the tokens against your account, and the app simply re-reads
// its connection status the next time it opens.

import { getClient, isConfigured } from "./supabase.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.jsx";
import { isRealSession } from "./cardio.js";

const WINDOW_DAYS = 120;

async function callFunction(name, body) {
  const c = getClient();
  if (!c) return { ok: false, error: "This build is not connected to an account." };
  try {
    const { data } = await c.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return { ok: false, error: "Sign in first." };

    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) return { ok: false, error: json.error || `Server said ${res.status}.` };
    return { ok: true, ...json };
  } catch (e) {
    return { ok: false, error: "No connection." };
  }
}

/** Where to send the person to approve access. The caller navigates there. */
export async function connectUrl(vendor) {
  return await callFunction("wearable-connect", { vendor });
}

/** Fetch recent data from a vendor. Safe to call on every app open. */
export async function syncVendor(vendor, days = 14) {
  return await callFunction("wearable-sync", { vendor, days });
}

/**
 * One named person's rows. The query must name them.
 *
 * RLS is a backstop, not a filter. The policy on all three wearable tables is
 * `(user_id = auth.uid()) OR is_coach_of(user_id)`, and the coach signs in to
 * his own client app like anyone else — so his session satisfies the second
 * branch and the server hands back every client's rows alongside his own. An
 * unfiltered query here showed him Henna's sleep as his own. The policy is
 * correct and the coach dashboard depends on it; the query is what was wrong.
 *
 * So: no id, no query. A missing id must never widen the result to everyone
 * the signed-in person happens to coach.
 */
export async function loadWearables(userId) {
  const c = getClient();
  if (!c || !isConfigured()) return { ok: false, connections: [], days: [], workouts: [] };
  if (!userId) return { ok: false, connections: [], days: [], workouts: [] };

  const since = new Date();
  since.setDate(since.getDate() - WINDOW_DAYS);
  const sinceKey = since.toISOString().slice(0, 10);

  try {
    const [connections, days, workouts] = await Promise.all([
      c
        .from("wearable_connections")
        .select("user_id, vendor, status, connected_at, last_synced_at")
        .eq("user_id", userId),
      c
        .from("wearable_days")
        .select("user_id, vendor, day, sleep_minutes, readiness, resting_hr, hrv, steps")
        .eq("user_id", userId)
        .gte("day", sinceKey)
        .order("day", { ascending: false }),
      c
        .from("wearable_workouts")
        .select("user_id, vendor, day, sport, source, started_at, duration_minutes, distance_km, hr_avg, hr_max")
        .eq("user_id", userId)
        .gte("day", sinceKey)
        .order("started_at", { ascending: false }),
    ]);

    if (connections.error || days.error || workouts.error) {
      return { ok: false, connections: [], days: [], workouts: [] };
    }
    return {
      ok: true,
      connections: connections.data || [],
      days: days.data || [],
      workouts: workouts.data || [],
    };
  } catch (e) {
    return { ok: false, connections: [], days: [], workouts: [] };
  }
}

/* ------------------------------- shaping --------------------------------- */

// Moved to cardio.js (Step 9 Phase 2) so it can be tested in plain node
// without pulling in this file's supabase.js/config.jsx imports. Re-exported
// so every existing importer of isRealSession from here keeps working.
export { isRealSession };

/**
 * Which row wins when one day carries more than one.
 *
 * A person can hold two rows for the same day as soon as a second vendor maps:
 * Oura and Polar both report sleep and readiness. Oura is preferred because it
 * is the sleep source — the ring is worn for the night, and readiness is an
 * Oura score with no Polar equivalent. Polar is kept as the fallback for a day
 * Oura did not record.
 *
 * Written as data, not as a chain of ifs, so a third vendor is one entry here
 * rather than a new branch in the collapse. A vendor missing from this list
 * sorts after every listed one.
 */
export const VENDOR_PREFERENCE = ["oura", "polar"];

function vendorRank(vendor) {
  const i = VENDOR_PREFERENCE.indexOf(vendor);
  return i === -1 ? VENDOR_PREFERENCE.length : i;
}

// Lower sorts first. Whose row it is outranks which vendor it came from: see
// collapseDays for why that first term exists at all.
function dayRowRank(row, subjectId) {
  const foreign = subjectId != null && row.user_id != null && row.user_id !== subjectId;
  return [foreign ? 1 : 0, vendorRank(row.vendor)];
}

function outranks(a, b, subjectId) {
  const ra = dayRowRank(a, subjectId);
  const rb = dayRowRank(b, subjectId);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i];
  return false; // equal rank: the row already held keeps the day
}

/**
 * One row per day, newest day first.
 *
 * `subjectId` is defence in depth and nothing more. loadWearables now names the
 * person in every query, so a row belonging to somebody else should not reach
 * here at all. If one ever does — a widened query, a changed policy — the
 * subject's own row must still keep its day rather than losing it to whichever
 * vendor happened to rank higher. Omitted, the vendor preference decides alone,
 * which is the right answer for rows already known to be one person's.
 */
export function collapseDays(days, subjectId = null) {
  const best = new Map();
  (days || []).forEach((r) => {
    if (!r || !r.day) return;
    const held = best.get(r.day);
    if (!held || outranks(r, held, subjectId)) best.set(r.day, r);
  });
  return [...best.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

function mean(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => v != null).map(Number).filter((v) => !isNaN(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function fmtSleep(minutes) {
  if (minutes == null) return "—";
  const m = Math.round(Number(minutes));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function fmtNum(v, digits = 0) {
  if (v == null) return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  return digits ? n.toFixed(digits) : String(Math.round(n));
}

/**
 * The recovery picture. A night with no reading stays empty — never a zero and
 * never guessed from the nights either side of it.
 *
 * `days` is collapsed to one row per day first, so every slice and average
 * below counts DAYS. Before that, `avg7` averaged seven array entries: with two
 * vendors that is three and a half days, and with a coach's unfiltered query it
 * was roughly two days spread across three different bodies.
 */
export function buildRecovery(days, workouts, subjectId = null) {
  const rows = collapseDays(days, subjectId);
  if (!rows.length && !(workouts || []).length) return null;

  // The newest row with an actual night in it: today's row exists from midnight
  // with steps only, and showing that as "last night" would read as a lost night.
  const latest = rows.find((r) => r.sleep_minutes != null || r.readiness != null) || null;
  const last7 = rows.slice(0, 7); // seven distinct days, post-collapse

  const series = rows
    .slice(0, 30)
    .reverse()
    .map((r) => ({
      day: r.day,
      label: r.day.slice(8) + "." + r.day.slice(5, 7),
      sleepH: r.sleep_minutes != null ? Math.round((Number(r.sleep_minutes) / 60) * 10) / 10 : null,
      readiness: r.readiness != null ? Number(r.readiness) : null,
      hrv: r.hrv != null ? Number(r.hrv) : null,
      rhr: r.resting_hr != null ? Number(r.resting_hr) : null,
    }));

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  const recent = (workouts || []).filter(isRealSession).filter((w) => w.day >= cutoffKey);

  return {
    latest,
    series,
    avg7: {
      sleep: mean(last7, "sleep_minutes"),
      readiness: mean(last7, "readiness"),
      rhr: mean(last7, "resting_hr"),
      hrv: mean(last7, "hrv"),
    },
    nights: rows.filter((r) => r.sleep_minutes != null).length,
    sessions30: recent.length,
    sessionMinutes30: Math.round(recent.reduce((a, w) => a + Number(w.duration_minutes || 0), 0)),
  };
}

/** How a connection should read. "Connected" and "synced" are not the same. */
export function connectionLabel(conn) {
  if (!conn) return "not connected";
  if (conn.status === "needs_reauth") return "needs reconnecting";
  if (conn.status === "error") return "problem syncing";
  if (!conn.last_synced_at) return "connected";
  const hours = (Date.now() - Date.parse(conn.last_synced_at)) / 3600000;
  if (hours < 1) return "up to date";
  if (hours < 48) return `synced ${Math.round(hours)}h ago`;
  return `synced ${Math.round(hours / 24)}d ago`;
}
