// cardio.js — pure logic for repeatable cardio: matching wearable workouts to
// a planned session, HR zones, pace, and the weekly minutes total.
//
// No React, no Supabase, no Date.now() without an injectable clock — every
// date-bearing function below takes the date(s) it needs as an argument, the
// same convention engine.js uses. Safe to import and test under plain node.
//
// isRealSession lives here rather than in wearables.js because wearables.js
// imports supabase.js and config.jsx, which would make this file untestable
// in plain node the moment it imported wearables.js back. wearables.js
// re-exports isRealSession so nothing that already imports it from there
// breaks.

import { dateKey } from "./dates.js";
import { resolveSchedule } from "./engine.js";
import { blocksFor, STANDARD_SLOTS, NON_CARDIO_SLOTS } from "./program-schema.js";

/* ------------------------------ recorded ----------------------------------- */

// Oura logs housework and walking as "workouts". A session counts when the
// client started or entered it (workout_heart_rate, manual), or when Oura
// detected it and the client accepted it ("confirmed") AND it is a real sport.
// Set by John on 29 Sep 2026: these sports never count, and a confirmed walk
// counts only from 30 minutes. Autodetected rows the client has not accepted
// never count. Polar rows have no source field and are all real sessions.
export const OURA_EXCLUDED_SPORTS = ["houseWork", "yardwork", "stretching", "other"];
export const OURA_WALK_MIN_MINUTES = 30;

export function isRealSession(w) {
  if (!w) return false;
  if (w.vendor !== "oura") return true;
  if (w.source === "workout_heart_rate" || w.source === "manual") return true;
  if (w.source !== "confirmed") return false;
  if (OURA_EXCLUDED_SPORTS.includes(w.sport)) return false;
  if (w.sport === "walking") return Number(w.duration_minutes) >= OURA_WALK_MIN_MINUTES;
  return true;
}

// Strength and yoga are the two slots that are logged but are not cardio
// (decided 1 Oct 2026; the list lives in program-schema.js with the slot
// catalogue). A recorded workout whose sport belongs to one of them never
// reaches `planned` or `extras`: matchDay returns it in `nonCardio`, and a
// confirmed one never adds to the weekly cardio minutes.
//
// STRENGTH_SPORTS and isStrengthWorkout predate the generalisation (Phase 5b)
// and stay exported for one release.
export const STRENGTH_SPORTS = ["strengthTraining"];

export function isStrengthWorkout(w) {
  return Boolean(w) && STRENGTH_SPORTS.includes(w.sport);
}

/** The non-cardio slot a watch sport belongs to ("strength" or "yoga"), or null. */
export function nonCardioSlotFor(sport) {
  const s = STANDARD_SLOTS.find((ss) => NON_CARDIO_SLOTS.includes(ss.id) && ss.sports.includes(sport));
  return s ? s.id : null;
}

/**
 * Did the day's PLANNED slots change? True when a slot was moved or cleared,
 * or the day is a skip day. Extras (manual or from the watch) never count —
 * they add to a day, they do not rearrange it. Drives the "Rearranged" badge
 * and the Calendar's dashed day border.
 */
export function plannedChanged(info) {
  if (!info) return false;
  return Object.values(info.moved || {}).some(Boolean) || Boolean(info.skip);
}

/**
 * Subtitle for the "Extra Activity" section, by where the extras came from:
 * all from the watch → "From your watch"; all manual (or legacy entries with
 * no `source`) → "Added from Calendar"; a mix → "From Calendar and your watch".
 */
export function extrasSubtitle(activities) {
  const list = activities || [];
  const watch = list.filter((a) => a && a.source === "wearable").length;
  if (watch === 0) return "Added from Calendar";
  if (watch === list.length) return "From your watch";
  return "From Calendar and your watch";
}

/** Workouts a client actually chose to do — the autodetected noise filtered out. */
export function recordedWorkouts(workouts) {
  return (workouts || []).filter(isRealSession);
}

/* ------------------------------- dedupe ------------------------------------- */

