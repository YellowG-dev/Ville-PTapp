/**
 * test-program-view.mjs — render test for src/core/program-view.jsx.
 *
 * Run:  node test-program-view.mjs
 * Exits 1 on any failure, so it can gate a deploy alongside
 * verify-program-delivery.mjs.
 *
 * It renders the real renderer with react-dom/server and stub Section /
 * ExerciseList components, which is what lets a React view be tested under
 * plain node with no browser and no test framework.
 *
 * The point of the test is the failure mode this phase exists to remove: a
 * delivered programme whose blocks have been renamed or removed must degrade,
 * not white-screen. Cases 6 and 8 are that case; the rest prove the eight body
 * part types and the colour tokens render what they should.
 *
 * The fixture is Ville's real programView, read from
 * phase6/ville-programview.json. The programme AROUND it — blocks, slots,
 * slotMeta, slotOptions, schedule, mobility — is built here rather than
 * imported, because this file is byte-identical in all four repos and one
 * client's programme must never be copied into another client's repo.
 */
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import * as esbuild from "esbuild";
import { readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};

/* ------------------------------- Load the JSX ------------------------------ */
// node cannot parse JSX, so the renderer is transformed first with the esbuild
// that already builds the bundle — no new dependency. The output goes inside
// node_modules so that its `import React from "react"` resolves to this repo's
// copy, and so nothing is ever left behind in the working tree.
const OUT_DIR = "node_modules/.tmp-program-view";
const OUT_FILE = `${OUT_DIR}/program-view.mjs`;
let GeneratedProgramView;
try {
  mkdirSync(OUT_DIR, { recursive: true });
  await esbuild.build({
    entryPoints: ["src/core/program-view.jsx"],
    bundle: true,
    format: "esm",
    outfile: OUT_FILE,
    external: ["react"],
    loader: { ".jsx": "jsx" },
    logLevel: "silent",
  });
  ({ GeneratedProgramView } = await import(pathToFileURL(OUT_FILE).href));
} finally {
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
}

if (typeof GeneratedProgramView !== "function") {
  console.error("\nprogram-view.jsx does not export a GeneratedProgramView component");
  process.exit(1);
}

/* --------------------------------- Stubs ---------------------------------- */
// Deliberately minimal: title, subtitle and children, plus the resolved colour
// as TEXT. The colour has to be visible in the output for case 7 — a React
// attribute set to undefined is simply dropped, so an undefined colour would
// otherwise pass unnoticed.
const h = React.createElement;

function Section({ title, subtitle, color, defaultOpen, children }) {
  return h("div", { "data-card": "1" },
    h("h3", null, title),
    subtitle ? h("p", { "data-subtitle": "1" }, subtitle) : null,
    h("span", { "data-color": "1" }, `color=${String(color)}`),
    h("span", { "data-open": "1" }, `open=${String(Boolean(defaultOpen))}`),
    h("div", { "data-body": "1" }, children));
}

function ExerciseList({ exercises, color }) {
  return h("div", { "data-list": "1" },
    h("span", { "data-color": "1" }, `color=${String(color)}`),
    (exercises || []).map((e, i) => h("p", { key: i, "data-ex": "1" }, e && e.name)));
}

const THEME = {
  ACCENT: "#E3A23C",
  ACCENT_2: "#4CB6C4",
  TEXT_MUTED: "#8891A3",
  TEXT_SECONDARY: "#B9C0CC",
  FONT_MONO: "ui-monospace, monospace",
  CATS: {
    strength: { label: "Strength", color: "#E3A23C" },
    run: { label: "Run", color: "#4CB6C4" },
    bike: { label: "Bike", color: "#6FCF97" },
    yoga: { label: "Yoga", color: "#A99BC9" },
    mobility: { label: "Mobility", color: "#7FB88F" },
    check: { label: "Check", color: "#8891A3" },
    activity: { label: "Activity", color: "#9C8CF0" },
  },
};

/* -------------------------------- Fixtures -------------------------------- */

const PROGRAM_VIEW = JSON.parse(readFileSync("phase6/ville-programview.json", "utf8"));

// Fixture ids are hyphen-free on purpose. Tailwind scans this whole repo and
// extracts sub-candidates from hyphenated tokens, so an id shaped like a padding
// utility (a pr or pl prefix, a hyphen, then a number) is compiled into
// styles.css as real CSS, even nested inside a longer id. Keep new fixture ids
// in this camel form and the build output stays clean.
const ex = (id, name, presc) => ({ id, name, presc });

