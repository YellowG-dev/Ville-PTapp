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
 * This person's own rows. RLS limits them to their own; no user filter is sent
 * from here, exactly as in the coach app, so one policy governs both.
 */
export async function loadWearables() {
  const c = getClient();
  if (!c || !isConfigured()) return { ok: false, connections: [], days: [], workouts: [] };

  const since = new Date();
  since.setDate(since.getDate() - WINDOW_DAYS);
  const sinceKey = since.toISOString().slice(0, 10);

  try {
    const [connections, days, workouts] = await Promise.all([
      c.from("wearable_connections").select("vendor, status, connected_at, last_synced_at"),
      c
        .from("wearable_days")
        .select("vendor, day, sleep_minutes, readiness, resting_hr, hrv, steps")
        .gte("day", sinceKey)
        .order("day", { ascending: false }),
      c
        .from("wearable_workouts")
        .select("vendor, day, sport, source, started_at, duration_minutes, distance_km, hr_avg, hr_max")
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

// Oura logs housework and walking as "workouts". Only what it recorded with
// heart rate, or what was entered by hand, is a session someone chose to do.
// Polar rows have no source field and are all real sessions.
export function isRealSession(w) {
  if (!w) return false;
  if (w.vendor === "oura") return w.source === "workout_heart_rate" || w.source === "manual";
  return true;
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
 */
export function buildRecovery(days, workouts) {
  const rows = [...(days || [])].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  if (!rows.length && !(workouts || []).length) return null;

  // The newest row with an actual night in it: today's row exists from midnight
  // with steps only, and showing that as "last night" would read as a lost night.
  const latest = rows.find((r) => r.sleep_minutes != null || r.readiness != null) || null;
  const last7 = rows.slice(0, 7);

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
