import { getISOWeek, dateKey, daysBetween } from "./dates.js";

/**
 * The engine. Knows how a training app WORKS; knows nothing about any
 * particular person's program.
 *
 * Every function takes a `program` object as its last argument. Swap the
 * program, get a different app — same scheduling, same history maths, same
 * override system.
 *
 * v2 additions, all opt-in via program data so existing programs behave
 * exactly as before:
 *   - skip days        overrides[day].skip = "sick" | "travel" | "injured"
 *   - choice tasks     type: "choice" + options -> rec.choices[id]
 *   - number targets   type: "number" + target/direction -> met / missed
 *   - bpm zones        task.pctMin/pctMax + opts.hrMax -> "(158-166 bpm)"
 *   - testing schedule program.testing -> a section that appears when due
 *   - deload hint      program.deloadWave -> SUGGESTS a deload week; it never
 *                      switches one on. The user's weekly toggle decides.
 */

/* --------------------------------- Skips --------------------------------- */

export const SKIP_REASONS = [
  { value: "sick", label: "Sick" },
  { value: "travel", label: "Travel" },
  { value: "injured", label: "Injured" },
];

const SKIP_LABEL = Object.fromEntries(SKIP_REASONS.map((r) => [r.value, r.label]));

export function skipLabel(reason) {
  return SKIP_LABEL[reason] || null;
}

/* ------------------------------- Scheduling ------------------------------ */

/**
 * What is actually happening on a given date, after per-day overrides.
 *
 * Overrides are keyed 'YYYY-MM-DD'. A key being PRESENT (even set to null)
 * means "the user moved or cleared this", which is why hasOwnProperty is used
 * rather than a truthiness check — clearing a session must beat the template.
 *
 * A skip clears every scheduled slot and every extra activity. It does NOT
 * erase what was there: `scheduled` still reports it, so unsetting the skip
 * restores the day exactly.
 */
export function resolveSchedule(date, weekOverride, overrides, program) {
  const auto = getISOWeek(date) % 2 === 0 ? "A" : "B";
  const weekType = weekOverride === "auto" ? auto : weekOverride;
  const key = dateKey(date);

  const base = (program.schedule[weekType] || {})[date.getDay()] || {};
  const ov = (overrides && overrides[key]) || {};

  const skip = typeof ov.skip === "string" && SKIP_LABEL[ov.skip] ? ov.skip : null;

  // The weekly deload toggle writes `deload` onto all 7 days of that week.
  // null = never set, so the caller's own setting applies.
  const deload = typeof ov.deload === "boolean" ? ov.deload : null;

  const slots = {};
  const moved = {};
  const scheduled = {};
  for (const slotName of program.slots) {
    const isOverridden = Object.prototype.hasOwnProperty.call(ov, slotName);
    const value = isOverridden ? ov[slotName] || null : base[slotName] || null;
    scheduled[slotName] = value;
    slots[slotName] = skip ? null : value;
    moved[slotName] = isOverridden;
  }

  const allActivities = Array.isArray(ov.activities) ? ov.activities : [];
  const activities = skip ? [] : allActivities;
  const note = ov.note !== undefined ? ov.note : base.note || null;

  return {
    weekType,
    slots,
    scheduled,
    moved,
    note,
    skip,
    deload,
    skipLabel: skipLabel(skip),
    activities,
    allActivities,
    anyMoved: Object.values(moved).some(Boolean) || allActivities.length > 0 || Boolean(skip),
    isTrainingDay: Object.values(slots).some(Boolean) || activities.length > 0,
  };
}

/* --------------------------------- Wave ---------------------------------- */

/**
 * Does the wave SUGGEST this week as a deload?
 *
 * Suggestion only — it never turns a deload on. That is the user's weekly
 * toggle, stored per day in overrides. The calendar draws a dashed outline on
 * suggested weeks; the user decides whether to take it. Deloading is a
 * response to how the last three weeks actually went, and a calendar cannot
 * know that.
 *
 *   program.deloadWave = { anchor: Date, cycleWeeks: 4, deloadWeek: 3 }
 *
 * `deloadWeek` is zero-based within the cycle: 3 = the fourth week.
 */
