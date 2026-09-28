/**
 * Pure day-override edits. Kept out of engine.js on purpose: engine.js is
 * byte-identical across all five repos including Coach, and this file is
 * client-app-only.
 */

/**
 * Remove one activity from a day's overrides. Only the `activities` key is
 * ever touched — `deload`, `note`, or a slot override left over from an
 * older programme version all survive even when the last activity goes.
 */
export function removeActivityOverride(overrides, key, id) {
  const day = overrides[key];
  if (!day?.activities?.some((a) => a.id === id)) return overrides;
  const activities = day.activities.filter((a) => a.id !== id);
  const nextDay = { ...day };
  if (activities.length === 0) delete nextDay.activities;
  else nextDay.activities = activities;
  const next = { ...overrides };
  if (Object.keys(nextDay).length === 0) delete next[key];
  else next[key] = nextDay;
  return next;
}
