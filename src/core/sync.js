// Sync — keeps the local log and the Supabase copy in step.
//
// THE RULE THAT GOVERNS THIS FILE:
//   localStorage is the truth. Supabase is a replica.
// A failed network call must never block a checkbox, lose a set, or throw.
// Every function here swallows its errors on purpose.
//
// WRITES are per day. The app rewrites its whole log object on every tap,
// which is free locally and ruinous over a gym's signal, so only the day that
// actually changed is sent — about 600 bytes instead of the entire history.
//
// CONFLICTS are last-write-wins, per day, as agreed. Two devices editing
// DIFFERENT days never collide at all. Two devices editing the SAME day: the
// later write wins for that one day, and nothing else is touched.
//
// "Which side is newer?" is answered without timestamps, by the PENDING set:
// a day sits in pending from the moment it is changed locally until the
// server confirms it. So on pulling down:
//     day is pending  -> local is ahead, local wins, and we push it
//     day is not      -> the server copy is at least as new, server wins

import { getClient } from "./supabase.js";

const PENDING_KEY = "syncPending";
const DEBOUNCE_MS = 2500;

let store = null;      // the app's store, for persisting the pending queue
let userId = null;     // null = signed out = sync disabled
let timer = null;
let listener = null;

// Pending changes waiting to reach the server. Persisted, so a session logged
// in a basement survives the app being closed.
let pending = { logs: {}, overrides: {}, settings: null };

let state = { status: "idle", lastSyncedAt: null, error: null };

function announce() {
  if (listener) { try { listener({ ...state, pendingCount: countPending() }); } catch (e) {} }
}

function countPending() {
  return Object.keys(pending.logs).length
       + Object.keys(pending.overrides).length
       + (pending.settings ? 1 : 0);
}

async function savePending() {
  if (!store) return;
  try { await store.saveJSON(PENDING_KEY, pending); } catch (e) {}
}

/* ----------------------------- pure merge logic ---------------------------- */
/* Exported so it can be tested on its own, without a network or a database.  */

/**
 * Combine what is on this device with what came down from the server.
 * `pendingDays` are the days this device knows it has not yet uploaded.
 */
export function mergeByDay(local, remote, pendingDays) {
  const merged = { ...(remote || {}) };
  const localDays = local || {};
  for (const day of Object.keys(localDays)) {
    const localIsAhead = pendingDays.has(day) || !(day in merged);
    if (localIsAhead) merged[day] = localDays[day];
  }
  return merged;
}

/* -------------------------------- lifecycle -------------------------------- */

/** Called once at startup, and again whenever the signed-in user changes. */
export async function configureSync({ store: s, userId: uid, onStateChange }) {
  store = s || store;
  listener = onStateChange || listener;
  userId = uid || null;

  if (store) {
    const saved = await store.loadJSON(PENDING_KEY, null);
    if (saved && typeof saved === "object") {
      pending = {
        logs: saved.logs || {},
        overrides: saved.overrides || {},
        settings: saved.settings || null,
      };
    }
  }
  state = { ...state, status: userId ? "idle" : "offline" };
  announce();
}

export function isSyncing() {
  return Boolean(userId && getClient());
}

/* ---------------------------------- pull ----------------------------------- */

/**
 * Fetch everything for this user and merge it with what is on the device.
 * Returns the merged { log, overrides, settings } — or null if sync is off or
 * the fetch failed, in which case the caller keeps its local data untouched.
 *
 * THE DANGEROUS CASE, handled explicitly: a device whose storage was wiped
 * has an empty local log. It must NOT conclude the user has no history and
 * push emptiness upward. Because nothing is pending, every server day simply
 * wins, and the wiped device is refilled. Emptiness is never uploaded.
 */