export function suggestDeloadWeek(date, program) {
  const wave = program && program.deloadWave;
  if (!wave || !wave.anchor) return false;
  const waveAnchor = toDate(wave.anchor);
  if (!waveAnchor) return false;
  const mondayOf = (d) => {
    const dow = (d.getDay() + 6) % 7;
    const m = new Date(d);
    m.setDate(m.getDate() - dow);
    return m;
  };
  const diff = daysBetween(mondayOf(waveAnchor), mondayOf(date));
  if (diff < 0) return false;
  const cycle = wave.cycleWeeks || 4;
  const target = wave.deloadWeek != null ? wave.deloadWeek : cycle - 1;
  return Math.floor(diff / 7) % cycle === target;
}


/* --------------------------------- Anchors -------------------------------- */

/**
 * Program anchors are declared as ISO date strings ("2026-09-06"), because a
 * program has to survive being stored as JSON and pasted back in. Date objects
 * are still accepted so nothing breaks if one turns up.
 *
 * Parsed as a LOCAL date on purpose. new Date("2026-09-06") is midnight UTC,
 * which is the previous calendar day in the Americas and the same day here —
 * a bug that would appear only for some users, and only sometimes. Everything
 * else in this engine compares local year/month/day, so anchors must too.
 */
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/* -------------------------------- Testing -------------------------------- */

/**
 * Periodic tests (InBody, VO2max, ...), declared per program:
 *
 *   program.testing = {
 *     key: "testing", cat: "testing", title: "Testing & Metrics",
 *     items: [{ id, label, anchor: Date, everyDays: 56, tasks: [...] }],
 *   }
 *
 * A test moves off its calculated day the same way a session does:
 * overrides[day]["test:<id>"] = true | false.
 */
export function resolveTesting(date, overrides, program) {
  const spec = program && program.testing;
  if (!spec || !Array.isArray(spec.items)) return [];
  const ov = (overrides && overrides[dateKey(date)]) || {};
  return spec.items.map((item) => {
    const ovKey = `test:${item.id}`;
    const isOverridden = Object.prototype.hasOwnProperty.call(ov, ovKey);
    let auto = false;
    const itemAnchor = toDate(item.anchor);
    if (itemAnchor && item.everyDays) {
      const diff = daysBetween(itemAnchor, date);
      auto = diff >= 0 && diff % item.everyDays === 0;
    }
    return {
      id: item.id,
      ovKey,
      label: item.label,
      tasks: item.tasks || [],
      due: isOverridden ? Boolean(ov[ovKey]) : auto,
      moved: isOverridden,
    };
  });
}

/* -------------------------------- Zones ---------------------------------- */

/** "4 min @ 90-95% HRmax" + hrMax 175 -> "... (158-166 bpm)" */
export function withBpm(presc, pctMin, pctMax, hrMax) {
  if (pctMin == null || !hrMax) return presc;
  const lo = Math.round((hrMax * pctMin) / 100);
  const hi = Math.round((hrMax * (pctMax != null ? pctMax : pctMin)) / 100);
  return presc + " (" + lo + "\u2013" + hi + " bpm)";
}

/* ------------------------------- Sections -------------------------------- */

function mapTask(e, opt) {
  const gentler = opt.gentler;
  const presc = gentler && e.gentlerPresc ? e.gentlerPresc : e.presc;
  return {
    id: e.id,
    name: e.name,
    presc: withBpm(presc, e.pctMin, e.pctMax, opt.hrMax),
    detail: e.detail || null,
    video: e.video || null,
    pattern: e.pattern || null,
    altName: e.altName || null,
    altVideo: e.altVideo || null,
    sets: e.sets != null ? (gentler ? Math.max(1, e.sets - 1) : e.sets) : null,
    type: e.type || "exercise",
    unit: e.unit || null,
    target: e.target != null ? e.target : null,
    direction: e.direction || null,
    options: e.options || null,
    countId: e.countId || null,
    countUnit: e.countUnit || null,
    countLabel: e.countLabel || null,
    zeroOption: e.zeroOption || null,
    scale: e.scale || null,
  };
}