// The same session synced from two vendors is one session, not two. Polar is
// kept over Oura — decided 28 Sep 2026 — the opposite of the sleep-data
// preference in wearables.js, which is a different question (whose reading of
// the SAME night is more trustworthy) answered the other way.
const WORKOUT_VENDOR_PREFERENCE = ["polar", "oura"];

function workoutVendorRank(vendor) {
  const i = WORKOUT_VENDOR_PREFERENCE.indexOf(vendor);
  return i === -1 ? WORKOUT_VENDOR_PREFERENCE.length : i;
}

function windowOf(w) {
  const start = Date.parse(w.started_at);
  if (isNaN(start)) return null;
  const end = start + Math.max(0, Number(w.duration_minutes) || 0) * 60000;
  return { start, end };
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

/**
 * Collapse same-day, overlapping-time-window workouts to one. A workout with
 * no parseable `started_at` cannot be compared and is kept as its own entry.
 */
export function dedupe(workouts) {
  const kept = [];
  for (const w of workouts || []) {
    const win = windowOf(w);
    let mergedInto = -1;
    if (win) {
      for (let i = 0; i < kept.length; i++) {
        if (kept[i].day !== w.day) continue;
        const kw = windowOf(kept[i]);
        if (kw && overlaps(win, kw)) { mergedInto = i; break; }
      }
    }
    if (mergedInto === -1) kept.push(w);
    else if (workoutVendorRank(w.vendor) < workoutVendorRank(kept[mergedInto].vendor)) kept[mergedInto] = w;
  }
  return kept;
}

/* -------------------------------- matching ---------------------------------- */

/**
 * One day's wearable workouts, sorted into a match for a planned cardio slot,
 * an extra, or `nonCardio` (strength and yoga, never cardio), with anything the client has already dismissed or confirmed removed.
 *
 * `info` is a resolveSchedule() result for `date` — the caller already has
 * one for most callers, and computing it again here would risk it disagreeing
 * with what the screen shows. Sport -> slot goes through `cardioTypes[].slot`;
 * a sport with no matching type, or whose type has no `slot`, is extras-only.
 *
 * @returns {{ planned: Record<string, object>, extras: object[], nonCardio: { workout: object, slot: string }[] }}
 */
export function matchDay(date, info, workouts, program, overrides) {
  const dayKey = dateKey(date);
  const ov = (overrides && overrides[dayKey]) || {};
  const dismissed = new Set(Array.isArray(ov.dismissedWorkouts) ? ov.dismissedWorkouts : []);
  const confirmed = new Set(
    (Array.isArray(ov.activities) ? ov.activities : [])
      .filter((a) => a && a.source === "wearable" && a.workout)
      .map((a) => `${a.workout.vendor}:${a.workout.vendorSessionId}`)
  );

  const cardioTypes = Array.isArray(program && program.cardioTypes) ? program.cardioTypes : [];
  const slotForSport = (sport) => {
    const t = cardioTypes.find((ct) => ct.slot && Array.isArray(ct.sports) && ct.sports.includes(sport));
    return t ? t.slot : null;
  };
  const scheduled = (info && info.slots) || {};

  const planned = {};
  const extras = [];
  const nonCardio = [];
  for (const w of dedupe(recordedWorkouts(workouts)).filter((w) => w.day === dayKey)) {
    const key = `${w.vendor}:${w.vendor_session_id}`;
    if (dismissed.has(key) || confirmed.has(key)) continue;
    const ncSlot = nonCardioSlotFor(w.sport);
    if (ncSlot) { nonCardio.push({ workout: w, slot: ncSlot }); continue; }
    const slot = slotForSport(w.sport);
    if (slot && scheduled[slot] && !planned[slot]) planned[slot] = w;
    else extras.push(w);
  }
  return { planned, extras, nonCardio };
}

/* --------------------------------- zones ------------------------------------ */

/** `{ lo, hi }` bpm for a zone id, or null (no max HR, no zone table, unknown id). */
export function zoneBpm(zoneId, hrMax, program) {
  if (!hrMax || !zoneId) return null;
  const zones = Array.isArray(program && program.hrZones) ? program.hrZones : [];
  const z = zones.find((zz) => zz.id === zoneId);
  if (!z) return null;
  return { lo: Math.round((hrMax * z.pctMin) / 100), hi: Math.round((hrMax * z.pctMax) / 100) };
}

/* ---------------------------------- pace ------------------------------------- */

/** "m:ss" per km, or null. Pace is never stored for a result — target only. */
export function pace(durationMin, distanceKm) {
  if (typeof durationMin !== "number" || typeof distanceKm !== "number") return null;
  if (!(durationMin > 0) || !(distanceKm > 0)) return null;
  const totalSeconds = Math.round((durationMin / distanceKm) * 60);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ------------------------------ weekly total --------------------------------- */

/** False for a strength or yoga extra; true for everything else, including legacy `{ id, name }` entries. */
export function isCardioActivity(a) {
  return Boolean(a) && !NON_CARDIO_SLOTS.includes(a.kind);
}

/**
 * Confirmed cardio minutes for the 7 days starting `weekStart`: planned
 * cardio sessions' logged duration, plus confirmed cardio extras. A planned
 * strength or yoga block adds nothing, and neither does a non-cardio extra
 * (`kind: "strength"` or `"yoga"`).
 *
 * A planned block counts only through its OWN declared `cardio.durationTaskId`
 * — never guessed from an id pattern — read from `log[day].numbers`. No task
 * declared, or nothing logged under it, counts 0; never estimate. Each day is
 * scored against the programme in force on that day (`programOrResolver` may
 * be a resolver), so a week that crosses a version boundary still adds up
 * correctly.
 */
export function weeklyCardioMinutes(weekStart, log, overrides, programOrResolver) {
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const program = typeof programOrResolver === "function" ? programOrResolver(d) : programOrResolver;
    const info = resolveSchedule(d, "auto", overrides, program);
    const dayKey = dateKey(d);
    const rec = (log && log[dayKey]) || {};

    for (const slot of program.slots || []) {
      if (NON_CARDIO_SLOTS.includes(slot)) continue;
      const blockValue = info.slots[slot];
      if (!blockValue) continue;
      const block = blocksFor(program, slot)[blockValue];
      const taskId = block && block.cardio && block.cardio.durationTaskId;
      if (!taskId) continue;
      const minutes = rec.numbers && rec.numbers[taskId];
      if (typeof minutes === "number") total += minutes;
    }

    const activities = Array.isArray((overrides && overrides[dayKey] || {}).activities)
      ? overrides[dayKey].activities
      : [];
    for (const a of activities) {
      if (isCardioActivity(a) && typeof a.durationMin === "number") total += a.durationMin;
    }
  }
  return total;
}

/* ------------------------------ confirming ----------------------------------- */

function labelFromSport(sport) {
  if (!sport) return "Workout";
  const spaced = String(sport).replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The activities[] entry written when a client confirms a matched or extra
 * workout. `name` comes from the cardio type's label, falling back to the
 * sport when no type claims it (an "Other" match). A strength or yoga workout
 * is tagged `kind: <slot>` and named from the slot catalogue, so it never
 * counts as cardio.
 */
export function activityFromWorkout(workout, program) {
  const cardioTypes = Array.isArray(program && program.cardioTypes) ? program.cardioTypes : [];
  const ncSlot = nonCardioSlotFor(workout.sport);
  const type = ncSlot ? null : cardioTypes.find((ct) => Array.isArray(ct.sports) && ct.sports.includes(workout.sport));
  const entry = {
    id: `${workout.vendor}:${workout.vendor_session_id}`,
    name: ncSlot ? STANDARD_SLOTS.find((ss) => ss.id === ncSlot).label : type ? type.label : labelFromSport(workout.sport),
    typeId: type ? type.id : null,
    source: "wearable",
    ...(ncSlot ? { kind: ncSlot } : {}),
    workout: { vendor: workout.vendor, vendorSessionId: workout.vendor_session_id },
  };
  if (workout.duration_minutes != null) entry.durationMin = Number(workout.duration_minutes);
  if (workout.distance_km != null) entry.distanceKm = Number(workout.distance_km);
  if (workout.hr_avg != null) entry.hrAvg = Number(workout.hr_avg);
  if (workout.hr_max != null) entry.hrMax = Number(workout.hr_max);
  return entry;
}
