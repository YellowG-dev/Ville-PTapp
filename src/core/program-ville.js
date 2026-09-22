/**
 * Ville — program data. Block 1: 28 Sep – 15 Nov 2026.
 *
 * Built from his intake (22 Sep 2026) and John's Block 1 brief:
 *   - goals: leg strength; start fat loss through easy aerobic (PK) volume;
 *     deep (Hindi) squat, ankle mobility, best management of the toe-joint
 *     osteoarthritis. Long-term target: a 100+ km ultra in July 2027.
 *   - week: 3 strength sessions (C can be swapped to legs-only), at least one
 *     ~2 h PK session (preferably a run), at most one VK/tempo session (bike),
 *     PK1 walking as much as fits, at least one yoga. No races.
 *   - mid-October PK/VK block is handled on the go from the Calendar, not
 *     built in here (John, 22 Sep).
 *
 * Constraint: osteoarthritis in a right-foot toe joint. No fast running for
 * long, especially on hard surfaces. Floor split squat is out; the
 * rear-foot-elevated (Bulgarian) split squat is fine. Every lift still has
 * swap options: Ville does the prescribed movement and picks an alternative
 * himself when one is painful (John, 22 Sep). The unilateral-squat list does
 * include the floor split squat — he knows to skip it.
 *
 * Cardio is one slot per sport (run, bike, yoga) — decided 22 Sep. Number
 * IDs are unique per slot (run-*, bike-*) so a run and a ride on the same
 * day never collide. Duration uses unit "h:mm:ss" (Option B+): full
 * keyboard, entry as 1:45:12 or 42:30, stored as minutes.
 *
 * Heart-rate zones are the common Finnish split, as % of max HR (John,
 * 22 Sep: "use standard for now"):  PK1 60–70 · PK2 70–80 · VK 80–90.
 * Running zones use Settings → Max HR = 180, so the app prints bpm.
 * The engine has one max HR, so bike zones are written as fixed bpm from
 * his measured indoor-bike max of 173.
 *
 * Prescriptions carry no RPE on purpose: he knows it but does not use it.
 */

export const PROGRAM_ID = "ville";
export const CLIENT_NAME = "Ville";
export const APP_VERSION = "5.0.0-beta1";

export const SLOTS = ["strength", "run", "bike", "yoga"];

/* ------------------------------- Strength -------------------------------- */

const BSS = {
  id: "bss", pattern: "unilateral-squat",
  name: "Bulgarian split squat",
  presc: "4×6–10/leg",
  sets: 4,
  detail: "Rear foot laces-down on the bench, so the back toes are not bent. Log the weaker leg.",
  video: "https://www.youtube.com/watch?v=hiLF_pF3EJM",
};

const TIB_RAISE = {
  id: "tib-raise",
  name: "Tibialis raise (wall)",
  presc: "2×15–25",
  sets: 2,
  detail: "Back to the wall, heels down, pull the toes up. Feet further from the wall = harder.",
  video: "https://www.youtube.com/watch?v=VzIcGAgBiaM",
};

const SIDE_PLANK = {
  id: "side-plank", pattern: "lateral-core",
  name: "Side plank",
  presc: "3×30–45s/side",
  sets: 3,
  detail: "Log seconds in the reps box.",
  video: "https://www.youtube.com/watch?v=0M-erHBl48U",
};

const DEAD_BUG = {
  id: "dead-bug", pattern: "anti-extension",
  name: "Dead bug",
  presc: "3×8–10/side",
  sets: 3,
  video: "https://www.youtube.com/watch?v=g_BYB0R-4Ws",
};