/**
 * Ville-shaped, mirroring the real programme's block keys and labels. The
 * strength labels carry the "Gym " prefix the real ones do, which is why case 3
 * matches on a substring.
 */
const BASE = {
  slots: ["strength", "run", "bike", "yoga"],
  slotMeta: {
    strength: { label: "Strength" },
    run: { label: "Run" },
    bike: { label: "Bike" },
    yoga: { label: "Yoga" },
  },
  slotOptions: {
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
  },
  blocks: {
    strength: {
      a: { label: "Gym A — Legs", subtitle: "Squat pattern first", exercises: [ex("fxSquatA", "Goblet squat", "3×8"), ex("fxSplitSquatA", "Bulgarian split squat", "3×8/side")] },
      b: { label: "Gym B — Full body", subtitle: "Hinge and push", exercises: [ex("fxHingeB", "Trap-bar deadlift", "3×5"), ex("fxPressB", "dumbbell bench press", "3×8")] },
      c: { label: "Gym C — Upper + core", subtitle: "Pull and carry", exercises: [ex("fxRowC", "Chest-supported row", "3×10"), ex("fxCarryC", "Suitcase carry", "3×40 m")] },
      nogym: { label: "No-Gym — Bodyweight + Band", exercises: [ex("fxBandSquat", "Band squat", "3×15"), ex("fxPushUp", "Push-up", "3×12")] },
    },
    run: {
      easy: { label: "Run — Easy (PK)", exercises: [ex("fxRunEasy", "Easy run", "45–60 min · PK2"), { id: "fxRunNote", type: "note", name: "Soft surfaces only", presc: "" }] },
      long: { label: "Run — Long (PK)", exercises: [ex("fxRunLong", "Long run", "~2 h · PK1–PK2")] },
    },
    bike: {
      tempo: { label: "Bike — Tempo (VK)", exercises: [ex("fxBikeTempo", "Indoor bike tempo", "4×8 min · VK"), { id: "fxBikeNote", type: "note", name: "Max HR 173 indoors", presc: "" }] },
      easy: { label: "Bike — Easy (PK)", exercises: [ex("fxBikeEasy", "Indoor bike easy", "60 min · PK1")] },
    },
    yoga: {
      session: { label: "Yoga class", exercises: [ex("fxYoga", "Yoga class", "60–75 min")] },
    },
    // Case 5's fixture: one real movement and one prose note in the same block.
    typed: {
      one: { label: "Typed block", exercises: [ex("fxTypedReal", "Real movement", "3×10"), { id: "fxTypedNote", type: "note", name: "Prose note inside a block", presc: "" }] },
    },
  },
  mobility: [ex("fxMobAnkle", "Ankle dorsiflexion", "30–45s/side"), ex("fxMobSquat", "Deep squat hold", "60s")],
  schedule: {
    A: {
      1: { strength: "a", run: null, bike: null, yoga: null },
      2: { strength: null, run: "easy", bike: null, yoga: "session" },
      3: { strength: null, run: null, bike: "tempo", yoga: null },
      4: { strength: "b", run: null, bike: null, yoga: null },
      5: { strength: "c", run: null, bike: null, yoga: null },
      6: { strength: null, run: "long", bike: null, yoga: null },
      0: { strength: null, run: null, bike: null, yoga: null, note: "PK1 walk or Nordic walk — or rest" },
    },
  },
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const withView = (programView, over = {}) => ({ ...clone(BASE), ...over, programView });

/** Renders, or returns the exception instead of letting it end the run. */
function render(program) {
  try {
    return {
      markup: renderToStaticMarkup(h(GeneratedProgramView, {
        program, Section, ExerciseList, theme: THEME,
      })),
      threw: null,
    };
  } catch (err) {
    return { markup: "", threw: err };
  }
}

const countCards = (markup) => (markup.match(/data-card="1"/g) || []).length;

const unescapeHtml = (s) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
  .replace(/&amp;/g, "&");

/** Every human-readable string in a programView, so none can go missing. */
const PROSE_KEYS = new Set(["title", "subtitle", "text", "strong"]);
function collectProse(node, out = []) {
  if (Array.isArray(node)) { for (const n of node) collectProse(n, out); return out; }
  if (!node || typeof node !== "object") return out;
  for (const [k, v] of Object.entries(node)) {
    if (PROSE_KEYS.has(k) && typeof v === "string") out.push(v);
    else if (k === "items" || k === "columns") {
      if (Array.isArray(v)) for (const s of v) if (typeof s === "string") out.push(s);
    } else if (k === "rows") {
      if (Array.isArray(v)) for (const s of v.flat()) if (typeof s === "string") out.push(s);
    } else if (v && typeof v === "object") collectProse(v, out);
  }
  return out;
}

/* ------------------------------- 1. 12 cards ------------------------------- */
console.log("\n1 — Ville's real programView renders");

const full = render(withView(PROGRAM_VIEW));
ok("renders without throwing", full.threw === null, full.threw && full.threw.message);
ok("renders 12 cards", countCards(full.markup) === 12, `got ${countCards(full.markup)}`);

const text = unescapeHtml(full.markup);

/* --------------------------- 2. no text is lost --------------------------- */
console.log("\n2 — every prose string in the fixture reaches the output");
{
  const strings = collectProse(PROGRAM_VIEW);
  const missing = strings.filter((s) => !text.includes(s));
  ok(`all ${strings.length} prose strings present`, missing.length === 0,
     missing.map((s) => JSON.stringify(s.slice(0, 60))).join(" | "));
}

/* --------------------------- 3. titleFrom resolves ------------------------- */
console.log("\n3 — titleFrom takes the title off the block");
// The real block labels are "Gym A — Legs" and so on; "A — Legs" is the
// slotOptions label. A substring match proves the block label was read.
for (const label of ["A — Legs", "B — Full body", "C — Upper + core"]) {
  ok(`strength card shows ${label}`, text.includes(label));
}
ok("the block's own subtitle comes with it", text.includes("Squat pattern first"));

/* ------------------------------ 4. week table ----------------------------- */
console.log("\n4 — the week table");
for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
  ok(`contains ${day}`, text.includes(`>${day}<`));
}
ok("contains a Strength — line", /Strength — /.test(text));
ok("a slot-less day falls back to its note", text.includes("PK1 walk or Nordic walk"));