export async function pullAndMerge(localData) {
  const c = getClient();
  if (!c || !userId) return null;

  state = { ...state, status: "syncing", error: null };
  announce();

  try {
    const [logRes, ovRes, setRes] = await Promise.all([
      c.from("day_logs").select("day,payload").eq("user_id", userId),
      c.from("day_overrides").select("day,payload").eq("user_id", userId),
      c.from("user_settings").select("settings").eq("user_id", userId).maybeSingle(),
    ]);

    if (logRes.error || ovRes.error || setRes.error) {
      const err = logRes.error || ovRes.error || setRes.error;
      state = { ...state, status: "error", error: err.message };
      announce();
      return null;
    }

    const remoteLog = {};
    (logRes.data || []).forEach((row) => { remoteLog[row.day] = row.payload; });

    const remoteOverrides = {};
    (ovRes.data || []).forEach((row) => { remoteOverrides[row.day] = row.payload; });

    const pendingLogDays = new Set(Object.keys(pending.logs));
    const pendingOvDays = new Set(Object.keys(pending.overrides));

    const merged = {
      log: mergeByDay(localData.log, remoteLog, pendingLogDays),
      overrides: mergeByDay(localData.overrides, remoteOverrides, pendingOvDays),
      settings: pending.settings
        ? localData.settings
        : (setRes.data?.settings || localData.settings),
    };

    // Any local day the server had never seen is now queued to go up.
    for (const day of Object.keys(localData.log || {})) {
      if (!(day in remoteLog)) pending.logs[day] = localData.log[day];
    }
    for (const day of Object.keys(localData.overrides || {})) {
      if (!(day in remoteOverrides)) pending.overrides[day] = localData.overrides[day];
    }
    await savePending();

    state = { ...state, status: "ok", lastSyncedAt: new Date().toISOString() };
    announce();

    flushSoon();
    return merged;
  } catch (e) {
    state = { ...state, status: "error", error: "offline" };
    announce();
    return null;
  }
}

/* ---------------------------------- push ----------------------------------- */

/** Queue one day's log. Called from persist(), which already knows the day. */
export function queueLogDay(day, record) {
  pending.logs[day] = record;
  savePending();
  announce();
  flushSoon();
}

/** Queue whichever override days actually changed between two versions. */
export function queueOverrideChanges(prev, next) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  for (const day of keys) {
    const before = JSON.stringify((prev || {})[day]);
    const after = JSON.stringify((next || {})[day]);
    if (before !== after) pending.overrides[day] = (next || {})[day] ?? null;
  }
  savePending();
  announce();
  flushSoon();
}

export function queueSettings(settings) {
  pending.settings = settings;
  savePending();
  announce();
  flushSoon();
}

function flushSoon() {
  clearTimeout(timer);
  timer = setTimeout(() => { flushNow(); }, DEBOUNCE_MS);
}

/**
 * Send everything queued. Anything that fails stays queued and goes again on
 * the next attempt, so a workout logged with no signal lands later.
 */
export async function flushNow() {
  const c = getClient();
  if (!c || !userId) return;
  if (countPending() === 0) return;

  state = { ...state, status: "syncing" };
  announce();

  const logDays = Object.keys(pending.logs);
  const ovDays = Object.keys(pending.overrides);

  try {
    if (logDays.length) {
      const rows = logDays.map((day) => ({ user_id: userId, day, payload: pending.logs[day] || {} }));
      const { error } = await c.from("day_logs").upsert(rows, { onConflict: "user_id,day" });
      if (!error) logDays.forEach((d) => delete pending.logs[d]);
    }

    if (ovDays.length) {
      const toDelete = ovDays.filter((d) => pending.overrides[d] == null);
      const toUpsert = ovDays.filter((d) => pending.overrides[d] != null);

      if (toUpsert.length) {
        const rows = toUpsert.map((day) => ({ user_id: userId, day, payload: pending.overrides[day] }));
        const { error } = await c.from("day_overrides").upsert(rows, { onConflict: "user_id,day" });
        if (!error) toUpsert.forEach((d) => delete pending.overrides[d]);
      }
      if (toDelete.length) {
        const { error } = await c.from("day_overrides").delete().eq("user_id", userId).in("day", toDelete);
        if (!error) toDelete.forEach((d) => delete pending.overrides[d]);
      }
    }

    if (pending.settings) {
      const { error } = await c.from("user_settings")
        .upsert({ user_id: userId, settings: pending.settings }, { onConflict: "user_id" });
      if (!error) pending.settings = null;
    }

    await savePending();
    state = {
      status: countPending() === 0 ? "ok" : "error",
      lastSyncedAt: new Date().toISOString(),
      error: countPending() === 0 ? null : "some changes still waiting",
    };
    announce();
  } catch (e) {
    state = { ...state, status: "error", error: "offline" };
    announce();
    await savePending();
  }
}

/** Try again when the device comes back online. */
export function watchConnectivity() {
  if (typeof window === "undefined") return () => {};
  const onOnline = () => flushNow();
  window.addEventListener("online", onOnline);
  return () => window.removeEventListener("online", onOnline);
}