const GYM_A = {
  label: "Gym A — Legs",
  cat: "strength",
  subtitle: "≈60 min · the priority session · foot-friendly",
  exercises: [
    BSS,
    { id: "rdl-bb", pattern: "hinge", name: "Romanian deadlift", presc: "3×6–10", sets: 3,
      video: "https://www.youtube.com/watch?v=CQp5I9KgdXI" },
    { id: "leg-press", pattern: "squat", name: "Leg press", presc: "3×8–12", sets: 3,
      detail: "Feet a little higher on the platform; push through the whole foot, not the toes.",
      video: "https://www.youtube.com/watch?v=uRFWe2nOUjg" },
    { id: "leg-curl", pattern: "hamstring-curl", name: "Machine leg curl", presc: "3×10–12", sets: 3,
      video: "https://www.youtube.com/watch?v=hqI59xXChFk" },
    { id: "hip-thrust", pattern: "hip-thrust", name: "Barbell hip thrust", presc: "3×8–12", sets: 3,
      video: "https://www.youtube.com/watch?v=S_uZP4UH6J0" },
    { id: "calf-raise", pattern: "calf", name: "Standing calf raise", presc: "3×10–15", sets: 3,
      detail: "Full range, slow down. Drop or swap it on days the toe joint objects.",
      video: "https://www.youtube.com/watch?v=SVtg-1loH4c" },
    TIB_RAISE,
    { id: "pallof", pattern: "anti-rotation", name: "Pallof press", presc: "2×10–12/side", sets: 2,
      video: "https://www.youtube.com/watch?v=LA6Uc5yIV1c" },
  ],
};

const GYM_B = {
  label: "Gym B — Full body",
  cat: "strength",
  subtitle: "≈60 min",
  exercises: [
    { id: "trapbar-dl", pattern: "hinge", name: "Trap bar deadlift", presc: "4×4–6", sets: 4,
      video: "https://www.youtube.com/watch?v=wARl2530PuM" },
    { id: "goblet-squat", pattern: "squat", name: "Goblet squat, full depth", presc: "3×8–10", sets: 3,
      detail: "Deep squat practice under load. A small plate under the heels is fine; reduce it over the block.",
      video: "https://www.youtube.com/watch?v=gm4ln6PO4rc" },
    { id: "db-incline", pattern: "incline-press", name: "Incline dumbbell press", presc: "3×8–12", sets: 3,
      video: "https://www.youtube.com/watch?v=hChjZQhX1Ls" },
    { id: "cs-row", pattern: "horizontal-row", name: "Chest-supported row", presc: "3×8–12", sets: 3,
      video: "https://www.youtube.com/watch?v=vmX58YYK3-8" },
    { id: "sl-rdl", pattern: "single-leg-hinge", name: "Single-leg RDL (dumbbell)", presc: "3×8–10/leg", sets: 3,
      detail: "Log the weaker leg.",
      video: "https://www.youtube.com/watch?v=18CzQrq-Z7I" },
    { id: "calf-seated", pattern: "calf", name: "Seated calf raise", presc: "3×12–20", sets: 3,
      detail: "Drop or swap it on days the toe joint objects.",
      video: "https://www.youtube.com/watch?v=hWO8AbhWEUI" },
    SIDE_PLANK,
    DEAD_BUG,
  ],
};

const GYM_C = {
  label: "Gym C — Upper + core",
  cat: "strength",
  subtitle: "≈50 min · swap to Gym A from the Calendar when legs-only is the better call",
  exercises: [
    { id: "pull-up", pattern: "vertical-pull", name: "Pull-up", presc: "4×5–8", sets: 4,
      detail: "Add reps before adding load.",
      video: "https://www.youtube.com/watch?v=vw5Xmu5CIew" },
    { id: "db-ohp", pattern: "overhead-press", name: "Seated dumbbell overhead press", presc: "3×8–10", sets: 3,
      video: "https://www.youtube.com/watch?v=fuQpuu--bMI" },
    { id: "cable-row", pattern: "horizontal-row", name: "Seated cable row", presc: "3×10–12", sets: 3,
      video: "https://www.youtube.com/watch?v=n4oWW0aedUw" },
    { id: "db-bench", pattern: "horizontal-press", name: "Dumbbell bench press", presc: "3×8–12", sets: 3,
      video: "https://www.youtube.com/watch?v=pKZMNVbfUzQ" },
    { id: "face-pull", pattern: "rear-delt", name: "Face pull", presc: "3×12–15", sets: 3,
      video: "https://www.youtube.com/watch?v=0Po47vvj9g4" },
    { id: "hang-knee", pattern: "trunk-flexion", name: "Hanging knee raise", presc: "3×10–15", sets: 3,
      video: "https://www.youtube.com/watch?v=l7OroezzX9k" },
    { id: "ab-wheel", pattern: "anti-extension", name: "Ab wheel rollout", presc: "3×8–12", sets: 3,
      detail: "From the knees. Only roll as far as the back stays flat.",
      video: "https://www.youtube.com/watch?v=9ZCoAbI7uX0" },
  ],
};