/**
 * The day's task list.
 *
 *   1. skip notice      — if the day is marked sick / travel / injured
 *   2. scheduled slots  — whatever the template or an override put here
 *   3. extra activities — things added ad hoc from the Calendar
 *   4. daily sections   — mobility, checks, nutrition: every day regardless
 *   5. due tests        — only when due, or already logged for that day
 *
 * Daily sections survive a skip: mobility, checks and nutrition still apply
 * when you are ill. Only training is removed.
 */
export function buildSections(date, opts, program) {
  const o = opts || {};
  const gentler = Boolean(o.gentler);
  const overrides = o.overrides || {};
  const hrMax = o.hrMax != null ? o.hrMax : null;
  const record = o.record || null;
  const weekType = o.weekType || "A";

  const info = resolveSchedule(date, weekType, overrides, program);
  // An explicit weekly toggle beats whatever the caller passed in.
  const isGentler = info.deload != null ? info.deload : gentler;
  const sections = [];
  const opt = { gentler: isGentler, hrMax: hrMax };

  if (info.skip) {
    const cleared =
      program.slots.filter((s) => info.scheduled[s]).length + info.allActivities.length;
    sections.push({
      key: "skip",
      cat: "rest",
      title: info.skipLabel + " day",
      subtitle: cleared
        ? "Training cleared — " + cleared + " session" + (cleared === 1 ? "" : "s") +
          " removed. Your streak pauses rather than breaks."
        : "Training cleared. Your streak pauses rather than breaks.",
      tasks: [],
      skip: info.skip,
    });
  } else if (!info.isTrainingDay) {
    sections.push({
      key: "rest",
      cat: "rest",
      title: program.restLabel || "Rest Day",
      subtitle: info.note || program.restSubtitle || null,
      tasks: [],
    });
  }

  for (const slotName of program.slots) {
    const value = info.slots[slotName];
    if (!value) continue;
    const block = program.blocks[slotName] && program.blocks[slotName][value];
    if (!block) continue;
    sections.push({
      key: slotName,
      cat: block.cat || slotName,
      noGym: Boolean(block.noGym),
      title: block.label,
      subtitle: isGentler ? block.gentlerNote || program.gentlerNote : block.subtitle || null,
      tasks: block.exercises.map((e) => mapTask(e, opt)),
    });
  }

  if (info.activities.length) {
    sections.push({
      key: "activity",
      cat: "activity",
      title: "Extra Activity",
      subtitle: "Added from Calendar",
      tasks: info.activities.map((a) => ({
        id: "act-" + a.id,
        name: a.name,
        presc: "Logged activity",
        type: "exercise",
      })),
    });
  }

  for (const daily of program.daily || []) {
    if (daily.dayOfWeek != null && daily.dayOfWeek !== date.getDay()) continue;
    // A daily section may declare `byDayType: { training, rest }` when its
    // content differs on training and rest days — nutrition targets, for
    // instance. Everything declared on the section itself still applies; the
    // variant only overrides what it names. Closures used to do this job and
    // are gone deliberately: a program must be plain data to be stored and
    // validated outside the app.
    const variant = daily.byDayType
      ? (info.isTrainingDay ? daily.byDayType.training : daily.byDayType.rest) || {}
      : {};
    const tasks = variant.tasks || daily.tasks || [];
    const title = variant.title != null ? variant.title : daily.title;
    const subtitle = variant.subtitle != null ? variant.subtitle : daily.subtitle;
    sections.push({
      key: daily.key,
      cat: daily.cat,
      title: title,
      subtitle: subtitle || null,
      tasks: tasks.map((e) => mapTask(e, opt)),
    });
  }

  const tests = resolveTesting(date, overrides, program);
  const show = tests.filter(
    (t) => t.due || (record && t.tasks.some((task) => isTaskDone(mapTask(task, opt), record)))
  );
  if (show.length) {
    const spec = program.testing;
    const due = show.filter((t) => t.due);
    sections.push({
      key: spec.key || "testing",
      cat: spec.cat || "testing",
      title: spec.title || "Testing & Metrics",
      subtitle: due.length
        ? "Due today — " + due.map((t) => t.label).join(" + ")
        : "Already logged for this day",
      tasks: show.flatMap((t) => t.tasks.map((e) => mapTask(e, opt))),
    });
  }

  return sections;
}

/* ---------------------------- Completion rules --------------------------- */

