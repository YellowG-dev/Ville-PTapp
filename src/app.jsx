import React, { useState, useEffect, useMemo, useCallback, useRef, createContext, useContext } from "react";
import {
  Dumbbell, Wind, Flower2, Check, ExternalLink, ChevronDown, ChevronLeft,
  ChevronRight, Settings2, Flame, CalendarDays, Repeat, X, Heart, Ban,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine,
} from "recharts";

import {
  PROGRAM, THEME, makeTheme, DEFAULT_THEME_ID, ProgramView, CLIENT_LABEL, CLIENT_NAME, STORAGE_PREFIX,
  START_DATE, RAMP_WEEKS, APP_VERSION, MOBILITY, BLOCKS, SLOT_OPTIONS, SLOT_META,
} from "./config.jsx";

import {
  resolveSchedule, buildSections, buildHistoryRows, isTaskDone, countableTasks,
  computeSeries, computeRollingTotal, computeLoadSeries, targetMet,
  suggestDeloadWeek, resolveTesting, SKIP_REASONS, dateKey, daysBetween, getISOWeek,
  loadKeyFor, labelForLoadKey,
} from "./core/engine.js";
import { THEMES, THEME_IDS } from "./core/themes.js";
import { variantsFor } from "./core/patterns.js";
import { computeStreak, buildHeatmapCells } from "./core/stats.js";
import { createStore, localStorageAdapter } from "./core/storage.js";
import { isConfigured, currentUser, onAuthChange, sendMagicLink, signOut,
         getCoachSharing, setCoachSharing } from "./core/supabase.js";
import {
  configureSync, pullAndMerge, queueLogDay, queueOverrideChanges,
  queueSettings, flushNow, watchConnectivity,
} from "./core/sync.js";

/* --------------------------------- Config -------------------------------- */

// The theme used to be destructured HERE, at module scope, which resolved it
// exactly once when the bundle loaded. Nothing could change at runtime, so a
// switcher was impossible. It now arrives through context and each component
// destructures the same names from useTheme(), which is why all 315 existing
// call sites are untouched — only the binding moved.
//
// OK_COLOR moved into the theme object too (see buildTheme in core/themes.js);
// it derived from CATS, which is now per-theme data.
const ThemeContext = createContext(THEME);

/** Every colour, font and tint in the app. Call it first in a component. */
function useTheme() {
  return useContext(ThemeContext);
}

const store = createStore(localStorageAdapter(), STORAGE_PREFIX);

// ==time-input:start
// Number entry. Plain numbers behave exactly as before (comma or dot decimal).
// Entries containing ":" are durations: "m:ss" or "h:mm:ss", stored as
// MINUTES (e.g. "42:30" -> 42.5, "1:45:12" -> 105.2). Before this, parseFloat
// read "42:30" as 42 and silently dropped the seconds.
// A number task whose program unit is exactly "h:mm:ss" (TIME_UNIT) gets the
// full keyboard (the iOS decimal pad has no ":" key) and shows its stored
// minutes back in the same format.
const TIME_UNIT = "h:mm:ss";

function parseNumberInput(raw) {
  const t = String(raw ?? "").trim();
  if (t === "") return null;
  if (t.includes(":")) {
    const parts = t.split(":");
    if (parts.length < 2 || parts.length > 3) return null;
    const last = parts[parts.length - 1].replace(",", ".");
    if (!parts.slice(0, -1).every((p) => /^\d+$/.test(p)) || !/^\d+(\.\d+)?$/.test(last)) return null;
    const nums = parts.slice(0, -1).map(Number);
    const sec = Number(last);
    if (sec >= 60) return null;
    let minutes;
    if (nums.length === 2) {
      if (nums[1] >= 60) return null;
      minutes = nums[0] * 60 + nums[1] + sec / 60;
    } else {
      minutes = nums[0] + sec / 60;
    }
    return Math.round(minutes * 10000) / 10000;
  }
  const n = parseFloat(t.replace(",", "."));
  return isNaN(n) ? null : n;
}