const NO_GYM = {
  noGym: true,
  label: "No-Gym — Bodyweight + Band",
  cat: "strength",
  subtitle: "Travel days — swap any gym session to this from the Calendar",
  exercises: [
    { id: "bw-bss", name: "Bulgarian split squat (bodyweight / backpack)", presc: "3×10–15/leg", sets: 3,
      detail: "Rear foot on a chair or bed, laces-down. A loaded backpack once 15 is easy.",
      video: "https://www.youtube.com/watch?v=hiLF_pF3EJM" },
    { id: "bw-sl-rdl", pattern: "single-leg-hinge", name: "Single-leg RDL (bodyweight)", presc: "3×10–15/leg", sets: 3,
      video: "https://www.youtube.com/watch?v=18CzQrq-Z7I" },
    { id: "bw-sl-thrust", pattern: "hip-thrust", name: "Single-leg hip thrust", presc: "3×12–15/leg", sets: 3,
      video: "https://www.youtube.com/watch?v=qCObDXTe4KY" },
    { id: "bw-pushup", pattern: "bodyweight-press", name: "Push-up", presc: "3×12–20", sets: 3,
      video: "https://www.youtube.com/watch?v=WDIpL0pjun0" },
    { id: "bw-band-row", pattern: "horizontal-row", name: "Band row", presc: "3×12–15", sets: 3,
      video: "https://www.youtube.com/watch?v=ysAjxPSFC7M" },
    { id: "bw-pike", pattern: "bodyweight-press", name: "Pike push-up", presc: "3×8–12", sets: 3,
      video: "https://www.youtube.com/watch?v=XckEEwa1BPI" },
    { id: "bw-pull-apart", pattern: "rear-delt", name: "Band pull-apart", presc: "3×15–20", sets: 3,
      video: "https://www.youtube.com/watch?v=WqdNDTTe-9g" },
    { id: "bw-calf", pattern: "calf", name: "Single-leg calf raise (step)", presc: "3×12–20/leg", sets: 3,
      video: "https://www.youtube.com/watch?v=SVtg-1loH4c" },
    TIB_RAISE,
    SIDE_PLANK,
    DEAD_BUG,
  ],
};

/* ------------------------------- Endurance -------------------------------- */
// Manual entry from Polar until Polar sync exists (Step 7): distance,
// duration, average and max HR per session. Each sport has its own IDs.

const numbersFor = (p) => [
  { id: `${p}-dist`, type: "number", unit: "km", name: "Distance", presc: "From Polar" },
  { id: `${p}-dur`, type: "number", unit: "h:mm:ss", name: "Duration", presc: "From Polar · h:mm:ss or mm:ss" },
  { id: `${p}-hr-avg`, type: "number", unit: "bpm", name: "Average heart rate", presc: "From Polar" },
  { id: `${p}-hr-max`, type: "number", unit: "bpm", name: "Max heart rate", presc: "From Polar" },
];

const RUN_EASY = {
  label: "Run — Easy (PK)",
  cat: "run",
  subtitle: "Soft surface where possible · conversational pace",
  exercises: [
    { id: "run-easy", name: "Easy run", presc: "45–60 min @ PK1–PK2, 60–80% HRmax", pctMin: 60, pctMax: 80, sets: null },
    ...numbersFor("run"),
  ],
};

const RUN_LONG = {
  label: "Run — Long (PK)",
  cat: "run",
  subtitle: "The week's key aerobic session · trail or soft surface",
  exercises: [
    { id: "run-long", name: "Long run", presc: "~2 h @ PK, 60–80% HRmax · walk the steep climbs", pctMin: 60, pctMax: 80, sets: null },
    ...numbersFor("run"),
  ],
};

const BIKE_TEMPO = {
  label: "Bike — Tempo (VK)",
  cat: "bike",
  subtitle: "The week's only VK session · bike zones from max 173",
  exercises: [
    { id: "bike-tempo", name: "Tempo ride",
      presc: "15 min PK1 (104–121 bpm) → 3×10 min VK (138–156 bpm), 3 min easy between → 10 min easy", sets: null },
    ...numbersFor("bike"),
  ],
};

