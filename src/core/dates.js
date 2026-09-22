// Extracted verbatim from pt-program-live.jsx v3.1 — no logic changes.
// Pure JavaScript: no React, no DOM, no browser APIs. Safe to import from
// the web app, a React Native app, or a Node script.

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fdn = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fdn + 3);
  return 1 + Math.round((d - firstThursday) / (7 * 86400000));
}

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(a, b) {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86400000);
}

// Anchored to the Sunday on/after the documented 12 Jun 2026 InBody baseline.
// InBody repeats every 8 weeks, VO2max every 4 — they coincide every other VO2max cycle.
const TEST_ANCHOR = new Date(2026, 5, 14);
function isInBodyDue(date) {
  const diff = daysBetween(TEST_ANCHOR, date);
  return diff >= 0 && diff % 56 === 0;
}
function isVo2maxDue(date) {
  const diff = daysBetween(TEST_ANCHOR, date);
  return diff >= 0 && diff % 28 === 0;
}

// 3-week loading wave + 4th week deload, anchored to Mon 27 Jul 2026 (start of
// active app usage). Returns true for all 7 days of the calculated deload week.
const DELOAD_ANCHOR = new Date(2026, 6, 27);
function isDeloadWeek(date) {
  const dow = (date.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(date);
  monday.setDate(monday.getDate() - dow);
  const diff = daysBetween(DELOAD_ANCHOR, monday);
  if (diff < 0) return false;
  const weeksSince = Math.floor(diff / 7);
  return weeksSince % 4 === 3;
}

function getMonthMatrix(year, month) {
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-first
  const weeksNeeded = Math.ceil((startOffset + daysInMonth) / 7);
  const start = new Date(year, month, 1 - startOffset);
  const weeks = [];
  const cursor = new Date(start);
  for (let w = 0; w < weeksNeeded; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function getCycleStart(date) {
  const isoWeek = getISOWeek(date);
  const isEven = isoWeek % 2 === 0;
  const dow = (date.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(date);
  monday.setDate(monday.getDate() - dow);
  if (!isEven) monday.setDate(monday.getDate() - 7);
  return monday;
}

function getWeekMonday(date) {
  const dow = (date.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(date);
  monday.setDate(monday.getDate() - dow);
  return monday;
}

export {
  getISOWeek,
  dateKey,
  daysBetween,
  getMonthMatrix,
  getCycleStart,
  getWeekMonday,
  TEST_ANCHOR,
  isInBodyDue,
  isVo2maxDue,
  DELOAD_ANCHOR,
  isDeloadWeek,
};