/**
 * One place that decides whether a task counts as done. Every other
 * completion figure in the app — the ring, history, streaks — routes through
 * here, so they can never disagree with each other.
 */
export function isTaskDone(task, rec) {
  if (!rec) return false;
  switch (task.type) {
    case "notes":
      return false; // a journal field, never counted
    case "scale":
      return rec.scales?.[task.id] != null;
    case "number":
      return typeof rec.numbers?.[task.id] === "number";
    case "choice":
      return typeof rec.choices?.[task.id] === "string";
    default:
      return Boolean(rec.done?.[task.id]) || Boolean(rec.subs?.[task.id]?.name);
  }
}

/** Did a number task meet its target? null when there is no target or no value. */
export function targetMet(task, rec) {
  if (task.type !== "number" || task.target == null || !task.direction) return null;
  const v = rec?.numbers?.[task.id];
  if (typeof v !== "number") return null;
  return task.direction === "under" ? v <= task.target : v >= task.target;
}

/** Tasks that count toward the day's percentage — notes are excluded. */
export function countableTasks(sections) {
  return sections.flatMap((s) => s.tasks).filter((t) => t.type !== "notes");
}

/* ------------------------------- History --------------------------------- */

/**
 * One row per logged day, rebuilding that day's actual task list so old
 * percentages stay correct even after the program changes.
 */
export function buildHistoryRows(log, overrides, program) {
  return Object.keys(log)
    .sort()
    .map((dstr) => {
      const parts = dstr.split("-").map(Number);
      const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
      const rec = log[dstr] || {};
      const weekType = rec.weekType || (getISOWeek(dateObj) % 2 === 0 ? "A" : "B");
      const gentler = Boolean(rec.gentler);
      const hrMax = rec.hrMax != null ? rec.hrMax : null;

      const sections = buildSections(
        dateObj,
        { weekType: weekType, gentler: gentler, overrides: overrides, hrMax: hrMax, record: rec },
        program
      );

      const byCat = {};
      let total = 0;
      let doneCount = 0;
      for (const sec of sections) {
        if (!sec.tasks.length) continue;
        if (!byCat[sec.cat]) byCat[sec.cat] = { total: 0, done: 0 };
        for (const task of sec.tasks) {
          if (task.type === "notes") continue;
          byCat[sec.cat].total += 1;
          total += 1;
          if (isTaskDone(task, rec)) {
            byCat[sec.cat].done += 1;
            doneCount += 1;
          }
        }
      }

      const info = resolveSchedule(dateObj, weekType, overrides, program);

      return {
        date: dstr,
        dateObj: dateObj,
        total: total,
        doneCount: doneCount,
        pct: total ? doneCount / total : 0,
        byCat: byCat,
        scales: rec.scales || {},
        numbers: rec.numbers || {},
        choices: rec.choices || {},
        done: rec.done || {},
        isTrainingDay: info.isTrainingDay,
        skip: info.skip,
        gentler: info.deload != null ? info.deload : gentler,
      };
    });
}

/**
 * Rolling average of any tracked value.
 *
 *   scales  — 1-5 subjective ratings (energy, symptoms)
 *   numbers — measured values (bodyweight kg, hours slept, units of alcohol)
 *   done    — booleans, reported as a rolling hit rate (step target met)
 */
export function computeSeries(rows, id, options) {
  const opt = options || {};
  const bucket = opt.bucket || "scales";
  const windowDays = opt.windowDays || 7;
  if (bucket === "done") return computeRateSeries(rows, id, windowDays);

  const byDate = {};
  rows.forEach((r) => {
    const v = r[bucket]?.[id];
    if (typeof v === "number") byDate[r.date] = v;
  });

  return rows
    .filter((r) => typeof r[bucket]?.[id] === "number")
    .map((r) => {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < windowDays; i++) {
        const d = new Date(r.dateObj);
        d.setDate(d.getDate() - i);
        const v = byDate[dateKey(d)];
        if (v != null) {
          sum += v;
          count += 1;
        }
      }
      return {
        date: r.date,
        label: r.dateObj.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
        value: r[bucket][id],
        avg: count ? Math.round((sum / count) * 10) / 10 : null,
      };
    });
}