const BIKE_EASY = {
  label: "Bike — Easy (PK)",
  cat: "bike",
  subtitle: "Bike zones from max 173",
  exercises: [
    { id: "bike-easy", name: "Easy ride", presc: "60–90 min @ PK1–PK2 (104–138 bpm)", sets: null },
    ...numbersFor("bike"),
  ],
};

// A guided class he attends, not a list of moves — one tick (John, 22 Sep).
const YOGA = {
  label: "Yoga class",
  cat: "yoga",
  subtitle: "Guided class · usually Tuesday evening",
  exercises: [
    { id: "yoga", name: "Yoga class", presc: "Guided class — tick when done", sets: null },
  ],
};

export const BLOCKS = {
  strength: { a: GYM_A, b: GYM_B, c: GYM_C, nogym: NO_GYM },
  run: { easy: RUN_EASY, long: RUN_LONG },
  bike: { tempo: BIKE_TEMPO, easy: BIKE_EASY },
  yoga: { session: YOGA },
};

export const SLOT_OPTIONS = {
  strength: [
    { value: null, label: "None" },
    { value: "a", label: "A — Legs" },
    { value: "b", label: "B — Full body" },
    { value: "c", label: "C — Upper + core" },
    { value: "nogym", label: "No-Gym" },
  ],
  run: [
    { value: null, label: "None" },
    { value: "easy", label: "Easy (PK)" },
    { value: "long", label: "Long (PK)" },
  ],
  bike: [
    { value: null, label: "None" },
    { value: "tempo", label: "Tempo (VK)" },
    { value: "easy", label: "Easy (PK)" },
  ],
  yoga: [
    { value: null, label: "None" },
    { value: "session", label: "Yoga" },
  ],
};

export const SLOT_META = {
  strength: { label: "Strength", color: "#E3A23C" },
  run: { label: "Run", color: "#4CB6C4" },
  bike: { label: "Bike", color: "#6FCF97" },
  yoga: { label: "Yoga", color: "#A99BC9" },
};

/* ------------------------------- Schedule -------------------------------- */
// Mon gym A (morning) · Tue easy run + yoga (evening) · Wed bike tempo ·
// Thu gym B (morning) · Fri gym C · Sat long run · Sun walk or rest.
// No A/B alternation.

const WEEK = {
  1: { strength: "a", run: null, bike: null, yoga: null },
  2: { strength: null, run: "easy", bike: null, yoga: "session" },
  3: { strength: null, run: null, bike: "tempo", yoga: null },
  4: { strength: "b", run: null, bike: null, yoga: null },
  5: { strength: "c", run: null, bike: null, yoga: null },
  6: { strength: null, run: "long", bike: null, yoga: null },
  0: { strength: null, run: null, bike: null, yoga: null, note: "PK1 walk or Nordic walk — or rest" },
};

export const SCHEDULE = { A: WEEK, B: WEEK };

/* ------------------------------- Mobility -------------------------------- */
// Daily, ~10 min. Ankle dorsiflexion and the deep squat come first, so
// stopping early still covers what matters most this block.

export const MOBILITY = [
  { id: "mob-ankle-rock", name: "Ankle dorsiflexion rock", presc: "10 reps/side · Wall", video: "https://www.youtube.com/watch?v=Y1IZXkdPPdw" },
  { id: "mob-deep-squat", name: "Deep squat hold (Hindi squat)", presc: "3×30–60s · heels on a plate if needed", video: "https://www.youtube.com/watch?v=J18bdWOqNak" },
  { id: "mob-9090", name: "90/90 hip switch", presc: "8/side · Floor", video: "https://www.youtube.com/watch?v=qq_Z7sAmVrA" },
  { id: "mob-hip-flexor", name: "Half-kneeling hip flexor + reach", presc: "30–45s/side · Mat", video: "https://www.youtube.com/watch?v=KyoK4Rf6_bE" },
  { id: "mob-adductor", name: "Adductor rock-back", presc: "8/side · Floor", video: "https://www.youtube.com/watch?v=uZyLZDxcD38" },
  { id: "mob-catcow", name: "Cat–cow → thoracic rotation", presc: "8–10 reps · Bodyweight", video: "https://www.youtube.com/watch?v=YPTKZy_kKt8" },
];