/* ----------------------------- 5. excludeTyped ---------------------------- */
console.log("\n5 — excludeTyped drops prose notes, and only those");
{
  const card = (excludeTyped) => [{
    title: "Typed", color: "accent",
    body: [{ type: "exercises", group: "typed", keys: ["one"], excludeTyped }],
  }];
  const on = render(withView(card(true)));
  const off = render(withView(card(false)));
  ok("excludeTyped: true keeps the real movement", on.markup.includes("Real movement"));
  ok("excludeTyped: true drops the typed entry", !on.markup.includes("Prose note inside a block"));
  ok("without it, both render", off.markup.includes("Real movement") && off.markup.includes("Prose note inside a block"));
}

/* -------------------------- 6. a renamed block ---------------------------- */
console.log("\n6 — a renamed or removed block does not throw");
{
  const renamed = withView(PROGRAM_VIEW);
  delete renamed.blocks.strength.a;
  const r = render(renamed);
  ok("renders without throwing", r.threw === null, r.threw && r.threw.message);
  const t = unescapeHtml(r.markup);
  ok("the card whose block is gone is skipped", countCards(r.markup) === 11, `got ${countCards(r.markup)}`);
  ok("the remaining strength cards still render",
     t.includes("B — Full body") && t.includes("C — Upper + core"));
  ok("unrelated cards still render", t.includes("Heart-rate zones") && t.includes("What gets tracked"));
  ok("the week line falls back to the raw value", t.includes("Strength — A — Legs"));
}

/* --------------------------- 7. an unknown cat: --------------------------- */
console.log("\n7 — an unknown cat: token falls back to the accent");
{
  const r = render(withView([{
    title: "Unknown category", color: "cat:doesnotexist",
    body: [
      { type: "paragraph", text: "Still rendered." },
      { type: "exercises", group: "strength", keys: ["a"], color: "cat:alsomissing" },
    ],
  }]));
  ok("renders without throwing", r.threw === null, r.threw && r.threw.message);
  ok("no undefined colour is emitted", !r.markup.includes("color=undefined"),
     (r.markup.match(/color=[^<]*/g) || []).join(" | "));
  ok("falls back to ACCENT", r.markup.includes(`color=${THEME.ACCENT}`));
  ok("the card still renders its body", r.markup.includes("Still rendered."));
}

