// Generic statistics. buildHistoryRows moved to engine.js when it became
// program-driven; these depend only on rows + dates, so they stay here.
//
// v2: computeStreak now PAUSES on a skip day (sick / travel / injured)
// rather than breaking. computeWeightSeries was removed — it read `r.weight`,
// a field buildHistoryRows stopped producing when the data model moved to
// `numbers`, and nothing imported it. Use computeSeries(rows, id,
// { bucket: "numbers" }) instead.
import { dateKey } from "./dates.js";

/**
 * Consecutive days at or above `threshold` completion, counting back from the
 * most recent logged day.
 *
 * A skip day is neither a hit nor a miss: the walk steps over it and keeps
 * going. Being ill should not cost you a streak you earned, and it should not
 * hand you one you did not.
 */
function computeStreak(rows, threshold = 0.8) {
  if (!rows.length) return 0;
  const byDate = {};
  rows.forEach((r) => (byDate[r.date] = r));
  const cursor = new Date(rows[rows.length - 1].dateObj);
  let streak = 0;
  let guard = 0;
  while (guard++ < 3650) {
    const key = dateKey(cursor);
    const r = byDate[key];
    if (!r) break;
    if (r.skip) {
      cursor.setDate(cursor.getDate() - 1); // paused, not counted, not broken
      continue;
    }
    if (r.pct >= threshold) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }
  return streak;
}

function buildHeatmapCells(rows, weeksBack = 12) {
  const byDate = {};
  rows.forEach((r) => (byDate[r.date] = r));

  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (weeksBack * 7 - 1));
  start.setDate(start.getDate() - start.getDay()); // snap back to Sunday

  const cells = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = dateKey(cursor);
    const r = byDate[key];
    cells.push({ date: key, dow: cursor.getDay(), pct: r ? r.pct : null, skip: r ? r.skip || null : null });
    cursor.setDate(cursor.getDate() + 1);
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export { computeStreak, buildHeatmapCells };