/* -------------------------------- Alcohol -------------------------------- */
// Same selector and tracking as Juha's app (John, 22 Sep). One unit = one
// beer, a 12 cl glass of wine or 4 cl of spirits — the Finnish standard
// portion (12 g alcohol).

export const ALCOHOL_OPTIONS = [
  { value: "none", label: "None", zero: true },
  { value: "wine", label: "Wine" },
  { value: "beer", label: "Beer" },
  { value: "other", label: "Other" },
];

export const ALCOHOL_WEEKLY_REFERENCE = 14;

/* --------------------------- Daily sections ------------------------------ */

export const DAILY = [
  {
    key: "mobility",
    cat: "mobility",
    title: "Daily Mobility — Ankles & Deep Squat",
    subtitle: "~10 min · any time of day",
    tasks: MOBILITY.map((m) => ({ id: m.id, name: m.name, presc: m.presc, video: m.video })),
  },
  {
    key: "check",
    cat: "check",
    title: "Daily Check",
    subtitle: null,
    tasks: [
      { id: "chk-walk-pk1", name: "PK1 walk / Nordic walk", presc: "As much as fits in — any walk counts" },
      {
        id: "chk-alcohol",
        type: "choice",
        name: "Alcohol",
        presc: "1 unit = 1 beer · 12 cl wine · 4 cl spirits",
        options: ALCOHOL_OPTIONS,
        countId: "chk-alc-units",
        countUnit: "units",
        countLabel: "How many?",
        zeroOption: "none",
      },
      { id: "chk-notes", type: "notes", name: "Notes", presc: "Optional — how the day and the foot felt" },
    ],
  },
];

/* -------------------------------- Testing -------------------------------- */
// InBody monthly (annual membership). First scan 29 Sep 2026, then every
// 28 days. Move a scan with "Mark due" / "Not due" in the Calendar.

export const TESTING = {
  key: "testing",
  cat: "testing",
  title: "Testing & Metrics",
  items: [
    {
      id: "inbody",
      label: "InBody scan",
      anchor: "2026-09-29",
      everyDays: 28,
      tasks: [
        { id: "test-weight", type: "number", unit: "kg", name: "Weight", presc: "InBody weight" },
        { id: "test-smm", type: "number", unit: "kg", name: "Skeletal muscle mass", presc: "SMM, kg" },
        { id: "test-pbf", type: "number", unit: "%", name: "Body fat", presc: "Percent body fat · target < 15% by 1 Jan 2027" },
      ],
    },
  ],
};

/* -------------------------------- Program -------------------------------- */

export const PROGRAM = {
  id: PROGRAM_ID,
  clientName: CLIENT_NAME,
  slots: SLOTS,
  blocks: BLOCKS,
  schedule: SCHEDULE,
  daily: DAILY,
  testing: TESTING,
  restLabel: "Rest Day",
  restSubtitle: "No session scheduled — mobility and a PK1 walk still apply",
  gentlerNote: "Easier week — one set fewer per exercise, same weights",
  deloadAnchor: null,
  showDeloadToggle: true,
  usesHeartRate: true,
  tracking: {
    scales: [],
    numbers: [
      { id: "run-dist", label: "Running distance", unit: "km", cat: "run", chart: true, rollingTotal: 7 },
      { id: "run-dur", label: "Running time (minutes)", unit: "min", cat: "run", chart: true, rollingTotal: 7 },
      { id: "bike-dist", label: "Cycling distance", unit: "km", cat: "bike", chart: true, rollingTotal: 7 },
      { id: "run-hr-avg", label: "Run average HR", unit: "bpm", cat: "run", chart: true },
      { id: "test-weight", label: "Weight (InBody)", unit: "kg", chart: true },
      { id: "test-smm", label: "Skeletal muscle mass", unit: "kg", chart: true },
      { id: "test-pbf", label: "Body fat", unit: "%", chart: true },
      {
        id: "chk-alc-units",
        label: "Alcohol",
        unit: "units",
        chart: true,
        rollingTotal: 7,
        reference: ALCOHOL_WEEKLY_REFERENCE,
        referenceLabel: "14 units/wk — THL moderate-risk level for men",
      },
    ],
    rates: [{ id: "chk-walk-pk1", label: "PK1 walk days", rolling: 7 }],
  },
};

export default PROGRAM;
