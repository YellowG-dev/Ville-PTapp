/**
 * Ville — config. Theme, labels, storage, and the Program tab copy.
 * app.jsx is byte-identical across all client apps; everything that differs
 * between clients lives here and in core/program-ville.js.
 */
import { THEMES, buildTheme } from "./core/themes.js";
import React from "react";
import { Dumbbell, Activity, Bike, Flower2, Wind, Scale, Footprints, Gauge } from "lucide-react";
import PROGRAM_DATA, {
  MOBILITY, BLOCKS, SLOT_OPTIONS, SLOT_META, APP_VERSION, SCHEDULE,
} from "./core/program-ville.js";

export { MOBILITY, BLOCKS, SLOT_OPTIONS, SLOT_META, APP_VERSION };

export const PROGRAM = PROGRAM_DATA;
export const CLIENT_LABEL = "Ville · Daily Log";
// Tags rows in the shared backup sheet. Must match the tab name.
export const CLIENT_NAME = "Ville";

// localStorage is scoped per ORIGIN, not per path, so every client app on
// yellowg-dev.github.io shares one bucket. This prefix keeps Ville's data
// apart from the other apps. NEVER change it once he has logged a day.
export const STORAGE_PREFIX = "ptAppVille_";

export const START_DATE = new Date(2026, 8, 28);
export const RAMP_WEEKS = 0; // already training; no easing-in period

export const BACKUP_URL = "";

// Supabase connection. Safe to commit — the publishable key is designed to be
// public and only says "a browser is calling". Row-level security is what
// protects the data. NEVER put the sb_secret_ key here.
export const SUPABASE_URL = "https://qpkdqyazdzhoohowkouy.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_VCvYuYUAC9Dnf3kiLNB93g_tP_5c473";

export const DEFAULT_THEME_ID = "amber-slate";

// Categories are CLIENT data, not theme data. One per sport, because cardio
// is one slot per sport in this app (decided 22 Sep 2026).
function catsFor({ ACCENT, ACCENT_2 }) {
  return {
    strength: { label: "Strength", color: ACCENT, Icon: Dumbbell },
    run: { label: "Run", color: ACCENT_2, Icon: Activity },
    bike: { label: "Bike", color: "#6FCF97", Icon: Bike },
    yoga: { label: "Yoga", color: "#A99BC9", Icon: Flower2 },
    mobility: { label: "Mobility", color: "#7FB88F", Icon: Wind },
    check: { label: "Check", color: "#8891A3", Icon: Scale },
    rest: { label: "Rest", color: "#8891A3", Icon: Scale },
    activity: { label: "Activity", color: "#9C8CF0", Icon: Footprints },
    testing: { label: "Testing", color: "#5B9BD5", Icon: Gauge },
  };
}

/** Everything app.jsx needs for one theme, carrying this client's categories. */
export function makeTheme(id) {
  const known = THEMES[id] ? id : DEFAULT_THEME_ID;
  return buildTheme(known, catsFor(THEMES[known]));
}

export const THEME = makeTheme(DEFAULT_THEME_ID);

/* ------------------------------ Program tab ------------------------------- */
// The week table is GENERATED from SCHEDULE, so it can never disagree with
// the app. Change the schedule in core/program-ville.js, not here.