/* -------------------- 8. a title-less card is skipped --------------------- */
console.log("\n8 — a card with no resolvable title is skipped, not drawn empty");
{
  const r = render(withView([
    { titleFrom: { group: "strength", key: "gone" }, color: "accent",
      body: [{ type: "paragraph", text: "Should not appear." }] },
    { title: "Survivor", color: "accent", body: [{ type: "paragraph", text: "Does appear." }] },
  ]));
  ok("renders without throwing", r.threw === null, r.threw && r.threw.message);
  ok("only the titled card renders", countCards(r.markup) === 1, `got ${countCards(r.markup)}`);
  ok("the skipped card's body is not drawn", !r.markup.includes("Should not appear."));
  ok("the surviving card is intact", r.markup.includes("Survivor") && r.markup.includes("Does appear."));

  // The other half of the same rule: a missing block with a title falls back.
  const withFallback = render(withView([
    { titleFrom: { group: "strength", key: "gone" }, title: "Fallback title", color: "accent",
      body: [{ type: "paragraph", text: "Kept." }] },
  ]));
  ok("a missing block falls back to the card's own title",
     countCards(withFallback.markup) === 1 && withFallback.markup.includes("Fallback title"));
}

/* -------------------------- the remaining part types ---------------------- */
console.log("\nthe part types not covered above");
{
  ok("mobility renders the programme's list",
     text.includes("Ankle dorsiflexion") && text.includes("Deep squat hold"));
  ok("table renders its header row", text.includes("Zone") && text.includes("% of max"));
  ok("table renders its rows", text.includes("PK1") && text.includes("108–126"));
  ok("groupByBlock labels each block", (() => {
    const r = render(withView([{
      title: "Grouped", color: "accent",
      body: [{ type: "exercises", group: "strength", keys: ["a", "b"], groupByBlock: true }],
    }]));
    const t = unescapeHtml(r.markup);
    return r.threw === null && t.includes("Gym A — Legs") && t.includes("Gym B — Full body")
      && t.includes("Goblet squat") && t.includes("Trap-bar deadlift");
  })());
  ok("exercises with no keys takes the whole group", (() => {
    const r = render(withView([{
      title: "All of it", color: "accent",
      body: [{ type: "exercises", group: "bike", excludeTyped: true }],
    }]));
    return r.threw === null && r.markup.includes("Indoor bike tempo")
      && r.markup.includes("Indoor bike easy") && !r.markup.includes("Max HR 173 indoors");
  })());
  ok("nutrition renders nutritionTargets when present", (() => {
    const r = render(withView([{ title: "Nutrition", color: "accent", body: [{ type: "nutrition" }] }], {
      nutritionTargets: { training: { cal: 2700, protein: 190, fat: 90, carbs: 283 } },
    }));
    const t = unescapeHtml(r.markup);
    return r.threw === null && t.includes("training") && t.includes("< 2700 kcal")
      && t.includes("P >190g") && t.includes("F <90g") && t.includes("C <283g");
  })());
  ok("nutrition renders nothing when the programme has none", (() => {
    const r = render(withView([{ title: "Nutrition", color: "accent", body: [{ type: "nutrition" }] }]));
    return r.threw === null && countCards(r.markup) === 1 && !r.markup.includes("kcal");
  })());
  ok("accent2 resolves to ACCENT_2", text.includes(`color=${THEME.ACCENT_2}`));
  ok("a cat: token that exists resolves to its colour",
     text.includes(`color=${THEME.CATS.run.color}`) && text.includes(`color=${THEME.CATS.yoga.color}`));
  ok("defaultOpen is passed through", text.includes("open=true") && text.includes("open=false"));
}

/* ------------------------------- no programView --------------------------- */
console.log("\nno programView at all");
for (const [name, pv] of [["absent", undefined], ["empty", []], ["not an array", {}]]) {
  const r = render(withView(pv));
  ok(`${name} renders nothing`, r.threw === null && r.markup === "",
     r.threw ? r.threw.message : JSON.stringify(r.markup.slice(0, 60)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