function formatTime(minutes) {
  const total = Math.round(minutes * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
// ==time-input:end

function FontImport() {
  const { BG, CARD, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, ACCENT, ACCENT_2,
          HEAT_RGB, FONT_DISPLAY, FONT_BODY, FONT_MONO, FONT_IMPORT, CATS, OK_COLOR,
          ON_ACCENT, KNOB, TINT, BADGE } = useTheme();
  return (
    <style>{`
      @import url('${FONT_IMPORT}');
      html, body, #root { background: ${BG}; min-height: 100%; }
      body { margin: 0; -webkit-tap-highlight-color: transparent; }
    `}</style>
  );
}

/* -------------------------------- Helpers -------------------------------- */

function weeksSinceStart(date) {
  return Math.floor(daysBetween(START_DATE, date) / 7);
}
function isRampWeek(date) {
  const w = weeksSinceStart(date);
  return w >= 0 && w < RAMP_WEEKS;
}
function setCountFor(task, ramp) {
  if (task.sets == null) return 0;
  return ramp ? Math.max(1, task.sets - 1) : task.sets;
}

/* ---------------------------------- App ---------------------------------- */

function AppInner({ setThemeId }) {
  const { BG, CARD, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, ACCENT, ACCENT_2,
          HEAT_RGB, FONT_DISPLAY, FONT_BODY, FONT_MONO, FONT_IMPORT, CATS, OK_COLOR,
          ON_ACCENT, KNOB, TINT, BADGE } = useTheme();
  const today = useMemo(() => new Date(), []);
  const todayKey = dateKey(today);

  const [loading, setLoading] = useState(true);
  const [log, setLog] = useState({});
  const [overrides, setOverrides] = useState({});
  const [settings, setSettings] = useState({ gentler: false, hrMax: null, theme: readStoredThemeId() });
  const activeTheme = useTheme(); // the whole object, for ProgramView

  // settings.theme is the single source of truth. It is saved locally and
  // synced to user_settings with the rest of settings; the provider mirrors it.
  useEffect(() => {
    setThemeId(THEMES[settings.theme] ? settings.theme : DEFAULT_THEME_ID);
  }, [settings.theme, setThemeId]);
  const [view, setView] = useState("today");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dayOffset, setDayOffset] = useState(0);
  const [expanded, setExpanded] = useState({});
  const [sectionOpen, setSectionOpen] = useState({});

  const [loadDrafts, setLoadDrafts] = useState({});
  const [notesDraft, setNotesDraft] = useState("");
  const [editingNote, setEditingNote] = useState(null);
  const [exNoteDrafts, setExNoteDrafts] = useState({});
  const [hrMaxDraft, setHrMaxDraft] = useState("");

  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calSelected, setCalSelected] = useState(today);
  const [editingBlock, setEditingBlock] = useState(null);
  const [activityDraft, setActivityDraft] = useState("");
  const [moveSource, setMoveSource] = useState(null);

  const [backupText, setBackupText] = useState("");

  // Account and sync. All inert when signed out.
  const [authUser, setAuthUser] = useState(null);
  const [syncState, setSyncState] = useState({ status: "offline", pendingCount: 0, lastSyncedAt: null });
  const [emailDraft, setEmailDraft] = useState("");
  const [authMsg, setAuthMsg] = useState("");
  // { linked, enabled } — linked false means no coach, which is not the same
  // as linked with sharing switched off.
  const [sharing, setSharing] = useState({ linked: false, enabled: null });
  const [sharingBusy, setSharingBusy] = useState(false);
  const syncedUserRef = useRef(null);

  // Sharing state follows the session. Signed out, there is nothing to ask
  // about; signed in, this is read once rather than watched, because the only
  // thing that changes it is the toggle below.
  useEffect(() => {
    let dead = false;
    if (!authUser) {
      setSharing({ linked: false, enabled: null });
      return;
    }
    (async () => {
      const state = await getCoachSharing();
      if (!dead) setSharing(state);
    })();
    return () => { dead = true; };
  }, [authUser]);
  const [copyStatus, setCopyStatus] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [selectedExerciseId, setSelectedExerciseId] = useState(null);
  const [swapOpen, setSwapOpen] = useState(null);
  const [swapFree, setSwapFree] = useState({});

  /* ------------------------------ Load state ----------------------------- */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [l, ov, s] = await Promise.all([
        store.loadJSON("log", {}),
        store.loadJSON("overrides", {}),
        store.loadJSON("settings", { gentler: false, hrMax: null }),
      ]);
      if (cancelled) return;
      setLog(l);
      setOverrides(ov);
      setSettings(s);
      setHrMaxDraft(s.hrMax != null ? String(s.hrMax) : "");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  /* ------------------------------- Cloud sync ----------------------------- */
  // Runs after the local load above. Signed out, this does nothing at all.
  //
  // Note it re-reads from `store` rather than from React state: state inside
  // this effect would be frozen at mount, and the store is always current.
  useEffect(() => {
    if (!isConfigured()) return;

    const attach = async (user) => {
      setAuthUser(user || null);
      const uid = user?.id || null;
      if (syncedUserRef.current === uid) return;   // same user, nothing to redo
      syncedUserRef.current = uid;

      await configureSync({ store, userId: uid, onStateChange: setSyncState });
      if (!uid) return;

      const [l, ov, s] = await Promise.all([
        store.loadJSON("log", {}),
        store.loadJSON("overrides", {}),
        store.loadJSON("settings", { gentler: false, hrMax: null }),
      ]);

      // Returns null if offline or the fetch failed — in which case the local
      // copy is left exactly as it is. Never a reason to lose anything.
      const merged = await pullAndMerge({ log: l, overrides: ov, settings: s });
      if (!merged) return;

      setLog(merged.log);
      setOverrides(merged.overrides);
      setSettings(merged.settings);
      setHrMaxDraft(merged.settings?.hrMax != null ? String(merged.settings.hrMax) : "");
      store.saveJSON("log", merged.log);
      store.saveJSON("overrides", merged.overrides);
      store.saveJSON("settings", merged.settings);
    };

    let stopAuth = () => {};
    const stopConn = watchConnectivity();
    stopAuth = onAuthChange(attach);
    currentUser().then(attach);

    return () => { stopAuth(); stopConn(); };
  }, []);

  const viewedDate = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + dayOffset);
    return d;
  }, [today, dayOffset]);
  const viewedKey = dateKey(viewedDate);
  const rec = log[viewedKey];
  const ramp = isRampWeek(viewedDate);
  // Precedence: the weekly D toggle (an override) beats the day's stored
  // flag, which beats the app-wide setting. The 4th-week wave only SUGGESTS.
  const dayOverrideDeload = overrides[viewedKey]?.deload;
  // Precedence, after the app-wide toggle was removed: the week-scoped
  // Calendar toggle (an override) beats the day's stored flag, and there is
  // no third level any more. The old settings.gentler is deliberately not
  // read — two controls that shared behaviour but not display state could
  // each show "off" while the day was actually gentle.
  const gentler =
    typeof dayOverrideDeload === "boolean" ? dayOverrideDeload
    : typeof rec?.gentler === "boolean" ? rec.gentler
    : false;

  /* ------------------------ Reset drafts on day change -------------------- */

  const didInit = useRef(false);
  useEffect(() => {
    if (!didInit.current) { didInit.current = true; return; }
    const r = log[viewedKey];
    setNotesDraft(r?.notes || "");
    const drafts = {};
    Object.entries(r?.loads || {}).forEach(([exId, arr]) => {
      (arr || []).forEach((entry, i) => {
        if (entry?.w != null) drafts[`${exId}:${i}:w`] = String(entry.w);
        if (entry?.r != null) drafts[`${exId}:${i}:r`] = String(entry.r);
      });
    });
    setLoadDrafts(drafts);
    setExNoteDrafts({});
    setEditingNote(null);
  }, [viewedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* -------------------------------- Writers ------------------------------- */

  const persist = useCallback((updater) => {
    setLog((prev) => {
      const base = prev[viewedKey] || { done: {} };
      const nextRec = updater({ ...base });
      const next = { ...prev, [viewedKey]: { ...nextRec, gentler } };
      store.saveJSON("log", next);
      queueLogDay(viewedKey, next[viewedKey]);
      return next;
    });
  }, [viewedKey, gentler]);

  const toggleTask = useCallback((id) => {
    persist((r) => ({ ...r, done: { ...r.done, [id]: !r.done?.[id] } }));
  }, [persist]);

  const markSection = useCallback((ids, value) => {
    persist((r) => {
      const done = { ...r.done };
      ids.forEach((id) => { done[id] = value; });
      return { ...r, done };
    });
  }, [persist]);

  /**
   * A choice task stores the picked option, and optionally a paired count.
   * Picking the "zero" option (e.g. Alcohol -> None) writes 0 to the count in
   * the same tap: a dry day should cost one press, not a typed zero, or the
   * logging habit quietly dies.
   */
  const setChoice = useCallback((task, value) => {
    persist((r) => {
      const choices = { ...(r.choices || {}), [task.id]: value };
      const next = { ...r, choices };
      if (task.countId) {
        const numbers = { ...(r.numbers || {}) };
        if (task.zeroOption && value === task.zeroOption) numbers[task.countId] = 0;
        else if (numbers[task.countId] === 0) delete numbers[task.countId];
        next.numbers = numbers;
      }
      return next;
    });
  }, [persist]);

  const setScale = useCallback((id, value) => {
    persist((r) => ({ ...r, scales: { ...(r.scales || {}), [id]: value } }));
  }, [persist]);

  const commitNumber = useCallback((id, raw) => {
    persist((r) => {
      const numbers = { ...(r.numbers || {}) };
      const n = parseNumberInput(raw);
      if (n !== null) numbers[id] = n;
      else delete numbers[id];
      return { ...r, numbers };
    });
  }, [persist]);

  const commitNotes = useCallback(() => {
    persist((r) => {
      const next = { ...r };
      const t = notesDraft.trim();
      if (t) next.notes = t; else delete next.notes;
      return next;
    });
  }, [persist, notesDraft]);

  // setCount: sets prescribed today (after ramp). When given, the exercise is
  // auto-ticked at the moment its last set gets reps - the transition only, so
  // a manual un-tick is not undone by a later edit. Reps, not weight, decide
  // "logged": bodyweight sets are logged with reps and no weight. Swapped
  // exercises (key "id::slug") are skipped - the swap already counts as done.
  const commitLoad = useCallback((exId, idx, field, raw, setCount) => {
    persist((r) => {
      const loads = { ...(r.loads || {}) };
      const before = loads[exId] || [];
      const arr = [...before];
      const prev = arr[idx] || {};
      const num = parseFloat(String(raw).trim().replace(",", "."));
      const val = raw !== "" && !isNaN(num) ? num : null;
      arr[idx] = { w: field === "w" ? val : prev.w ?? null, r: field === "r" ? val : prev.r ?? null };
      loads[exId] = arr;
      const next = { ...r, loads };
      if (setCount > 0 && !exId.includes("::")) {
        const complete = (a) => Array.from({ length: setCount }).every((_, i) => a[i]?.r != null);
        if (!complete(before) && complete(arr)) next.done = { ...r.done, [exId]: true };
      }
      return next;
    });
  }, [persist]);

  const commitExNote = useCallback((exId, raw) => {
    persist((r) => {
      const notes = { ...(r.exNotes || {}) };
      const t = (raw || "").trim();
      if (t) notes[exId] = t; else delete notes[exId];
      return { ...r, exNotes: notes };
    });
  }, [persist]);

  const toggleAlt = useCallback((exId, altName) => {
    persist((r) => {
      const subs = { ...(r.subs || {}) };
      if (subs[exId]) delete subs[exId];
      else subs[exId] = { name: altName };
      return { ...r, subs };
    });
  }, [persist]);

  // Swap to a named variant. Same {name, reason} shape the app has always
  // written, so existing substitution history stays readable.
  const setSwap = useCallback((exId, name, reason) => {
    persist((r) => {
      const subs = { ...(r.subs || {}) };
      const t = String(name || "").trim();
      if (t) subs[exId] = { name: t, reason: reason || null };
      else delete subs[exId];
      return { ...r, subs };
    });
  }, [persist]);

  const setSwapReason = useCallback((exId, reason) => {
    persist((r) => {
      const subs = { ...(r.subs || {}) };
      if (!subs[exId]) return r;
      subs[exId] = { ...subs[exId], reason: subs[exId].reason === reason ? null : reason };
      return { ...r, subs };
    });
  }, [persist]);

  const updateSettings = useCallback((partial) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      store.saveJSON("settings", next);
      queueSettings(next);
      return next;
    });
  }, []);

  const writeOverrides = useCallback((updater) => {
    setOverrides((prev) => {
      const next = updater(prev);
      store.saveJSON("overrides", next);
      queueOverrideChanges(prev, next);
      return next;
    });
  }, []);

  const setBlock = useCallback((d, slot, value) => {
    const key = dateKey(d);
    writeOverrides((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), [slot]: value } }));
  }, [writeOverrides]);

  const resetBlock = useCallback((d, slot) => {
    const key = dateKey(d);
    writeOverrides((prev) => {
      if (!prev[key]) return prev;
      const day = { ...prev[key] };
      delete day[slot];
      const next = { ...prev };
      if (Object.keys(day).length === 0) delete next[key]; else next[key] = day;
      return next;
    });
  }, [writeOverrides]);

  const swapBlock = useCallback((a, b, slot) => {
    const ka = dateKey(a), kb = dateKey(b);
    const ia = resolveSchedule(a, "auto", overrides, PROGRAM).slots[slot];
    const ib = resolveSchedule(b, "auto", overrides, PROGRAM).slots[slot];
    writeOverrides((prev) => ({
      ...prev,
      [ka]: { ...(prev[ka] || {}), [slot]: ib },
      [kb]: { ...(prev[kb] || {}), [slot]: ia },
    }));
  }, [overrides, writeOverrides]);

  /**
   * Sick / travel / injured. Stored in overrides so one flag clears the day
   * everywhere at once — Today, the Calendar, and every past-day figure that
   * buildHistoryRows recomputes. Nothing is deleted: unset it and the day
   * returns exactly as it was.
   */
  const setSkip = useCallback((d, reason) => {
    const key = dateKey(d);
    writeOverrides((prev) => {
      const day = { ...(prev[key] || {}) };
      if (reason) day.skip = reason;
      else delete day.skip;
      const next = { ...prev };
      if (Object.keys(day).length === 0) delete next[key];
      else next[key] = day;
      return next;
    });
  }, [writeOverrides]);

  /** The weekly deload toggle writes the flag to all 7 days of that week. */
  const setWeekDeload = useCallback((weekMonday, value) => {
    writeOverrides((prev) => {
      const next = { ...prev };
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekMonday);
        d.setDate(d.getDate() + i);
        const key = dateKey(d);
        if (value) next[key] = { ...(next[key] || {}), deload: true };
        else {
          const day = { ...(next[key] || {}) };
          delete day.deload;
          if (Object.keys(day).length === 0) delete next[key];
          else next[key] = day;
        }
      }
      return next;
    });
  }, [writeOverrides]);

  const commitHrMax = useCallback(() => {
    const n = parseInt(hrMaxDraft.trim(), 10);
    updateSettings({ hrMax: hrMaxDraft.trim() !== "" && !isNaN(n) && n > 0 ? n : null });
  }, [hrMaxDraft, updateSettings]);

  const addActivity = useCallback((d, name) => {
    const t = name.trim();
    if (!t) return;
    const key = dateKey(d);
    writeOverrides((prev) => {
      const day = { ...(prev[key] || {}) };
      const list = Array.isArray(day.activities) ? day.activities : [];
      day.activities = [...list, { id: `${Date.now()}`, name: t }];
      return { ...prev, [key]: day };
    });
  }, [writeOverrides]);

  const removeActivity = useCallback((d, id) => {
    const key = dateKey(d);
    writeOverrides((prev) => {
      if (!prev[key]?.activities) return prev;
      const day = { ...prev[key] };
      day.activities = day.activities.filter((a) => a.id !== id);
      const next = { ...prev };
      if (day.activities.length === 0 && !PROGRAM.slots.some((sl) => sl in day)) delete next[key];
      else next[key] = day;
      return next;
    });
  }, [writeOverrides]);

  /* -------------------------------- Derived ------------------------------- */

  const sections = useMemo(
    () => buildSections(
      viewedDate,
      { weekType: "auto", gentler, overrides, hrMax: settings.hrMax, record: rec },
      PROGRAM
    ),
    [viewedDate, gentler, overrides, settings.hrMax, rec]
  );
  const info = useMemo(
    () => resolveSchedule(viewedDate, "auto", overrides, PROGRAM),
    [viewedDate, overrides]
  );

  const countable = useMemo(() => countableTasks(sections), [sections]);

  // Train tab. The same section objects Today renders, filtered - no second
  // definition of a session, so the ring and history cannot disagree with it.
  const trainSections = useMemo(() => sections.filter((s) => s.cat === "strength"), [sections]);
  const trainTasks = useMemo(() => countableTasks(trainSections), [trainSections]);
  const trainDone = trainTasks.filter((t) => isTaskDone(t, rec)).length;
  // Nothing to lift today: find the next scheduled strength session, same
  // resolution rule buildSections uses (slot value -> block -> cat).
  const nextStrength = useMemo(() => {
    if (trainSections.length) return null;
    for (let i = 1; i <= 42; i++) {
      const d = new Date(viewedDate);
      d.setDate(d.getDate() + i);
      const s = resolveSchedule(d, "auto", overrides, PROGRAM);
      for (const slot of PROGRAM.slots) {
        const v = s.slots[slot];
        const block = v && PROGRAM.blocks[slot] && PROGRAM.blocks[slot][v];
        if (block && (block.cat || slot) === "strength") return { date: d, label: block.label };
      }
    }
    return null;
  }, [trainSections, viewedDate, overrides]);
  const doneCount = countable.filter((t) => isTaskDone(t, rec)).length;
  const pct = countable.length ? doneCount / countable.length : 0;

  const historyRows = useMemo(() => buildHistoryRows(log, overrides, PROGRAM), [log, overrides]);
  const trendRows = useMemo(() => historyRows.filter((r) => r.date !== todayKey), [historyRows, todayKey]);
  const streak = useMemo(() => computeStreak(historyRows), [historyRows]);
  const heatmap = useMemo(() => buildHeatmapCells(historyRows, 12), [historyRows]);
  const completionSeries = useMemo(
    () => trendRows.slice(-30).map((r) => ({
      label: r.dateObj.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      pct: Math.round(r.pct * 100),
    })),
    [trendRows]
  );
  const avgPct = trendRows.length
    ? trendRows.slice(-30).reduce((s, r) => s + r.pct, 0) / Math.min(trendRows.length, 30)
    : 0;

  const exercisesWithHistory = useMemo(() => {
    const found = new Set();
    Object.values(log).forEach((r) => {
      Object.entries(r?.loads || {}).forEach(([id, arr]) => {
        if ((arr || []).some((e) => e?.w != null)) found.add(id);
      });
    });
    const nameFor = (id) => {
      for (const block of Object.values(BLOCKS.strength)) {
        const ex = block.exercises.find((e) => e.id === id);
        if (ex) return ex.name;
      }
      return id;
    };
    return [...found]
      .map((id) => ({ id, name: labelForLoadKey(id, nameFor) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [log]);

  useEffect(() => {
    if (!selectedExerciseId && exercisesWithHistory.length) {
      setSelectedExerciseId(exercisesWithHistory[0].id);
    }
  }, [exercisesWithHistory, selectedExerciseId]);

  const loadSeries = useMemo(
    () => (selectedExerciseId ? computeLoadSeries(log, selectedExerciseId, todayKey).slice(-30) : []),
    [log, selectedExerciseId, todayKey]
  );

  /**
   * Every chart in Progress, built from PROGRAM.tracking. Purely declarative:
   * a client tracks something by listing it in their program file, and the
   * chart appears. Nothing here knows what a "bodyweight" or a "unit" is.
   *
   * Three kinds:
   *   scales  1-5 ratings   -> value + rolling average, fixed axis
   *   numbers measurements  -> value + rolling average, auto axis
   *           ...unless rollingTotal is set, in which case the WEEKLY TOTAL is
   *           the meaningful figure (alcohol), not the daily average
   *   rates   yes/no habits -> rolling hit-rate as a percentage
   */
  const trackedCharts = useMemo(() => {
    const t = PROGRAM.tracking || {};
    const out = [];
    const recent = (arr) => arr.slice(-60);

    for (const spec of t.scales || []) {
      const cfg = typeof spec === "string" ? { id: spec, label: spec } : spec;
      const data = recent(computeSeries(trendRows, cfg.id, { bucket: "scales", windowDays: cfg.rolling || 7 }));
      if (data.length) {
        out.push({
          id: cfg.id, title: cfg.label, data, unit: "",
          color: (CATS[cfg.cat] && CATS[cfg.cat].color) || ACCENT_2,
          domain: [1, cfg.max || 5],
          note: `Grey dots are each day. The line is the ${cfg.rolling || 7}-day average — that is the one to read.`,
        });
      }
    }

    for (const cfg of t.numbers || []) {
      if (cfg.chart === false) continue;
      if (cfg.rollingTotal) {
        const data = recent(computeRollingTotal(trendRows, cfg.id, { windowDays: cfg.rollingTotal }));
        if (data.some((d) => d.value > 0)) {
          out.push({
            id: cfg.id, title: cfg.label, data, unit: cfg.unit ? ` ${cfg.unit}` : "",
            color: (CATS[cfg.cat] && CATS[cfg.cat].color) || ACCENT,
            kind: "total", totalWindow: cfg.rollingTotal,
            reference: cfg.reference, referenceLabel: cfg.referenceLabel,
            note: `Grey dots are each day. The line is the running ${cfg.rollingTotal}-day total — the figure worth watching.`,
          });
        }
        continue;
      }
      const data = recent(computeSeries(trendRows, cfg.id, { bucket: "numbers", windowDays: cfg.rolling || 7 }));
      if (data.length) {
        out.push({
          id: cfg.id, title: cfg.label, data, unit: cfg.unit ? ` ${cfg.unit}` : "",
          color: (CATS[cfg.cat] && CATS[cfg.cat].color) || ACCENT,
          domain: ["dataMin - 1", "dataMax + 1"],
          note: `Grey dots are each day. The line is the ${cfg.rolling || 7}-day average — that is the one to read.`,
        });
      }
    }

    for (const cfg of t.rates || []) {
      const data = recent(computeSeries(trendRows, cfg.id, { bucket: "done", windowDays: cfg.rolling || 7 }));
      if (data.length) {
        out.push({
          id: cfg.id, title: cfg.label, data, unit: "%", hideValue: true,
          color: (CATS[cfg.cat] && CATS[cfg.cat].color) || CATS.check.color,
          domain: [0, 100],
          note: `How often you hit this over a rolling ${cfg.rolling || 7} days — smooths out day-to-day noise.`,
        });
      }
    }

    return out;
  }, [trendRows]);

  const lastLoads = useMemo(() => {
    const out = {};
    Object.keys(log).sort().forEach((dstr) => {
      if (dstr >= viewedKey) return;
      Object.entries(log[dstr]?.loads || {}).forEach(([id, arr]) => {
        if ((arr || []).some((e) => e?.w != null || e?.r != null)) {
          const [y, m, d] = dstr.split("-").map(Number);
          out[id] = { dateObj: new Date(y, m - 1, d), entries: arr };
        }
      });
    });
    return out;
  }, [log, viewedKey]);

  const lastExNotes = useMemo(() => {
    const out = {};
    Object.keys(log).sort().forEach((dstr) => {
      if (dstr >= viewedKey) return;
      Object.entries(log[dstr]?.exNotes || {}).forEach(([id, note]) => {
        if (note) out[id] = note;
      });
    });
    return out;
  }, [log, viewedKey]);

  /* -------------------------------- Backup -------------------------------- */

  const exportBackup = useCallback(() => {
    setBackupText(JSON.stringify({ log, overrides, settings, exportedAt: todayKey }));
    setImportStatus("");
  }, [log, overrides, settings, todayKey]);

  const copyBackup = useCallback(async () => {
    const text = backupText || JSON.stringify({ log, overrides, settings });
    if (!backupText) setBackupText(text);
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Select and copy");
    }
    setTimeout(() => setCopyStatus(""), 2500);
  }, [backupText, log, overrides, settings]);

  const importBackup = useCallback(() => {
    try {
      const parsed = JSON.parse(backupText);
      if (!parsed || typeof parsed !== "object") throw new Error("bad");
      setLog(parsed.log || {});
      setOverrides(parsed.overrides || {});
      setSettings(parsed.settings || { gentler: false, hrMax: null });
      store.saveJSON("log", parsed.log || {});
      store.saveJSON("overrides", parsed.overrides || {});
      store.saveJSON("settings", parsed.settings || { gentler: false, hrMax: null });
      // A restore is a deliberate act — push every day of it up.
      Object.keys(parsed.log || {}).forEach((d) => queueLogDay(d, parsed.log[d]));
      queueOverrideChanges({}, parsed.overrides || {});
      queueSettings(parsed.settings || { gentler: false, hrMax: null });
      setImportStatus("Restored");
    } catch {
      setImportStatus("Couldn't read that — check it's a full backup");
    }
    setTimeout(() => setImportStatus(""), 3500);
  }, [backupText]);

  /* --------------------------------- Render -------------------------------- */

  if (loading) {
    return (
      <div style={{ background: BG }} className="min-h-screen flex items-center justify-center">
        <FontImport />
        <p style={{ color: TEXT_SECONDARY, fontFamily: FONT_BODY }} className="text-sm">Loading…</p>
      </div>
    );
  }

  const dateLabel = viewedDate.toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long",
  });
  const size = 88, stroke = 8;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;

  return (
    <div style={{ background: BG, fontFamily: FONT_BODY, color: TEXT_PRIMARY }} className="min-h-screen w-full pb-12">
      <FontImport />

      <div className="px-4 pt-6 pb-4 max-w-md mx-auto">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p style={{ fontFamily: FONT_BODY, color: ACCENT, letterSpacing: "0.16em" }}
               className="text-[10px] uppercase font-semibold">
              {CLIENT_LABEL}
            </p>
            {view === "today" || view === "train" ? (
              <div className="flex items-center gap-1 mt-1 -ml-1.5">
                <button onClick={() => setDayOffset((o) => o - 1)} aria-label="Previous day"
                        style={{ color: TEXT_MUTED }} className="shrink-0 p-1.5 rounded-lg">
                  <ChevronLeft size={18} />
                </button>
                <h1 style={{ fontFamily: FONT_DISPLAY }} className="text-[17px] font-semibold truncate flex-1 text-center">
                  {dateLabel}
                </h1>
                <button onClick={() => setDayOffset((o) => o + 1)} aria-label="Next day"
                        style={{ color: TEXT_MUTED }} className="shrink-0 p-1.5 rounded-lg">
                  <ChevronRight size={18} />
                </button>
              </div>
            ) : (
              <h1 style={{ fontFamily: FONT_DISPLAY }} className="text-lg font-semibold mt-1">
                {view === "calendar" ? "Calendar" : view === "history" ? "Progress" : "Your Program"}
              </h1>
            )}
          </div>
          <button onClick={() => setSettingsOpen((v) => !v)} aria-label="Settings"
                  style={{ borderColor: BORDER, color: settingsOpen ? ACCENT : TEXT_MUTED, background: CARD }}
                  className="mt-1 ml-2 shrink-0 rounded-full border p-2">
            <Settings2 size={16} />
          </button>
        </div>

        <div className="flex gap-1 p-1 rounded-xl border mt-3" style={{ borderColor: BORDER, background: CARD }}>
          {[["today", "Today"], ["train", "Train"], ["calendar", "Calendar"], ["history", "Progress"], ["program", "Program"]].map(([k, label]) => (
            <button key={k} onClick={() => setView(k)}
                    style={{ background: view === k ? ACCENT : "transparent", color: view === k ? ON_ACCENT : TEXT_SECONDARY }}
                    className="flex-1 text-[11px] font-semibold py-1.5 rounded-lg">
              {label}
            </button>
          ))}
        </div>

        {settingsOpen && (
          <div style={{ background: CARD, borderColor: BORDER }} className="mt-3 rounded-2xl border p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold mb-1">Theme</p>
              <p style={{ color: TEXT_MUTED }} className="text-[11px] mb-2">
                Follows you to every device you sign in on.
              </p>
              <div className="flex gap-2">
                {THEME_IDS.map((id) => {
                  const opt = THEMES[id];
                  const chosen = activeTheme.id === id;
                  return (
                    <button key={id} onClick={() => updateSettings({ theme: id })}
                            aria-pressed={chosen}
                            style={{ background: opt.BG, borderColor: chosen ? ACCENT : BORDER,
                                     borderWidth: chosen ? 2 : 1 }}
                            className="flex-1 rounded-xl border px-3 py-2.5 flex items-center gap-2 text-left">
                      <span style={{ background: opt.ACCENT }} className="shrink-0 w-3.5 h-3.5 rounded-full" />
                      <span style={{ color: opt.TEXT_PRIMARY, fontFamily: opt.FONT_BODY }}
                            className="text-xs font-semibold">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {PROGRAM.usesHeartRate && (
              <div style={{ borderColor: BORDER }} className="border-t pt-4">
                <p className="text-xs font-semibold mb-1">Max heart rate</p>
                <p style={{ color: TEXT_MUTED }} className="text-[11px] mb-2">
                  Turns the percentage zones on cardio days into actual numbers, e.g. "90–95% HRmax (158–166 bpm)".
                </p>
                <div className="flex items-center gap-1.5">
                  <input type="text" inputMode="numeric" value={hrMaxDraft} placeholder="e.g. 175"
                         onChange={(e) => setHrMaxDraft(e.target.value)} onBlur={commitHrMax}
                         onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                         style={{ fontFamily: FONT_MONO, borderColor: BORDER, background: BG, color: TEXT_PRIMARY }}
                         className="w-20 text-sm px-2.5 py-1.5 rounded-lg border" />
                  <span style={{ color: TEXT_MUTED }} className="text-xs">bpm</span>
                </div>
              </div>
            )}

            <div style={{ borderColor: BORDER }} className="border-t pt-4">
              <p className="text-xs font-semibold mb-1">Account &amp; sync</p>
              {!isConfigured() ? (
                <p style={{ color: TEXT_MUTED }} className="text-[11px]">
                  This build is not connected to an account. Everything stays on this device.
                </p>
              ) : authUser ? (
                <>
                  <p style={{ color: TEXT_MUTED }} className="text-[11px] mb-1">
                    Signed in as {authUser.email}
                  </p>
                  <p style={{ color: TEXT_MUTED }} className="text-[11px] mb-2">
                    {syncState.status === "syncing"
                      ? "Saving to your account…"
                      : syncState.pendingCount > 0
                      ? `${syncState.pendingCount} change${syncState.pendingCount === 1 ? "" : "s"} waiting for a connection`
                      : syncState.status === "error"
                      ? "No connection — saved on this device, will sync later"
                      : syncState.lastSyncedAt
                      ? `Everything saved · ${new Date(syncState.lastSyncedAt).toLocaleTimeString()}`
                      : "Connected"}
                  </p>
                  <div className="flex gap-1.5">
                    <button onClick={() => flushNow()} style={{ borderColor: BORDER }}
                            className="flex-1 text-xs font-semibold py-1.5 rounded-lg border">Sync now</button>
                    <button onClick={async () => {
                              await signOut();
                              syncedUserRef.current = null;
                              setAuthMsg("Signed out. Your log is still here on this device.");
                            }}
                            style={{ borderColor: BORDER }}
                            className="flex-1 text-xs font-semibold py-1.5 rounded-lg border">Sign out</button>
                  </div>

                  <div style={{ borderColor: BORDER }} className="border-t mt-3 pt-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold">Share with your coach</p>
                        <p style={{ color: TEXT_MUTED }} className="text-[11px] mt-0.5">
                          {!sharing.linked
                            ? "No coach is linked to this account, so nothing is being shared."
                            : sharing.enabled
                            ? "Your coach can see your logged sessions. Switch this off any time — your log stays exactly as it is, it just stops being visible to them."
                            : "Sharing is off. Your coach cannot see your sessions. Nothing has been deleted — switching it back on makes everything visible again."}
                        </p>
                      </div>
                      {sharing.linked && (
                        <button onClick={async () => {
                                  const next = !sharing.enabled;
                                  setSharingBusy(true);
                                  setSharing((prev) => ({ ...prev, enabled: next }));
                                  const r = await setCoachSharing(next);
                                  setSharingBusy(false);
                                  if (!r.ok) {
                                    // Put the switch back where it was: a failed
                                    // write must never leave the UI claiming a
                                    // privacy setting that did not take effect.
                                    setSharing((prev) => ({ ...prev, enabled: !next }));
                                    setAuthMsg(r.error || "Could not change sharing.");
                                  } else {
                                    setAuthMsg(next ? "Sharing is on." : "Sharing is off.");
                                  }
                                }}
                                disabled={sharingBusy}
                                aria-pressed={Boolean(sharing.enabled)}
                                aria-label="Toggle sharing with your coach"
                                style={{ background: sharing.enabled ? ACCENT : BORDER, opacity: sharingBusy ? 0.6 : 1 }}
                                className="shrink-0 w-11 h-6 rounded-full relative transition-colors">
                          <span style={{ background: KNOB, left: sharing.enabled ? 22 : 3 }}
                                className="absolute top-0.5 w-5 h-5 rounded-full transition-all shadow-sm" />
                        </button>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ color: TEXT_MUTED }} className="text-[11px] mb-2">
                    Sign in to back up your log and use it on more than one device. The app works
                    without it — everything just stays on this device.
                  </p>
                  <div className="flex gap-1.5">
                    <input type="email" inputMode="email" value={emailDraft} placeholder="you@example.com"
                           onChange={(e) => setEmailDraft(e.target.value)}
                           style={{ borderColor: BORDER, background: BG, color: TEXT_PRIMARY }}
                           className="flex-1 min-w-0 text-xs px-2.5 py-1.5 rounded-lg border" />
                    <button onClick={async () => {
                              setAuthMsg("Sending…");
                              const r = await sendMagicLink(emailDraft);
                              setAuthMsg(r.ok ? "Check your email for a sign-in link." : r.error);
                            }}
                            style={{ background: ACCENT, color: BG }}
                            className="shrink-0 text-xs font-semibold px-3 rounded-lg">Send link</button>
                  </div>
                </>
              )}
              {authMsg && <p style={{ color: TEXT_MUTED }} className="text-[11px] mt-2">{authMsg}</p>}
            </div>

            <div style={{ borderColor: BORDER }} className="border-t pt-4">
              <p className="text-xs font-semibold mb-1">Backup</p>
              <p style={{ color: TEXT_MUTED }} className="text-[11px] mb-2">
                Your log lives on this device. Copy a backup now and then, and keep it somewhere safe.
              </p>
              <div className="flex gap-1.5 mb-2">
                <button onClick={exportBackup} style={{ borderColor: BORDER }}
                        className="flex-1 text-xs font-semibold py-1.5 rounded-lg border">Show backup</button>
                <button onClick={copyBackup} style={{ borderColor: BORDER }}
                        className="flex-1 text-xs font-semibold py-1.5 rounded-lg border">{copyStatus || "Copy"}</button>
              </div>
              <textarea value={backupText} onChange={(e) => setBackupText(e.target.value)} rows={3}
                        placeholder="Backup appears here — or paste one to restore"
                        style={{ fontFamily: FONT_MONO, background: BG, borderColor: BORDER }}
                        className="w-full text-[10px] p-2 rounded-lg border" />
              <div className="flex items-center justify-between mt-2">
                <button onClick={importBackup} style={{ color: ACCENT }} className="text-[11px] font-semibold">
                  Restore from above
                </button>
                {importStatus && <span style={{ color: TEXT_MUTED }} className="text-[11px]">{importStatus}</span>}
              </div>
            </div>
            <p style={{ color: TEXT_MUTED }} className="text-[10px]">v{APP_VERSION}</p>
          </div>
        )}

        {view === "today" && (
          <>
            {/* Sick / travel / injured. One tap clears the day's training
                everywhere; tapping the active reason again restores it. */}
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              <span style={{ color: TEXT_MUTED }} className="text-[11px] mr-0.5">Skip day:</span>
              {SKIP_REASONS.map((r) => {
                const on = info.skip === r.value;
                return (
                  <button key={r.value}
                          onClick={() => setSkip(viewedDate, on ? null : r.value)}
                          aria-pressed={on}
                          style={{
                            background: on ? CATS.check.color : "transparent",
                            color: on ? ON_ACCENT : TEXT_SECONDARY,
                            borderColor: on ? CATS.check.color : BORDER,
                          }}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border">
                    {r.label}
                  </button>
                );
              })}
              {info.skip && (
                <button onClick={() => setSkip(viewedDate, null)} style={{ color: ACCENT }}
                        className="text-[11px] font-semibold ml-0.5">
                  Clear
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {info.skip && (
                <span style={{ background: BADGE.neutral.tint, color: CATS.check.color, borderColor: BADGE.neutral.border }}
                      className="text-[11px] px-2 py-0.5 rounded-full border font-medium flex items-center gap-1">
                  <Ban size={11} /> {info.skipLabel} day
                </span>
              )}
              {ramp && (
                <span style={{ background: BADGE.ramp.tint, color: BADGE.ramp.text, borderColor: BADGE.ramp.border }}
                      className="text-[11px] px-2 py-0.5 rounded-full border font-medium">
                  Week {weeksSinceStart(viewedDate) + 1} · easing in
                </span>
              )}
              {gentler && (
                <span style={{ background: BADGE.gentler.tint, color: ACCENT, borderColor: BADGE.gentler.border }}
                      className="text-[11px] px-2 py-0.5 rounded-full border font-medium">
                  Gentler week
                </span>
              )}
              {info.anyMoved && (
                <span style={{ background: BADGE.moved.tint, color: BADGE.moved.text, borderColor: BADGE.moved.border }}
                      className="text-[11px] px-2 py-0.5 rounded-full border font-medium">
                  Rearranged
                </span>
              )}
              {dayOffset !== 0 && (
                <button onClick={() => setDayOffset(0)} style={{ color: ACCENT }} className="text-[11px] font-semibold">
                  Back to today
                </button>
              )}
            </div>

            <div className="flex items-center gap-4 mt-5">
              <div style={{ width: size, height: size }} className="relative shrink-0">
                <svg width={size} height={size}>
                  <defs>
                    <linearGradient id="ring" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor={ACCENT} />
                      <stop offset="100%" stopColor={ACCENT_2} />
                    </linearGradient>
                  </defs>
                  <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={BORDER} strokeWidth={stroke} />
                  <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="url(#ring)" strokeWidth={stroke}
                          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
                          transform={`rotate(-90 ${size / 2} ${size / 2})`}
                          style={{ transition: "stroke-dashoffset 300ms ease" }} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span style={{ fontFamily: FONT_MONO }} className="text-base font-semibold">{Math.round(pct * 100)}%</span>
                </div>
              </div>
              <div>
                <p style={{ fontFamily: FONT_MONO }} className="text-sm">{doneCount} of {countable.length} done</p>
                <p style={{ color: TEXT_MUTED }} className="text-xs mt-0.5">
                  {dayOffset === 0 ? "Tick things off as you go" : dayOffset < 0 ? "Past day — edits save to that day" : "Coming up"}
                </p>
              </div>
            </div>
          </>
        )}

        {view === "train" && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {trainTasks.length > 0 && (
              <span style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }} className="text-xs">
                {trainDone} of {trainTasks.length} exercises done
              </span>
            )}
            {trainTasks.length > 0 && ramp && (
              <span style={{ background: BADGE.ramp.tint, color: BADGE.ramp.text, borderColor: BADGE.ramp.border }}
                    className="text-[11px] px-2 py-0.5 rounded-full border font-medium">
                Week {weeksSinceStart(viewedDate) + 1} · easing in
              </span>
            )}
            {trainTasks.length > 0 && gentler && (
              <span style={{ background: BADGE.gentler.tint, color: ACCENT, borderColor: BADGE.gentler.border }}
                    className="text-[11px] px-2 py-0.5 rounded-full border font-medium">
                Gentler week
              </span>
            )}
            {dayOffset !== 0 && (
              <button onClick={() => setDayOffset(0)} style={{ color: ACCENT }} className="text-[11px] font-semibold">
                Back to today
              </button>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------- Train -------------------------------- */}
      {view === "train" && trainSections.length === 0 && (
        <div className="px-4 max-w-md mx-auto">
          <div style={{ background: CARD, borderColor: BORDER }} className="rounded-2xl border p-5 text-center">
            <Dumbbell size={20} style={{ color: TEXT_MUTED }} className="mx-auto mb-2" />
            <p className="text-sm font-semibold">
              {info.skip ? `${info.skipLabel} day — training cleared` : "No strength session this day"}
            </p>
            {nextStrength ? (
              <>
                <p style={{ color: TEXT_MUTED }} className="text-xs mt-1">
                  Next: {nextStrength.label} · {nextStrength.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                </p>
                <button onClick={() => setDayOffset(daysBetween(today, nextStrength.date))}
                        style={{ color: ACCENT, borderColor: ACCENT }}
                        className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg border">
                  Go to that day
                </button>
              </>
            ) : (
              <p style={{ color: TEXT_MUTED }} className="text-xs mt-1">None scheduled in the next six weeks.</p>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------- Today -------------------------------- */}
      {(view === "today" || (view === "train" && trainSections.length > 0)) && (
        <div className="px-4 max-w-md mx-auto space-y-3">
          {(view === "train" ? trainSections : sections).map((section) => {
            const inTrain = view === "train";
            const cat = CATS[section.cat] || CATS.check;
            const Icon = cat.Icon;
            const plainIds = section.tasks.filter((t) => !t.type || t.type === "exercise").map((t) => t.id);
            const allDone = plainIds.length > 0 && plainIds.every((id) => rec?.done?.[id]);
            const hasTasks = section.tasks.length > 0;
            const defaultOpen = !["strength", "mobility"].includes(section.key);
            const isOpen = inTrain || (sectionOpen[section.key] !== undefined ? sectionOpen[section.key] : defaultOpen);
            const toggle = hasTasks && !inTrain;

            // Today: strength collapses to a summary. The session itself is
            // logged in Train; ticks and "All" still work here unchanged.
            if (!inTrain && section.cat === "strength") {
              const sTasks = section.tasks.filter((t) => t.type !== "notes");
              const sDone = sTasks.filter((t) => isTaskDone(t, rec)).length;
              return (
                <div key={section.key} style={{ background: CARD, borderColor: BORDER }}
                     className="rounded-2xl border overflow-hidden">
                  <div style={{ borderLeftColor: cat.color }} className="border-l-4 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon size={15} style={{ color: cat.color }} className="shrink-0" />
                        <h2 style={{ fontFamily: FONT_DISPLAY }} className="text-sm font-semibold truncate">{section.title}</h2>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }} className="text-[11px]">
                          {sDone}/{sTasks.length}
                        </span>
                        {plainIds.length > 0 && (
                          <button onClick={() => markSection(plainIds, !allDone)}
                                  style={{ color: cat.color }} className="text-[11px] font-semibold">
                            {allDone ? "Clear" : "All"}
                          </button>
                        )}
                      </div>
                    </div>
                    {section.subtitle && (
                      <p style={{ color: TEXT_MUTED }} className="text-[12px] mt-1">{section.subtitle}</p>
                    )}
                    <button onClick={() => { setView("train"); window.scrollTo(0, 0); }}
                            style={{ color: cat.color, borderColor: cat.color }}
                            className="mt-2.5 w-full text-xs font-semibold py-2 rounded-lg border flex items-center justify-center gap-1.5">
                      <Dumbbell size={13} /> Open in Train <ChevronRight size={13} />
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={section.key} style={{ background: CARD, borderColor: BORDER }}
                   className="rounded-2xl border overflow-hidden">
                <div role={toggle ? "button" : undefined} tabIndex={toggle ? 0 : undefined}
                     onClick={() => toggle && setSectionOpen((p) => ({ ...p, [section.key]: !isOpen }))}
                     onKeyDown={(e) => { if (toggle && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setSectionOpen((p) => ({ ...p, [section.key]: !isOpen })); } }}
                     style={{ borderLeftColor: cat.color }}
                     className={`border-l-4 px-4 py-3 ${toggle ? "cursor-pointer select-none" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon size={15} style={{ color: cat.color }} className="shrink-0" />
                      <h2 style={{ fontFamily: FONT_DISPLAY }} className="text-sm font-semibold truncate">{section.title}</h2>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {plainIds.length > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); markSection(plainIds, !allDone); }}
                                style={{ color: cat.color }} className="text-[11px] font-semibold">
                          {allDone ? "Clear" : "All"}
                        </button>
                      )}
                      {toggle && (
                        <ChevronDown size={16} style={{ color: TEXT_MUTED, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 200ms" }} />
                      )}
                    </div>
                  </div>
                  {section.subtitle && (
                    <p style={{ color: TEXT_MUTED }} className="text-[12px] mt-1">{section.subtitle}</p>
                  )}
                </div>

                {hasTasks && isOpen && (
                  <div style={{ borderColor: BORDER }} className="border-t">
                    {section.tasks.map((task, i) => {
                      const border = { borderColor: BORDER, borderTopWidth: i === 0 ? 0 : 1 };

                      if (task.type === "scale") {
                        const value = rec?.scales?.[task.id];
                        const has = value != null;
                        return (
                          <div key={task.id} style={border} className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <span style={{ background: has ? cat.color : "transparent", borderColor: has ? cat.color : BORDER }}
                                    className="shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center">
                                {has && <Check size={12} strokeWidth={3} color={ON_ACCENT} />}
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-medium">{task.name}</p>
                                <p style={{ color: TEXT_MUTED }} className="text-[11px]">{task.presc}</p>
                              </div>
                            </div>
                            <div className="flex gap-1.5 mt-2 ml-8">
                              {task.scale.map((n) => (
                                <button key={n} onClick={() => setScale(task.id, n)}
                                        style={{
                                          background: value === n ? cat.color : "transparent",
                                          color: value === n ? ON_ACCENT : TEXT_SECONDARY,
                                          borderColor: value === n ? cat.color : BORDER,
                                        }}
                                        className="w-9 h-9 text-sm font-semibold rounded-lg border">
                                  {n}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      }

                      if (task.type === "choice") {
                        const picked = rec?.choices?.[task.id];
                        const has = typeof picked === "string";
                        const isZero = has && task.zeroOption && picked === task.zeroOption;
                        const countKey = `num:${task.countId}`;
                        const countVal = task.countId ? rec?.numbers?.[task.countId] : null;
                        return (
                          <div key={task.id} style={border} className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <span style={{ background: has ? cat.color : "transparent", borderColor: has ? cat.color : BORDER }}
                                    className="shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center">
                                {has && <Check size={12} strokeWidth={3} color={ON_ACCENT} />}
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-medium">{task.name}</p>
                                <p style={{ color: TEXT_MUTED }} className="text-[11px]">{task.presc}</p>
                              </div>
                            </div>
                            <div className="flex gap-1.5 mt-2 ml-8 flex-wrap">
                              {task.options.map((opt) => (
                                <button key={opt.value}
                                        onClick={() => setChoice(task, picked === opt.value ? null : opt.value)}
                                        style={{
                                          background: picked === opt.value ? cat.color : "transparent",
                                          color: picked === opt.value ? ON_ACCENT : TEXT_SECONDARY,
                                          borderColor: picked === opt.value ? cat.color : BORDER,
                                        }}
                                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border">
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                            {has && !isZero && task.countId && (
                              <div className="flex items-center gap-1.5 mt-2 ml-8">
                                <span style={{ color: TEXT_MUTED }} className="text-[11px]">
                                  {task.countLabel || "How many?"}
                                </span>
                                <input type="text" inputMode="decimal"
                                       aria-label={`${task.name}, ${task.countUnit || ""}`}
                                       placeholder={task.countUnit || ""}
                                       value={loadDrafts[countKey] ?? (typeof countVal === "number" ? String(countVal) : "")}
                                       onChange={(e) => setLoadDrafts((p2) => ({ ...p2, [countKey]: e.target.value }))}
                                       onBlur={(e) => commitNumber(task.countId, e.target.value)}
                                       onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                                       style={{ fontFamily: FONT_MONO, borderColor: BORDER, background: BG, color: TEXT_PRIMARY }}
                                       className="w-14 text-right text-sm px-2 py-1 rounded-md border" />
                                <span style={{ color: TEXT_MUTED }} className="text-xs">{task.countUnit}</span>
                              </div>
                            )}
                          </div>
                        );
                      }

                      if (task.type === "number") {
                        const value = rec?.numbers?.[task.id];
                        const has = typeof value === "number";
                        const draftKey = `num:${task.id}`;
                        // Targets colour the tick: green when met, category
                        // colour when logged but missed. No target = neutral.
                        const met = targetMet(task, rec);
                        const dotColor = met === true ? OK_COLOR : cat.color;
                        const diff = has && task.target != null ? Math.round(value - task.target) : null;
                        return (
                          <div key={task.id} style={border} className="flex items-center gap-3 px-4 py-3">
                            <span style={{ background: has ? dotColor : "transparent", borderColor: has ? dotColor : BORDER }}
                                  className="shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center">
                              {has && <Check size={12} strokeWidth={3} color={ON_ACCENT} />}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{task.name}</p>
                              <p style={{ fontFamily: FONT_MONO, color: met === false ? cat.color : TEXT_MUTED }}
                                 className="text-[11px] mt-0.5">
                                {task.presc}
                                {diff != null && ` · ${diff > 0 ? "+" : ""}${diff}`}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <input type="text" inputMode={task.unit === TIME_UNIT ? "text" : "decimal"}
                                     aria-label={`${task.name}, ${task.unit}`}
                                     placeholder={task.unit}
                                     value={loadDrafts[draftKey] ?? (has ? (task.unit === TIME_UNIT ? formatTime(value) : String(value)) : "")}
                                     onChange={(e) => setLoadDrafts((p2) => ({ ...p2, [draftKey]: e.target.value }))}
                                     onBlur={(e) => commitNumber(task.id, e.target.value)}
                                     onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                                     style={{ fontFamily: FONT_MONO, borderColor: BORDER, background: BG, color: TEXT_PRIMARY }}
                                     className={`${task.unit === TIME_UNIT ? "w-20" : "w-16"} text-right text-sm px-2 py-1 rounded-md border`} />
                              {task.unit !== TIME_UNIT && <span style={{ color: TEXT_MUTED }} className="text-xs">{task.unit}</span>}
                            </div>
                          </div>
                        );
                      }
                      if (task.type === "notes") {
                        return (
                          <div key={task.id} style={border} className="px-4 py-3">
                            <p className="text-sm font-medium mb-1.5">{task.name}</p>
                            <textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)}
                                      onBlur={commitNotes} placeholder={task.presc} rows={2}
                                      style={{ borderColor: BORDER, background: BG }}
                                      className="w-full text-xs p-2 rounded-lg border resize-none" />
                          </div>
                        );
                      }

                      const checked = Boolean(rec?.done?.[task.id]);
                      const sub = rec?.subs?.[task.id];
                      const isSub = Boolean(sub?.name);
                      const collapsible = section.cat === "strength" || section.cat === "mobility";
                      const open = inTrain || Boolean(expanded[task.id]);

                      return (
                        <div key={task.id} style={border}>
                          <div role="button" tabIndex={0}
                               onClick={() => toggleTask(task.id)}
                               onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleTask(task.id); } }}
                               className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none">
                            <span style={{ background: checked || isSub ? cat.color : "transparent", borderColor: checked || isSub ? cat.color : BORDER }}
                                  className="shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center">
                              {isSub ? <Repeat size={11} strokeWidth={3} color={ON_ACCENT} /> : checked && <Check size={12} strokeWidth={3} color={ON_ACCENT} />}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p style={{ color: checked && !isSub ? TEXT_MUTED : TEXT_PRIMARY, textDecoration: checked && !isSub ? "line-through" : "none" }}
                                 className="text-sm font-medium truncate">
                                {isSub ? sub.name : task.name}
                              </p>
                              {!collapsible && <p style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }} className="text-[11px] mt-0.5">{task.presc}</p>}
                            </div>
                            {inTrain ? null : collapsible ? (
                              <button onClick={(e) => { e.stopPropagation(); setExpanded((p) => ({ ...p, [task.id]: !open })); }}
                                      aria-label={open ? "Hide detail" : "Show detail"} aria-expanded={open}
                                      style={{ color: TEXT_MUTED }} className="shrink-0 p-1">
                                <ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 200ms" }} />
                              </button>
                            ) : task.video ? (
                              <a href={task.video} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                                 style={{ color: cat.color }} className="shrink-0 p-1.5" aria-label="Watch demonstration">
                                <ExternalLink size={14} />
                              </a>
                            ) : null}
                          </div>

                          {collapsible && open && (
                            <div className="px-4 pb-3 pl-12 -mt-1 space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY, background: BG, borderColor: BORDER }}
                                      className="text-[11px] px-2 py-1 rounded-md border">{task.presc}</span>
                                {task.video && (
                                  <a href={task.video} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                                     style={{ color: cat.color }} className="text-[11px] font-semibold flex items-center gap-1">
                                    Watch <ExternalLink size={11} />
                                  </a>
                                )}
                              </div>
                              {task.detail && <p style={{ color: TEXT_SECONDARY }} className="text-[11px]">{task.detail}</p>}

                              {section.cat === "strength" && (() => {
                                const count = setCountFor(task, ramp);
                                const lk = loadKeyFor(task.id, rec);
                                const last = lastLoads[lk];
                                const lastNote = lastExNotes[task.id];
                                const swapped = Boolean(sub?.name);
                                return (
                                  <>
                                    {lastNote && (
                                      <p style={{ background: TINT.soft, color: ACCENT, borderColor: TINT.softBorder }}
                                         className="text-[11px] px-2 py-1 rounded-md border">📌 {lastNote}</p>
                                    )}
                                    {last && (
                                      <p style={{ color: TEXT_MUTED }} className="text-[11px]">
                                        Last: {last.entries.map((e) => (e?.w != null ? `${e.w}${e.r != null ? `×${e.r}` : ""}` : "–")).join(", ")}
                                        {" · "}{daysBetween(last.dateObj, viewedDate)}d ago
                                      </p>
                                    )}
                                    {!last && swapped && (
                                      <p style={{ color: TEXT_MUTED }} className="text-[11px]">
                                        First time doing this — no previous data
                                      </p>
                                    )}
                                    <div className="flex gap-2 flex-wrap">
                                      {Array.from({ length: count }).map((_, si) => {
                                        const wKey = `${lk}:${si}:w`, rKey = `${lk}:${si}:r`;
                                        const le = last?.entries?.[si];
                                        return (
                                          <div key={si} className="flex flex-col items-center gap-0.5">
                                            <span style={{ color: TEXT_MUTED }} className="text-[9px] uppercase tracking-wide">Set {si + 1}</span>
                                            <div className="flex gap-1">
                                              <input type="text" inputMode="decimal" aria-label={`${task.name} set ${si + 1} kg`}
                                                     placeholder={le?.w != null ? String(le.w) : "kg"}
                                                     value={loadDrafts[wKey] ?? ""} onClick={(e) => e.stopPropagation()}
                                                     onChange={(e) => setLoadDrafts((p) => ({ ...p, [wKey]: e.target.value }))}
                                                     onBlur={(e) => commitLoad(lk, si, "w", e.target.value, count)}
                                                     style={{ fontFamily: FONT_MONO, borderColor: BORDER, background: BG }}
                                                     className="w-11 text-center text-xs px-1 py-1 rounded-md border" />
                                              <input type="text" inputMode="numeric" aria-label={`${task.name} set ${si + 1} reps`}
                                                     placeholder={le?.r != null ? String(le.r) : "reps"}
                                                     value={loadDrafts[rKey] ?? ""} onClick={(e) => e.stopPropagation()}
                                                     onChange={(e) => setLoadDrafts((p) => ({ ...p, [rKey]: e.target.value }))}
                                                     onBlur={(e) => commitLoad(lk, si, "r", e.target.value, count)}
                                                     style={{ fontFamily: FONT_MONO, borderColor: BORDER, background: BG }}
                                                     className="w-10 text-center text-xs px-1 py-1 rounded-md border" />
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>

                                    {task.pattern && (() => {
                                      const opts = variantsFor(task.pattern, {
                                        prescribedName: task.name,
                                        alsoToday: section.tasks.filter((t) => t.id !== task.id).map((t) => t.name),
                                        noGym: Boolean(section.noGym),
                                      });
                                      const open = swapOpen === task.id;
                                      if (swapped) {
                                        return (
                                          <div style={{ borderColor: BORDER }} className="pt-2 border-t space-y-1.5">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span style={{ background: cat.color, color: ON_ACCENT }}
                                                    className="text-[11px] font-semibold px-2 py-1 rounded-lg flex items-center gap-1.5">
                                                <Repeat size={11} /> Doing: {sub.name}
                                              </span>
                                              <button onClick={(e) => { e.stopPropagation(); setSwap(task.id, "", null); setSwapOpen(null); }}
                                                      style={{ color: TEXT_SECONDARY }} className="text-[11px] font-semibold">
                                                Back to prescribed
                                              </button>
                                            </div>
                                            <div className="flex gap-1 flex-wrap items-center">
                                              <span style={{ color: TEXT_MUTED }} className="text-[10px]">Why? (optional)</span>
                                              {["equipment", "pain", "time", "fatigue", "other"].map((rsn) => (
                                                <button key={rsn} onClick={(e) => { e.stopPropagation(); setSwapReason(task.id, rsn); }}
                                                        style={{
                                                          background: sub.reason === rsn ? cat.color : "transparent",
                                                          color: sub.reason === rsn ? ON_ACCENT : TEXT_SECONDARY,
                                                          borderColor: sub.reason === rsn ? cat.color : BORDER,
                                                        }}
                                                        className="text-[10px] font-semibold px-2 py-0.5 rounded-lg border capitalize">
                                                  {rsn}
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                        );
                                      }
                                      return (
                                        <div style={{ borderColor: BORDER }} className="pt-2 border-t">
                                          {!open ? (
                                            <button onClick={(e) => { e.stopPropagation(); setSwapOpen(task.id); }}
                                                    style={{ color: TEXT_SECONDARY, borderColor: BORDER }}
                                                    className="text-[11px] font-semibold flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border">
                                              <Repeat size={12} /> Swap exercise
                                            </button>
                                          ) : (
                                            <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                                              <div className="flex items-center justify-between">
                                                <span style={{ color: TEXT_MUTED }} className="text-[10px] uppercase tracking-wide">
                                                  Swap to
                                                </span>
                                                <button onClick={() => setSwapOpen(null)} style={{ color: TEXT_SECONDARY }}
                                                        className="text-[11px] font-semibold">Cancel</button>
                                              </div>
                                              {opts.length === 0 && (
                                                <p style={{ color: TEXT_MUTED }} className="text-[11px]">
                                                  No alternatives available for this session.
                                                </p>
                                              )}
                                              {opts.map((v) => (
                                                <button key={v.name}
                                                        onClick={() => { setSwap(task.id, v.name, null); setSwapOpen(null); }}
                                                        style={{ borderColor: BORDER, color: TEXT_PRIMARY }}
                                                        className="w-full text-left text-[11px] px-2.5 py-1.5 rounded-lg border flex items-center justify-between">
                                                  <span>{v.name}</span>
                                                  <span style={{ color: TEXT_MUTED }} className="text-[10px]">{v.equip}</span>
                                                </button>
                                              ))}
                                              <div className="flex gap-1.5">
                                                <input type="text" value={swapFree[task.id] ?? ""}
                                                       onChange={(e) => setSwapFree((p) => ({ ...p, [task.id]: e.target.value }))}
                                                       placeholder="Something else…"
                                                       style={{ color: TEXT_PRIMARY, borderColor: BORDER, background: BG }}
                                                       className="flex-1 min-w-0 text-[11px] px-2.5 py-1.5 rounded-lg border" />
                                                <button onClick={() => {
                                                          const t = (swapFree[task.id] || "").trim();
                                                          if (!t) return;
                                                          setSwap(task.id, t, null);
                                                          setSwapFree((p) => ({ ...p, [task.id]: "" }));
                                                          setSwapOpen(null);
                                                        }}
                                                        style={{ background: cat.color, color: ON_ACCENT }}
                                                        className="shrink-0 text-[11px] font-semibold px-3 rounded-lg">Use</button>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })()}

                                    {task.altName && (
                                      <button onClick={(e) => { e.stopPropagation(); toggleAlt(task.id, task.altName); }}
                                              style={{ color: isSub ? ON_ACCENT : cat.color, background: isSub ? cat.color : "transparent", borderColor: cat.color }}
                                              className="text-[11px] font-semibold flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border">
                                        <Repeat size={12} />
                                        {isSub ? `Doing: ${task.altName} — switch back` : `Easier option: ${task.altName}`}
                                      </button>
                                    )}
                                    {task.altVideo && (
                                      <a href={task.altVideo} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                                         style={{ color: TEXT_SECONDARY }} className="text-[11px] flex items-center gap-1">
                                        Watch the easier option <ExternalLink size={10} />
                                      </a>
                                    )}

                                    <div style={{ borderColor: BORDER }} className="pt-2 border-t">
                                      {editingNote === task.id ? (
                                        <div onClick={(e) => e.stopPropagation()}>
                                          <input type="text" value={exNoteDrafts[task.id] ?? ""}
                                                 onChange={(e) => setExNoteDrafts((p) => ({ ...p, [task.id]: e.target.value }))}
                                                 onBlur={(e) => commitExNote(task.id, e.target.value)}
                                                 placeholder="e.g. try 10 kg next time"
                                                 style={{ borderColor: BORDER, background: BG }}
                                                 className="w-full text-xs px-2.5 py-1.5 rounded-lg border" />
                                          <button onClick={() => setEditingNote(null)} style={{ color: TEXT_SECONDARY }}
                                                  className="text-[11px] font-semibold mt-1.5">Done</button>
                                        </div>
                                      ) : (
                                        <button onClick={(e) => { e.stopPropagation(); setEditingNote(task.id); setExNoteDrafts((p) => ({ ...p, [task.id]: rec?.exNotes?.[task.id] || "" })); }}
                                                style={{ color: TEXT_SECONDARY }} className="text-[11px] font-semibold">
                                          📌 {rec?.exNotes?.[task.id] ? "Edit note" : "Note for next time"}
                                        </button>
                                      )}
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ------------------------------ Calendar ------------------------------ */}
      {view === "calendar" && (
        <CalendarView
          {...{ calYear, calMonth, setCalYear, setCalMonth, calSelected, setCalSelected, overrides,
                todayKey, today, moveSource, setMoveSource, swapBlock, setBlock, resetBlock,
                editingBlock, setEditingBlock, activityDraft, setActivityDraft, addActivity, removeActivity,
                setSkip, setWeekDeload }}
        />
      )}

      {/* ------------------------------- Progress ----------------------------- */}
      {view === "history" && (
        <div className="px-4 max-w-md mx-auto space-y-3">
          {historyRows.length === 0 ? (
            <div style={{ background: CARD, borderColor: BORDER }} className="rounded-2xl border p-6 text-center">
              <CalendarDays size={22} style={{ color: TEXT_MUTED }} className="mx-auto mb-2" />
              <p className="text-sm font-medium">Nothing here yet</p>
              <p style={{ color: TEXT_MUTED }} className="text-xs mt-1">
                Tick off today and come back — your trends build up day by day.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[[historyRows.length, "Days logged"], [`${Math.round(avgPct * 100)}%`, "Avg · 30d"], [streak, "Streak"]].map(([v, l]) => (
                  <div key={l} style={{ background: CARD, borderColor: BORDER }} className="rounded-xl border p-3 text-center">
                    <p style={{ fontFamily: FONT_MONO }} className="text-lg font-semibold">{v}</p>
                    <p style={{ color: TEXT_MUTED }} className="text-[10px] mt-0.5 uppercase tracking-wide">{l}</p>
                  </div>
                ))}
              </div>

              {trackedCharts.map((c) => (
                <ChartCard key={c.id} {...c} />
              ))}

              {(
                <div style={{ background: CARD, borderColor: BORDER }} className="rounded-2xl border p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h2 style={{ fontFamily: FONT_DISPLAY }} className="text-sm font-semibold">Getting stronger</h2>
                    {exercisesWithHistory.length > 0 && <select value={selectedExerciseId || ""} onChange={(e) => setSelectedExerciseId(e.target.value)}
                            style={{ background: BG, borderColor: BORDER, color: TEXT_PRIMARY }}
                            className="text-[11px] px-2 py-1 rounded-lg border max-w-[150px]">
                      {exercisesWithHistory.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>}
                  </div>
                  {loadSeries.length > 1 ? (
                    <div style={{ width: "100%", height: 150 }}>
                      <ResponsiveContainer>
                        <LineChart data={loadSeries} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                          <CartesianGrid stroke={BORDER} strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" tick={{ fill: TEXT_MUTED, fontSize: 10 }} axisLine={{ stroke: BORDER }} tickLine={false} interval="preserveStartEnd" />
                          <YAxis domain={["dataMin - 2", "dataMax + 2"]} tick={{ fill: TEXT_MUTED, fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
                          <Tooltip contentStyle={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, fontFamily: FONT_MONO, fontSize: 11 }}
                                   formatter={(v) => [`${v} kg`, "Heaviest set"]} />
                          <Line type="monotone" dataKey="maxWeight" stroke={ACCENT} strokeWidth={2.5} dot={{ r: 2, fill: ACCENT }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p style={{ color: TEXT_MUTED }} className="text-xs">
                      {exercisesWithHistory.length === 0
                        ? "Type the weight and reps into each set while you train, and your progress appears here — one line per exercise."
                        : "Log this exercise on two sessions and a trend appears here."}
                    </p>
                  )}
                </div>
              )}

              {completionSeries.length > 0 && (
                <div style={{ background: CARD, borderColor: BORDER }} className="rounded-2xl border p-4">
                  <h2 style={{ fontFamily: FONT_DISPLAY }} className="text-sm font-semibold mb-3">Consistency</h2>
                  <div style={{ width: "100%", height: 140 }}>
                    <ResponsiveContainer>
                      <LineChart data={completionSeries} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid stroke={BORDER} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: TEXT_MUTED, fontSize: 10 }} axisLine={{ stroke: BORDER }} tickLine={false} interval="preserveStartEnd" />
                        <YAxis domain={[0, 100]} tick={{ fill: TEXT_MUTED, fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                        <Tooltip contentStyle={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, fontFamily: FONT_MONO, fontSize: 11 }}
                                 formatter={(v) => [`${v}%`, "Complete"]} />
                        <Line type="monotone" dataKey="pct" stroke={ACCENT_2} strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              <div style={{ background: CARD, borderColor: BORDER }} className="rounded-2xl border p-4">
                <h2 style={{ fontFamily: FONT_DISPLAY }} className="text-sm font-semibold mb-3">Last 12 weeks</h2>
                <div className="flex gap-1 overflow-x-auto pb-1">
                  {heatmap.map((week, wi) => (
                    <div key={wi} className="flex flex-col gap-1">
                      {week.map((cell) => (
                        <div key={cell.date} title={`${cell.date}${cell.pct === null ? "" : ` · ${Math.round(cell.pct * 100)}%`}`}
                             style={{ width: 10, height: 10, borderRadius: 2,
                                      background: cell.pct === null ? "transparent" : `rgba(${HEAT_RGB}, ${0.15 + cell.pct * 0.75})`,
                                      border: `1px solid ${cell.pct === null ? BORDER : "transparent"}` }} />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ------------------------------- Program ------------------------------ */}
      {view === "program" && <ProgramView Section={Section} ExerciseList={ExerciseList} theme={activeTheme} />}
    </div>
  );
}

/* ------------------------------ Sub-components ---------------------------- */

function ChartCard({ title, note, data, color, domain, unit, kind, totalWindow, reference, referenceLabel, hideValue }) {
  const { BG, CARD, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, ACCENT, ACCENT_2,
          HEAT_RGB, FONT_DISPLAY, FONT_BODY, FONT_MONO, FONT_IMPORT, CATS, OK_COLOR,
          ON_ACCENT, KNOB, TINT, BADGE } = useTheme();
  const latest = data[data.length - 1];
  const isTotal = kind === "total";
  const lineKey = isTotal ? "total" : "avg";
  const axisDomain = isTotal ? [0, "dataMax + 2"] : domain;
  return (
    <div style={{ background: CARD, borderColor: BORDER }} className="rounded-2xl border p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 style={{ fontFamily: FONT_DISPLAY }} className="text-sm font-semibold">{title}</h2>
        {latest && (
          <span style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }} className="text-xs shrink-0">
            {isTotal
              ? `${latest.total}${unit} · last ${totalWindow} days`
              : hideValue
              ? `${latest.avg}${unit}`
              : `${latest.value}${unit} · ${latest.avg} avg`}
          </span>
        )}
      </div>
      <div style={{ width: "100%", height: 150 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke={BORDER} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: TEXT_MUTED, fontSize: 10 }} axisLine={{ stroke: BORDER }} tickLine={false} interval="preserveStartEnd" />
            <YAxis domain={axisDomain} tick={{ fill: TEXT_MUTED, fontSize: 10 }} axisLine={false} tickLine={false} width={26} />
            <Tooltip contentStyle={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, fontFamily: FONT_MONO, fontSize: 11 }} />
            {reference != null && (
              <ReferenceLine y={reference} stroke={TEXT_MUTED} strokeDasharray="4 3" strokeWidth={1} />
            )}
            {!hideValue && (
              <Line type="monotone" dataKey="value" stroke={TEXT_MUTED} strokeWidth={1.5} dot={{ r: 2, fill: TEXT_MUTED }} />
            )}
            <Line type="monotone" dataKey={lineKey} stroke={color} strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p style={{ color: TEXT_MUTED }} className="text-[11px] mt-2">{note}</p>
      {referenceLabel && (
        <p style={{ color: TEXT_MUTED }} className="text-[11px] mt-1">Dashed line: {referenceLabel}</p>
      )}
    </div>
  );
}

function getMonthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const weeks = [];
  const cursor = new Date(year, month, 1 - offset);
  for (let w = 0; w < Math.ceil((offset + days) / 7); w++) {
    const week = [];
    for (let d = 0; d < 7; d++) { week.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); }
    weeks.push(week);
  }
  return weeks;
}

function CalendarView(p) {
  const { BG, CARD, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, ACCENT, ACCENT_2,
          HEAT_RGB, FONT_DISPLAY, FONT_BODY, FONT_MONO, FONT_IMPORT, CATS, OK_COLOR,
          ON_ACCENT, KNOB, TINT, BADGE } = useTheme();
  const weeks = useMemo(() => getMonthMatrix(p.calYear, p.calMonth), [p.calYear, p.calMonth]);
  const selInfo = useMemo(() => resolveSchedule(p.calSelected, "auto", p.overrides, PROGRAM), [p.calSelected, p.overrides]);
  const block = selInfo.slots.strength ? BLOCKS.strength[selInfo.slots.strength] : null;
  const monthLabel = new Date(p.calYear, p.calMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const go = (delta) => {
    let m = p.calMonth + delta, y = p.calYear;
    if (m < 0) { m = 11; y -= 1; } else if (m > 11) { m = 0; y += 1; }
    p.setCalMonth(m); p.setCalYear(y);
  };

  const pick = (d) => {
    p.setEditingBlock(null);
    p.setActivityDraft("");
    if (p.moveSource) {
      if (dateKey(p.moveSource.date) !== dateKey(d)) p.swapBlock(p.moveSource.date, d, p.moveSource.slot);
      p.setMoveSource(null);
    }
    p.setCalSelected(d);
    p.setCalMonth(d.getMonth());
    p.setCalYear(d.getFullYear());
  };

  return (
    <div className="px-4 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => go(-1)} aria-label="Previous month" style={{ borderColor: BORDER, color: TEXT_SECONDARY, background: CARD }} className="rounded-full border p-2">
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-2">
          <h2 style={{ fontFamily: FONT_DISPLAY }} className="text-base font-semibold">{monthLabel}</h2>
          <button onClick={() => pick(p.today)} style={{ color: ACCENT }} className="text-[11px] font-semibold">Today</button>
        </div>
        <button onClick={() => go(1)} aria-label="Next month" style={{ borderColor: BORDER, color: TEXT_SECONDARY, background: CARD }} className="rounded-full border p-2">
          <ChevronRight size={16} />
        </button>
      </div>

      {p.moveSource && (
        <div style={{ background: TINT.soft, borderColor: ACCENT }} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 mb-3">
          <p className="text-xs">Moving {SLOT_META[p.moveSource.slot].label.toLowerCase()} — tap the day to swap it with.</p>
          <button onClick={() => p.setMoveSource(null)} style={{ color: ACCENT }} className="text-xs font-semibold shrink-0">Cancel</button>
        </div>
      )}

      <div className="grid grid-cols-7 gap-1.5 mb-1">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <div key={d} style={{ color: TEXT_MUTED }} className="text-center text-[10px] font-medium">{d}</div>
        ))}
      </div>

      <div className="space-y-1.5">
        {weeks.map((week, wi) => {
          // The weekly deload toggle. It writes the flag to all 7 days; the
          // 4th-week wave only SUGGESTS one (dashed outline), it never turns
          // one on. Deloading answers how the last three weeks actually felt,
          // which a calendar cannot know.
          const weekMonday = week[0];
          const deloadOn = resolveSchedule(weekMonday, "auto", p.overrides, PROGRAM).deload === true;
          const suggested = suggestDeloadWeek(weekMonday, PROGRAM);
          return (
            <div key={wi} className="flex items-stretch gap-1.5">
              {PROGRAM.showDeloadToggle && (
                <button onClick={() => p.setWeekDeload(weekMonday, !deloadOn)}
                        aria-pressed={deloadOn}
                        aria-label={deloadOn ? "Turn off the gentler week" : "Turn on a gentler week"}
                        title={deloadOn ? "Gentler week on" : suggested ? "Usually your gentler week" : "Gentler week"}
                        style={{
                          background: deloadOn ? ACCENT : "transparent",
                          borderColor: deloadOn ? ACCENT : suggested ? ACCENT + "80" : BORDER,
                          borderStyle: suggested && !deloadOn ? "dashed" : "solid",
                          color: deloadOn ? ON_ACCENT : TEXT_MUTED,
                        }}
                        className="shrink-0 w-7 self-stretch rounded-md border flex items-center justify-center text-[10px] font-bold">
                  D
                </button>
              )}
              <div className="grid grid-cols-7 gap-1.5 flex-1">
                {week.map((d) => {
                  const inMonth = d.getMonth() === p.calMonth;
                  const isToday = dateKey(d) === p.todayKey;
                  const isSel = dateKey(d) === dateKey(p.calSelected);
                  const i = resolveSchedule(d, "auto", p.overrides, PROGRAM);
                  return (
                    <button key={dateKey(d)} onClick={() => pick(d)}
                            style={{ background: isSel ? TINT.selected : i.deload === true ? ACCENT + "14" : CARD,
                                     borderColor: isToday ? ACCENT : BORDER,
                                     borderWidth: isToday ? 2 : 1,
                                     borderStyle: i.anyMoved ? "dashed" : "solid",
                                     opacity: i.skip ? 0.55 : 1 }}
                            className="aspect-square rounded-lg border flex flex-col items-center justify-center gap-0.5">
                      <span style={{ fontFamily: FONT_MONO, color: inMonth ? TEXT_PRIMARY : TEXT_MUTED }} className="text-xs">{d.getDate()}</span>
                      <span className="flex gap-0.5 h-1.5">
                        {i.skip
                          ? <Ban size={9} style={{ color: CATS.check.color }} />
                          : <>
                              {PROGRAM.slots.map((sl) => i.slots[sl] && (
                                <span key={sl} style={{ background: SLOT_META[sl].color }} className="w-1.5 h-1.5 rounded-full" />
                              ))}
                              {i.activities.length > 0 && <span style={{ background: CATS.activity.color }} className="w-1.5 h-1.5 rounded-full" />}
                              {resolveTesting(d, p.overrides, PROGRAM).some((t) => t.due) && (
                                <span style={{ background: (CATS.testing || CATS.check).color }} className="w-1.5 h-1.5 rounded-full" />
                              )}
                            </>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mt-3 flex-wrap">
        {PROGRAM.slots.map((sl) => (
          <span key={sl} className="flex items-center gap-1.5 text-[11px]" style={{ color: TEXT_SECONDARY }}>
            <span style={{ background: SLOT_META[sl].color }} className="w-2 h-2 rounded-full" />{SLOT_META[sl].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px]" style={{ color: TEXT_SECONDARY }}>
          <span style={{ background: CATS.activity.color }} className="w-2 h-2 rounded-full" />Activity
        </span>
        {PROGRAM.testing && (
          <span className="flex items-center gap-1.5 text-[11px]" style={{ color: TEXT_SECONDARY }}>
            <span style={{ background: (CATS.testing || CATS.check).color }} className="w-2 h-2 rounded-full" />Testing due
          </span>
        )}
      </div>

      <div style={{ background: CARD, borderColor: BORDER }} className="rounded-2xl border overflow-hidden mt-4">
        <div className="px-4 py-3">
          <h3 style={{ fontFamily: FONT_DISPLAY }} className="text-sm font-semibold">
            {p.calSelected.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </h3>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span style={{ color: TEXT_MUTED }} className="text-[11px] mr-0.5">Skip day:</span>
            {SKIP_REASONS.map((r) => {
              const on = selInfo.skip === r.value;
              return (
                <button key={r.value} onClick={() => p.setSkip(p.calSelected, on ? null : r.value)}
                        aria-pressed={on}
                        style={{ background: on ? CATS.check.color : "transparent",
                                 color: on ? ON_ACCENT : TEXT_SECONDARY,
                                 borderColor: on ? CATS.check.color : BORDER }}
                        className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border">
                  {r.label}
                </button>
              );
            })}
          </div>
          {selInfo.skip && (
            <p style={{ color: TEXT_MUTED }} className="text-[11px] mt-1.5">
              Training is cleared for this day and your streak pauses rather than breaks. Nothing is deleted —
              tap {selInfo.skipLabel} again and the day comes back exactly as it was.
            </p>
          )}
        </div>

        {PROGRAM.slots.map((slotName) => {
          const meta = SLOT_META[slotName];
          const value = selInfo.slots[slotName];
          const blk = value ? BLOCKS[slotName][value] : null;
          const SlotIcon = (CATS[meta.cat || slotName] && CATS[meta.cat || slotName].Icon) || meta.Icon || Dumbbell;
          const isEditing = p.editingBlock === slotName;
          const isMovingThis = p.moveSource && p.moveSource.slot === slotName;
          return (
            <div key={slotName} style={{ borderColor: BORDER, borderLeftColor: meta.color }}
                 className="border-t border-l-4 px-4 py-3">
              <div className="flex items-center justify-between flex-wrap gap-y-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <SlotIcon size={14} style={{ color: meta.color }} className="shrink-0" />
                  <p style={{ fontFamily: FONT_DISPLAY }} className="text-xs font-semibold truncate">
                    {blk ? blk.label : `No ${meta.label.toLowerCase()}`}
                  </p>
                  {selInfo.moved[slotName] && (
                    <span style={{ background: BADGE.moved.tint, color: BADGE.moved.text, borderColor: BADGE.moved.border }}
                          className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0">Moved</span>
                  )}
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  {value && (
                    <button onClick={() => p.setMoveSource(isMovingThis ? null : { date: p.calSelected, slot: slotName })}
                            style={{ color: meta.color }} className="text-[11px] font-semibold">
                      ⇄ {isMovingThis ? "Cancel" : "Move"}
                    </button>
                  )}
                  <button onClick={() => p.setEditingBlock(isEditing ? null : slotName)}
                          style={{ color: TEXT_SECONDARY }} className="text-[11px] font-semibold">
                    {value ? "Change" : "Add"}
                  </button>
                  {selInfo.moved[slotName] && (
                    <button onClick={() => p.resetBlock(p.calSelected, slotName)} style={{ color: TEXT_MUTED }}
                            className="text-[11px] font-semibold">Reset</button>
                  )}
                </div>
              </div>

              {isEditing && (
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {SLOT_OPTIONS[slotName].map((opt) => (
                    <button key={String(opt.value)}
                            onClick={() => { p.setBlock(p.calSelected, slotName, opt.value); p.setEditingBlock(null); }}
                            style={{ background: value === opt.value ? meta.color : "transparent",
                                     color: value === opt.value ? ON_ACCENT : TEXT_SECONDARY,
                                     borderColor: value === opt.value ? meta.color : BORDER }}
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border">
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              {blk && (
                <div className="space-y-1 mt-2">
                  {blk.exercises.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-2">
                      <span className="text-xs flex-1">{e.name}</span>
                      <span style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }} className="text-[11px] shrink-0">{e.presc}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {PROGRAM.testing && (
          <div style={{ borderColor: BORDER, borderLeftColor: (CATS.testing || CATS.check).color }}
               className="border-t border-l-4 px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <CalendarDays size={14} style={{ color: (CATS.testing || CATS.check).color }} />
              <p style={{ fontFamily: FONT_DISPLAY }} className="text-xs font-semibold">Testing</p>
            </div>
            <div className="space-y-2">
              {resolveTesting(p.calSelected, p.overrides, PROGRAM).map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2">
                  <p style={{ color: t.due ? TEXT_PRIMARY : TEXT_MUTED }} className="text-xs">
                    {t.label}{t.due ? " — due" : ""}
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => p.setBlock(p.calSelected, t.ovKey, !t.due)}
                            style={{ color: (CATS.testing || CATS.check).color }}
                            className="text-[11px] font-semibold">
                      {t.due ? "Not due" : "Mark due"}
                    </button>
                    {t.moved && (
                      <button onClick={() => p.resetBlock(p.calSelected, t.ovKey)}
                              style={{ color: TEXT_MUTED }} className="text-[11px] font-medium">Reset</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p style={{ color: TEXT_MUTED }} className="text-[11px] mt-2">
              Calculated automatically from your baseline date. To move a test, turn it off here and turn it on
              wherever you actually want it. Log the results from Today.
            </p>
          </div>
        )}

        <div style={{ borderColor: BORDER, borderLeftColor: CATS.activity.color }} className="border-t border-l-4 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Flame size={14} style={{ color: CATS.activity.color }} />
            <p style={{ fontFamily: FONT_DISPLAY }} className="text-xs font-semibold">Extra activity</p>
          </div>
          {selInfo.activities.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {selInfo.activities.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2">
                  <span className="text-xs">{a.name}</span>
                  <button onClick={() => p.removeActivity(p.calSelected, a.id)} aria-label={`Remove ${a.name}`} style={{ color: TEXT_MUTED }} className="shrink-0 p-1">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <input type="text" value={p.activityDraft} onChange={(e) => p.setActivityDraft(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") { p.addActivity(p.calSelected, p.activityDraft); p.setActivityDraft(""); } }}
                   placeholder="e.g. Long walk 45 min"
                   style={{ borderColor: BORDER, background: BG }} className="flex-1 min-w-0 text-xs px-2.5 py-1.5 rounded-lg border" />
            <button onClick={() => { p.addActivity(p.calSelected, p.activityDraft); p.setActivityDraft(""); }}
                    style={{ background: CATS.activity.color, color: ON_ACCENT }} className="shrink-0 text-xs font-semibold px-3 rounded-lg">Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, color, defaultOpen, children }) {
  const { BG, CARD, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, ACCENT, ACCENT_2,
          HEAT_RGB, FONT_DISPLAY, FONT_BODY, FONT_MONO, FONT_IMPORT, CATS, OK_COLOR,
          ON_ACCENT, KNOB, TINT, BADGE } = useTheme();
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div style={{ background: CARD, borderColor: BORDER }} className="rounded-2xl border overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} style={{ borderLeftColor: color }}
              className="w-full text-left border-l-4 px-4 py-3 flex items-center justify-between gap-2">
        <div>
          <p style={{ fontFamily: FONT_DISPLAY }} className="text-sm font-semibold">{title}</p>
          {subtitle && <p style={{ color: TEXT_MUTED }} className="text-[11px] mt-0.5">{subtitle}</p>}
        </div>
        <ChevronDown size={16} style={{ color: TEXT_MUTED, transform: open ? "rotate(180deg)" : "none", transition: "transform 200ms", flexShrink: 0 }} />
      </button>
      {open && <div style={{ borderColor: BORDER }} className="border-t px-4 py-3 text-sm space-y-3">{children}</div>}
    </div>
  );
}

function ExerciseList({ exercises, color }) {
  const { BG, CARD, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, ACCENT, ACCENT_2,
          HEAT_RGB, FONT_DISPLAY, FONT_BODY, FONT_MONO, FONT_IMPORT, CATS, OK_COLOR,
          ON_ACCENT, KNOB, TINT, BADGE } = useTheme();
  return (
    <div className="space-y-1.5">
      {exercises.map((e) => (
        <div key={e.id} className="flex items-center justify-between gap-2 text-xs">
          <span className="flex-1">{e.name}</span>
          <span style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }} className="shrink-0">{e.presc}</span>
          {e.video && (
            <a href={e.video} target="_blank" rel="noopener noreferrer" style={{ color }} className="shrink-0 p-2 -m-2" aria-label="Watch demonstration">
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}


/**
 * Supplies the theme to the whole tree.
 *
 * Phase 0 hands over the single theme this client already used, so nothing
 * changes visually. Phase 3 replaces the constant with state plus a stored
 * setting, and the switcher works without touching any call site.
 */
/**
 * The stored theme, read SYNCHRONOUSLY so the very first paint is already in
 * the right theme. Settings load asynchronously; reading them the normal way
 * would paint the default theme first and then jump, on every app open.
 * Same key and format the store uses: STORAGE_PREFIX + "settings", JSON.
 */
function readStoredThemeId() {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + "settings");
    const id = raw ? JSON.parse(raw).theme : null;
    return THEMES[id] ? id : DEFAULT_THEME_ID;
  } catch (e) {
    return DEFAULT_THEME_ID;
  }
}

export default function HennaApp() {
  const [themeId, setThemeId] = useState(readStoredThemeId);
  const theme = useMemo(() => makeTheme(themeId), [themeId]);

  // The installed app's status bar. index.html holds the default theme's value
  // for first paint; this keeps it in step when the theme changes.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme.STATUS_BAR);
  }, [theme]);

  return (
    <ThemeContext.Provider value={theme}>
      <AppInner setThemeId={setThemeId} />
    </ThemeContext.Provider>
  );
}