/** Rolling hit-rate (%) of a boolean checkbox, e.g. the daily step target. */
export function computeRateSeries(rows, id, windowDays) {
  const w = windowDays || 7;
  const byDate = {};
  rows.forEach((r) => (byDate[r.date] = Boolean(r.done?.[id])));
  return rows.map((r) => {
    let hits = 0;
    let count = 0;
    for (let i = 0; i < w; i++) {
      const d = new Date(r.dateObj);
      d.setDate(d.getDate() - i);
      const k = dateKey(d);
      if (Object.prototype.hasOwnProperty.call(byDate, k)) {
        count += 1;
        if (byDate[k]) hits += 1;
      }
    }
    return {
      date: r.date,
      label: r.dateObj.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      value: byDate[r.date] ? 1 : 0,
      avg: count ? Math.round((hits / count) * 100) : null,
    };
  });
}

/**
 * Rolling SUM over a window — the right shape when the weekly total is the
 * meaningful figure rather than the daily average. Days with no value count
 * as zero, deliberately: a day with nothing logged is a day with none.
 */
export function computeRollingTotal(rows, id, options) {
  const windowDays = (options && options.windowDays) || 7;
  const byDate = {};
  rows.forEach((r) => {
    const v = r.numbers?.[id];
    byDate[r.date] = typeof v === "number" ? v : 0;
  });
  return rows.map((r) => {
    let sum = 0;
    for (let i = 0; i < windowDays; i++) {
      const d = new Date(r.dateObj);
      d.setDate(d.getDate() - i);
      sum += byDate[dateKey(d)] || 0;
    }
    return {
      date: r.date,
      label: r.dateObj.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      value: byDate[r.date] || 0,
      total: Math.round(sum * 10) / 10,
    };
  });
}

/** Heaviest logged set per session, for the strength progression chart. */
export function computeLoadSeries(log, exerciseId, excludeDate) {
  return Object.keys(log)
    .sort()
    .filter((dstr) => dstr !== excludeDate)
    .map((dstr) => {
      const loads = log[dstr]?.loads?.[exerciseId];
      if (!loads) return null;
      const weights = loads.map((e) => (typeof e === "number" ? e : e?.w)).filter((w) => w != null);
      if (!weights.length) return null;
      const parts = dstr.split("-").map(Number);
      return {
        date: dstr,
        label: new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
        }),
        maxWeight: Math.max.apply(null, weights),
      };
    })
    .filter(Boolean);
}

export { getISOWeek, dateKey, daysBetween };

/** @deprecated use computeSeries(rows, id, { bucket: "scales" }) */
export function computeScaleSeries(rows, id, windowDays) {
  return computeSeries(rows, id, { bucket: "scales", windowDays: windowDays || 7 });
}

/* ---------------------------- Substitution keys ---------------------------
 * Loads are keyed by what was ACTUALLY done, not by the slot. A standard
 * session writes to the plain slot id, exactly as before, so existing history
 * is untouched. A substituted session writes to `<slot>::<variant-slug>`, so a
 * barbell number can never be shown as a dumbbell number, in either direction.
 * ------------------------------------------------------------------------- */

export function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function loadKeyFor(exId, rec) {
  const sub = rec && rec.subs && rec.subs[exId] && rec.subs[exId].name;
  if (!sub) return exId;
  const key = exId + "::" + slugify(sub);
  // Legacy safety: days logged before variant-keyed loads existed stored a
  // substituted lift under the plain slot id. If that day already holds data
  // there and nothing under the new key, keep using the old one so the numbers
  // stay visible and editable. No migration, nothing moved.
  const loads = (rec && rec.loads) || {};
  const hasNew = Array.isArray(loads[key]) && loads[key].some((s) => s && (s.w != null || s.r != null));
  const hasOld = Array.isArray(loads[exId]) && loads[exId].some((s) => s && (s.w != null || s.r != null));
  if (!hasNew && hasOld) return exId;
  return key;
}

/** "up-1::incline-barbell-press" -> "Incline barbell press" */
export function labelForLoadKey(key, baseNameFor) {
  const i = String(key).indexOf("::");
  if (i === -1) return baseNameFor ? baseNameFor(key) : key;
  const slug = key.slice(i + 2).replace(/-/g, " ");
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}