const DOW = [
  [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"],
];

function labelFor(slot, value) {
  const opt = (SLOT_OPTIONS[slot] || []).find((o) => o.value === value);
  const name = opt ? opt.label : value;
  return `${SLOT_META[slot].label} — ${name}`;
}

function dayLine(day) {
  const parts = [];
  for (const slot of PROGRAM_DATA.slots) {
    if (day && day[slot]) parts.push(labelFor(slot, day[slot]));
  }
  if (!parts.length) return (day && day.note) || "Rest";
  return parts.join(" + ");
}

export function ProgramView({ Section, ExerciseList, theme }) {
  const { ACCENT: A, ACCENT_2: B, TEXT_MUTED, TEXT_SECONDARY, FONT_MONO, CATS } = theme;
  const week = SCHEDULE.A;

  return (
    <div className="px-4 max-w-md mx-auto space-y-3">
      <Section title="Block 1" subtitle="28 Sep – 15 Nov 2026" color={A} defaultOpen>
        <div className="space-y-1 text-xs">
          <p style={{ color: TEXT_SECONDARY }} className="font-semibold">Main goals</p>
          <p style={{ color: TEXT_MUTED }}>
            1. Leg strength.<br />
            2. Start fat loss through easy aerobic (PK) volume.<br />
            3. Deep (Hindi) squat, ankle mobility, and the best possible management of the toe joint.
          </p>
        </div>
        <div className="space-y-1 text-xs">
          <p style={{ color: TEXT_SECONDARY }} className="font-semibold">Every week</p>
          <p style={{ color: TEXT_MUTED }}>
            3 strength sessions (Gym C can switch to legs-only) · at least one ~2 h PK session, preferably a run ·
            at most one VK/tempo session · PK1 walking as much as fits · at least one yoga.
          </p>
        </div>
        <p style={{ color: TEXT_MUTED }} className="text-xs">
          No races this block. The mid-October PK/VK block is set up day by day from the Calendar. Longer term,
          everything here builds the base for a 100+ km ultra in July 2027.
        </p>
      </Section>

      <Section title="The week" subtitle="Default rhythm — everything is movable" color={A} defaultOpen>
        <div className="space-y-1 text-xs">
          {DOW.map(([dow, name]) => (
            <div key={dow} className="flex items-center justify-between gap-2">
              <span style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY, width: 44 }} className="shrink-0">{name}</span>
              <span className="flex-1">{dayLine(week[dow])}</span>
            </div>
          ))}
        </div>
        <p style={{ color: TEXT_MUTED }} className="text-xs">
          Move anything from the Calendar — the app tracks what you actually did. Travelling? Swap a gym session to
          No-Gym, or mark the day Travel.
        </p>
      </Section>

      <Section title="Heart-rate zones" subtitle="% of max HR" color={B}>
        <div className="space-y-1 text-xs" style={{ fontFamily: FONT_MONO }}>
          {[["PK1", "60–70%", "108–126", "104–121"], ["PK2", "70–80%", "126–144", "121–138"], ["VK", "80–90%", "144–162", "138–156"]].map(
            ([z, p, run, bike]) => (
              <div key={z} className="flex items-center justify-between gap-2">
                <span style={{ color: TEXT_SECONDARY, width: 36 }} className="shrink-0">{z}</span>
                <span className="flex-1">{p}</span>
                <span style={{ color: TEXT_MUTED }}>run {run} · bike {bike}</span>
              </div>
            )
          )}
        </div>
        <p style={{ color: TEXT_MUTED }} className="text-xs">
          Running uses max 180 (set Max HR to 180 in Settings and the app shows bpm). Cycling uses the indoor-bike
          max of 173, written into the bike sessions directly.
        </p>
      </Section>

      {["a", "b", "c"].map((k) => (
        <Section key={k} title={BLOCKS.strength[k].label} subtitle={BLOCKS.strength[k].subtitle} color={A}>
          <ExerciseList exercises={BLOCKS.strength[k].exercises} color={A} />
        </Section>
      ))}

      <Section title="Strength rules" color={A}>
        <p className="text-xs">
          <span style={{ color: TEXT_SECONDARY }} className="font-semibold">Effort:</span> finish every set with
          1–3 good reps left. When every set reaches the top of the rep range, add weight and drop back to the bottom.
        </p>
        <p className="text-xs">
          <span style={{ color: TEXT_SECONDARY }} className="font-semibold">The toe joint:</span> no floor split
          squats — the Bulgarian (rear-foot-elevated) version only, rear foot laces-down. Push through the whole foot,
          not the toes. If a movement aggravates the joint, log a swap and note it.
        </p>
        <p className="text-xs">
          <span style={{ color: TEXT_SECONDARY }} className="font-semibold">Single-leg work:</span> log the weaker
          leg and let it set the pace.
        </p>
      </Section>

      <Section title="No-Gym — Bodyweight + Band" subtitle="Swap any gym session to this when travelling" color={CATS.activity.color}>
        <ExerciseList exercises={BLOCKS.strength.nogym.exercises} color={CATS.activity.color} />
        <p style={{ color: TEXT_MUTED }} className="text-xs">
          Climb the rep range first; once every set sits comfortably at the top, add band resistance, a loaded
          backpack, or a slower tempo.
        </p>
      </Section>

      <Section title="Running" subtitle="Volume over speed" color={CATS.run.color}>
        <ExerciseList exercises={[...BLOCKS.run.easy.exercises, ...BLOCKS.run.long.exercises].filter((e) => !e.type)} color={CATS.run.color} />
        <p style={{ color: TEXT_MUTED }} className="text-xs">
          Easy pace and soft surfaces protect the toe joint; speed on hard surfaces is what it tolerates least.
          Log distance, duration, average and max HR from Polar after each session. Duration takes h:mm:ss or mm:ss.
        </p>
      </Section>

      <Section title="Cycling" subtitle="One tempo session a week, at most" color={CATS.bike.color}>
        <ExerciseList exercises={[...BLOCKS.bike.tempo.exercises, ...BLOCKS.bike.easy.exercises].filter((e) => !e.type)} color={CATS.bike.color} />
      </Section>

      <Section title="Yoga and daily mobility" subtitle="Ankles and the deep squat" color={CATS.mobility.color}>
        <ExerciseList exercises={BLOCKS.yoga.session.exercises} color={CATS.yoga.color} />
        <ExerciseList exercises={MOBILITY} color={CATS.mobility.color} />
        <p style={{ color: TEXT_MUTED }} className="text-xs">
          The mobility list is in priority order — stopping early still covers the ankle and the squat.
        </p>
      </Section>

      <Section title="What gets tracked" color={CATS.check.color}>
        <div className="text-xs space-y-2">
          <p><strong>Sessions</strong> — distance, duration and heart rate per run and ride, typed in from Polar for now.</p>
          <p><strong>PK1 walking</strong> — a daily tick until Oura/Polar step data arrives automatically.</p>
          <p><strong>Alcohol</strong> — type and units; the chart shows a running 7-day total against THL's 14 units/week.</p>
          <p><strong>InBody</strong> — every 4 weeks from 29 Sep: weight, muscle mass, body fat.</p>
          <p style={{ color: TEXT_MUTED }}>Sleep and daily activity will come from Oura once the sync is built — nothing to type in.</p>
        </div>
      </Section>
    </div>
  );
}
