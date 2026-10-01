/**
 * test-program-view-equivalence.mjs — Step 9 Phase 4.
 *
 * Run:  node test-program-view-equivalence.mjs     (plain node, no browser)
 * Exits 1 on any failure. Byte-identical across the four client repos.
 *
 * Three jobs:
 *
 *  1. EQUIVALENCE. A client's hand-written ProgramView (src/config.jsx) and the
 *     data version (phase4/programview.json, drawn by GeneratedProgramView from
 *     the compiled programme) must show the same Program tab. Compared card by
 *     card: title, subtitle, resolved colour, defaultOpen, the body text in
 *     order (bold and italic kept as markers, text tone kept as a marker), and
 *     each exercise list's ids and colour — under every theme the client has.
 *     The only allowed differences are "The week" rows (the data version is
 *     generated from the schedule, a decision of 1 Oct 2026), nutrition label
 *     case, and markup/styling (including a `lines` part drawing one paragraph
 *     per line where the hand-written tab used one paragraph with <br/>).
 *     Both versions of the week are printed.
 *     A repo with no phase4/programview.json (Ville) skips this job.
 *
 *  2. SCHEMA. The programme with the new programView merged in must validate
 *     with 0 errors and no warning the bare programme does not already have.
 *
 *  3. VILLE REGRESSION. Ville's live programView (phase6/ville-programview.json)
 *     must render byte-identical markup with the renderer as it stood before
 *     Phase 4 (phase4/program-view.before.jsx, a frozen copy) and the renderer
 *     now. Also covers the Phase 4 additions: rich text, list, tone, nutrition
 *     order/labels, and their validator errors.
 *
 * The client's own files are read from this repo, so the test needs no
 * per-client edits and one client's data is never copied into another's repo.
 */
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import * as esbuild from "esbuild";
import { readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { validate } from "./src/core/program-schema.js";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const h = React.createElement;

/* ------------------------------- Load the JSX ------------------------------ */
// Transformed with the esbuild that already builds the bundle; output goes
// inside node_modules so `react` resolves to this repo's copy and nothing is
// left in the working tree.
const OUT_DIR = "node_modules/.tmp-pv-equivalence";
const SCHEMA_ABS = resolve("src/core/program-schema.js");
const aliasSchema = {
  name: "alias-schema",
  setup(b) {
    // The frozen renderer says `./program-schema.js`; it lives outside src/core.
    b.onResolve({ filter: /program-schema\.js$/ }, () => ({ path: SCHEMA_ABS }));
  },
};
async function load(entry, name, extra = {}) {
  await esbuild.build({
    entryPoints: [entry], bundle: true, format: "esm", outfile: `${OUT_DIR}/${name}.mjs`,
    external: ["react", "react-dom", "lucide-react"], loader: { ".jsx": "jsx" }, logLevel: "silent", ...extra,
  });
  return import(pathToFileURL(resolve(`${OUT_DIR}/${name}.mjs`)).href);
}

let config, NewView, OldView;
try {
  mkdirSync(OUT_DIR, { recursive: true });
  config = await load("src/config.jsx", "config");
  ({ GeneratedProgramView: NewView } = await load("src/core/program-view.jsx", "view"));
  ({ GeneratedProgramView: OldView } = await load("phase4/program-view.before.jsx", "before", { plugins: [aliasSchema] }));
} finally {
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
}
const { PROGRAM, makeTheme, ProgramView } = config;
const { THEMES } = await import("./src/core/themes.js");
const THEME_IDS = Object.keys(THEMES);

/* --------------------------------- Stubs ---------------------------------- */
// Section and ExerciseList record what they are given. Section also renders its
// children to a string of its own, so each card's body can be read in isolation.
function makeStubs() {
  const cards = [];
  let current = null;
  function ExerciseList({ exercises, color }) {
    const ids = (exercises || []).map((e) => e && e.id);
    if (current) current.lists.push({ ids, color });
    return h("div", { "data-list": `${ids.join(",")}@${color}` });
  }
  function Section({ title, subtitle, color, defaultOpen, children }) {
    const card = { title, subtitle: subtitle || null, color, defaultOpen: Boolean(defaultOpen), lists: [], html: "" };
    cards.push(card);
    const prev = current;
    current = card;
    card.html = renderToStaticMarkup(h(React.Fragment, null, children));
    current = prev;
    return h("div", { "data-card": String(cards.length) });
  }
  return { cards, Section, ExerciseList };
}

function draw(view, props) {
  const { cards, Section, ExerciseList } = makeStubs();
  const markup = renderToStaticMarkup(h(view, { ...props, Section, ExerciseList }));
  return { cards, markup };
}

/* ---------------------------- Markup -> comparable text -------------------- */

const DAYS = "Mon|Tue|Wed|Thu|Fri|Sat|Sun";
const decode = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/**
 * Reduce a card body to text plus the markers that matter. `theme` supplies the
 * two tone colours so a coloured <p>/<ul>/<ol> can be named rather than compared
 * as a hex. Week rows are pulled out and returned separately.
 */
function reduce(html, theme) {
  const weekRows = [];
  let s = html.replace(
    new RegExp(`<div class="[^"]*">\\s*<span[^>]*class="shrink-0"[^>]*>(${DAYS})</span>\\s*<span class="flex-1">(.*?)</span>\\s*</div>`, "g"),
    (_, day, text) => { weekRows.push([day, decode(text.replace(/<[^>]+>/g, ""))]); return " [weekrow] "; }
  );
  // A `lines` part draws one paragraph per line, inside <div class="space-y-1">
  // (and nothing else uses that exact wrapper). The hand-written tabs put such
  // lines in ONE paragraph separated by <br/>. Same words, same tone; fold the
  // wrapper into a single paragraph so that markup difference does not count.
  s = s.replace(/<div class="space-y-1">((?:<p [^>]*>.*?<\/p>)+)<\/div>/g, (_, ps) => {
    const open = /^<p [^>]*>/.exec(ps)[0];
    const inner = [...ps.matchAll(/<p [^>]*>(.*?)<\/p>/g)].map((m) => m[1]).join("<br/>");
    return `${open}${inner}</p>`;
  });
  const tone = (style) => {
    const m = /color:([^;"]+)/.exec(style || "");
    if (!m) return "";
    if (m[1].trim().toLowerCase() === String(theme.TEXT_MUTED).toLowerCase()) return "{muted}";
    if (m[1].trim().toLowerCase() === String(theme.TEXT_SECONDARY).toLowerCase()) return "{secondary}";
    return "";
  };
  s = s.replace(/<(p|ul|ol)\b([^>]*)>/g, (_, tag, attrs) => {
    const st = /style="([^"]*)"/.exec(attrs);
    const mark = tag === "p" ? "" : tag === "ol" ? "[ol]" : "[ul]";
    return ` ${mark}${tone(st && st[1])} `;
  });
  s = s.replace(/<span[^>]*font-semibold[^>]*>(.*?)<\/span>/g, " **$1** ");
  s = s.replace(/<strong>(.*?)<\/strong>/g, " **$1** ");
  s = s.replace(/<em>(.*?)<\/em>/g, " _$1_ ");
  s = s.replace(/<div data-list="([^"]*)"><\/div>/g, " [list $1] ");
  s = s.replace(/<li>/g, " • ").replace(/<br\s*\/?>/g, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decode(s).replace(/\s+/g, " ").trim();
  // A bold run abuts punctuation in prose ("**more energy**."); spacing around
  // the markers must not decide equality.
  s = s.replace(/\s*\*\*\s*/g, "**").replace(/\s*_([^_]+)_\s*/g, " _$1_ ").replace(/\s+/g, " ").trim();
  return { text: s, weekRows };
}

/* ------------------------------ 1 + 2: equivalence ------------------------- */

const VIEW_FILE = "phase4/programview.json";
const hasData = existsSync(VIEW_FILE);

if (hasData) {
  const programView = JSON.parse(readFileSync(VIEW_FILE, "utf8"));
  const merged = { ...PROGRAM, programView };
  console.log(`\nequivalence — ${PROGRAM.clientName}: ${programView.length} cards, ${THEME_IDS.length} themes`);

  const printed = { done: false };
  for (const id of THEME_IDS) {
    const theme = makeTheme(id);
    let oldR, newR;
    try {
      oldR = draw(ProgramView, { theme });
      newR = draw(NewView, { program: merged, theme });
    } catch (err) {
      ok(`[${id}] both versions render`, false, err.message);
      continue;
    }
    ok(`[${id}] both versions render`, true);
    ok(`[${id}] same number of cards`, oldR.cards.length === newR.cards.length,
      `${oldR.cards.length} old, ${newR.cards.length} new`);

    const n = Math.min(oldR.cards.length, newR.cards.length);
    for (let i = 0; i < n; i++) {
      const o = oldR.cards[i], w = newR.cards[i];
      const tag = `[${id}] card ${i + 1} "${o.title}"`;
      const ro = reduce(o.html, theme), rw = reduce(w.html, theme);
      ok(`${tag}: title`, o.title === w.title, `${JSON.stringify(o.title)} vs ${JSON.stringify(w.title)}`);
      ok(`${tag}: subtitle`, o.subtitle === w.subtitle, `${JSON.stringify(o.subtitle)} vs ${JSON.stringify(w.subtitle)}`);
      ok(`${tag}: colour`, o.color === w.color, `${o.color} vs ${w.color}`);
      ok(`${tag}: defaultOpen`, o.defaultOpen === w.defaultOpen);
      ok(`${tag}: body text`, ro.text === rw.text, `\n         old: ${ro.text}\n         new: ${rw.text}`);
      ok(`${tag}: exercise lists (ids, order, colour)`, JSON.stringify(o.lists) === JSON.stringify(w.lists),
        `${JSON.stringify(o.lists)} vs ${JSON.stringify(w.lists)}`);
      ok(`${tag}: week rows (allowed difference) are 7 each or absent`,
        ro.weekRows.length === rw.weekRows.length && (ro.weekRows.length === 0 || ro.weekRows.length === 7));
      if (!printed.done && ro.weekRows.length) {
        printed.done = true;
        console.log(`\n  "The week" — old (hand-written) vs new (generated from the schedule):`);
        ro.weekRows.forEach(([d, t], k) => console.log(`    ${d}   old: ${t.padEnd(24)} new: ${rw.weekRows[k][1]}`));
        console.log("");
      }
    }
  }

  console.log("\nschema");
  const bare = validate(PROGRAM);
  const withView = validate(merged);
  ok("programme with the new programView: 0 errors", withView.errors.length === 0, withView.errors.join("; "));
  const newWarnings = withView.warnings.filter((w) => !bare.warnings.includes(w));
  ok("no new warnings", newWarnings.length === 0, newWarnings.join("; "));
  ok("programView is plain JSON (survives a round trip unchanged)",
    JSON.stringify(JSON.parse(JSON.stringify(programView))) === JSON.stringify(programView));
} else {
  console.log("\nequivalence — no phase4/programview.json in this repo (no hand-written baseline); regression only");
}

/* ------------------------------ 3: Ville regression ------------------------ */

console.log("\nVille regression — old renderer vs new, byte-identical markup");

const VILLE_VIEW = JSON.parse(readFileSync("phase6/ville-programview.json", "utf8"));
const ex = (id, name) => ({ id, name, presc: "" });

// A Ville-shaped programme, synthesised from the keys his programView names, so
// every exercises part resolves and nothing is copied from another client.
function villeProgram() {
  const blocks = {};
  const note = (g, k, n) => { (blocks[g] = blocks[g] || {})[k] = blocks[g][k] || { label: `${g} ${k}`, subtitle: `${g} ${k} sub`, exercises: [ex(`${g}${k}One`, "One"), ex(`${g}${k}Two`, "Two"), { id: `${g}${k}Note`, type: "note", name: "A note", presc: "" }] }; };
  for (const card of VILLE_VIEW) {
    if (card.titleFrom) note(card.titleFrom.group, card.titleFrom.key);
    for (const part of card.body || []) {
      if (part.type === "exercises") for (const k of part.keys || ["x"]) note(part.group, k);
    }
  }
  return {
    slots: ["strength", "run", "bike", "yoga"],
    slotMeta: { strength: { label: "Strength" }, run: { label: "Run" }, bike: { label: "Bike" }, yoga: { label: "Yoga" } },
    slotOptions: {
      strength: [{ value: "a", label: "A — Legs" }], run: [{ value: "easy", label: "Easy (PK)" }],
      bike: [{ value: "tempo", label: "Tempo (VK)" }], yoga: [{ value: "session", label: "Yoga" }],
    },
    blocks,
    mobility: [ex("mobOne", "Ankle"), ex("mobTwo", "Squat")],
    schedule: { A: {
      1: { strength: "a" }, 2: { run: "easy", yoga: "session" }, 3: { bike: "tempo" },
      4: { strength: "a" }, 5: { strength: "a" }, 6: { run: "easy" }, 0: { note: "PK1 walk — or rest" },
    } },
    nutritionTargets: { rest: { cal: 1, protein: 2, fat: 3, carbs: 4 }, training: { cal: 5, protein: 6, fat: 7, carbs: 8 } },
    programView: VILLE_VIEW,
  };
}
const testThemes = [...THEME_IDS.map((id) => makeTheme(id))];
const programs = [["Ville-shaped programme", villeProgram()], [`${PROGRAM.clientName}'s compiled programme`, { ...PROGRAM, programView: VILLE_VIEW }]];
for (const [label, program] of programs) {
  for (const theme of testThemes) {
    const a = draw(OldView, { program, theme }), b = draw(NewView, { program, theme });
    ok(`${label}, theme ${theme.id || "?"}: markup identical (${a.markup.length} bytes)`, a.markup === b.markup && a.markup.length > 0,
      a.markup === b.markup ? "empty output" : "markup differs");
    ok(`${label}, theme ${theme.id || "?"}: card and list calls identical`,
      JSON.stringify(a.cards) === JSON.stringify(b.cards));
  }
}

/* ---------------------------- Phase 4 additions ---------------------------- */

console.log("\nrenderer additions");
const THEME = makeTheme(THEME_IDS[0]);
const base = { slots: ["strength"], blocks: { strength: { a: { label: "A", exercises: [ex("exA", "A1")] } } }, schedule: { A: {} },
  nutritionTargets: { rest: { cal: 1, protein: 2, fat: 3, carbs: 4 }, training: { cal: 5, protein: 6, fat: 7, carbs: 8 } } };
const one = (body, over = {}) => ({ ...base, ...over, programView: [{ title: "T", body }] });
const html = (program) => draw(NewView, { program, theme: THEME }).cards[0].html;

ok("a plain string paragraph renders as before (no wrapper element added)",
  html(one([{ type: "paragraph", text: "Hello" }])) === '<p class="text-xs">Hello</p>');
{
  const out = html(one([{ type: "paragraph", text: ["a ", { strong: "b" }, " c ", { em: "d" }, "."] }]));
  ok("segments render <strong> and <em>", out === '<p class="text-xs">a <strong>b</strong> c <em>d</em>.</p>', out);
}
{
  const out = html(one([{ type: "paragraph", text: ["<b>x</b>", { strong: "<i>y</i>" }] }]));
  ok("markup in text is escaped, never interpreted", !/<b>|<i>/.test(out) && out.includes("&lt;b&gt;x&lt;/b&gt;"), out);
}
{
  const out = html(one([{ type: "paragraph", strong: [{ em: "Lead" }], text: "rest" }]));
  ok("paragraph.strong takes segments too", out.includes('font-semibold') && out.includes("<em>Lead</em>"), out);
}
{
  const out = html(one([{ type: "lines", items: ["plain", ["x ", { strong: "y" }]] }]));
  ok("lines items take segments", out.includes("<strong>y</strong>") && out.includes(">plain</p>"), out);
}
ok("paragraph.tone secondary / muted colour the text",
  html(one([{ type: "paragraph", text: "s", tone: "secondary" }])).includes(`color:${THEME.TEXT_SECONDARY}`) &&
  html(one([{ type: "paragraph", text: "m", tone: "muted" }])).includes(`color:${THEME.TEXT_MUTED}`));
ok("muted: true still works exactly as before",
  html(one([{ type: "paragraph", text: "m", muted: true }])) === html(one([{ type: "paragraph", text: "m", tone: "muted" }])));
{
  const ul = html(one([{ type: "list", items: ["a", ["b ", { strong: "c" }]] }]));
  const ol = html(one([{ type: "list", ordered: true, tone: "secondary", items: ["a"] }]));
  ok("list renders <ul> with list-disc", /^<ul class="[^"]*list-disc ml-4 space-y-1[^"]*"><li>a<\/li><li>b <strong>c<\/strong><\/li><\/ul>$/.test(ul), ul);
  ok("ordered list renders <ol> with list-decimal and its tone", /^<ol class="[^"]*list-decimal ml-4 space-y-1[^"]*" style="color:/.test(ol) && ol.includes(THEME.TEXT_SECONDARY), ol);
}
{
  const plain = html(one([{ type: "nutrition" }]));
  ok("nutrition without order/labels: raw keys in key order (unchanged)",
    plain.indexOf(">rest<") !== -1 && plain.indexOf(">rest<") < plain.indexOf(">training<"), plain);
  const out = html(one([{ type: "nutrition", order: ["training", "rest"], labels: { training: "Training day", rest: "Rest day" } }]));
  ok("nutrition order + labels", out.indexOf("Training day") !== -1 && out.indexOf("Training day") < out.indexOf("Rest day"), out);
  const part = html(one([{ type: "nutrition", order: ["training"] }]));
  ok("nutrition order names some: the rest follow, nothing hidden", part.indexOf(">training<") < part.indexOf(">rest<"), part);
}
ok("a malformed segment draws nothing and does not throw",
  (() => { try { return !html(one([{ type: "paragraph", text: [{ nope: 1 }, "ok"] }])).includes("undefined"); } catch { return false; } })());

console.log("\nvalidator additions");
const errs = (body, over) => validate({ ...clone(PROGRAM), ...over, programView: [{ title: "T", body }] }).errors;
const warns = (body) => validate({ ...clone(PROGRAM), programView: [{ title: "T", body }] }).warnings;
function clone(v) { return JSON.parse(JSON.stringify(v)); }
const has = (list, re) => list.some((e) => re.test(e));
const nutr = { rest: { cal: 1, protein: 2, fat: 3, carbs: 4 }, training: { cal: 5, protein: 6, fat: 7, carbs: 8 } };

ok("valid segments, list, tone and nutrition order/labels: no errors",
  errs([
    { type: "paragraph", text: ["a", { strong: "b" }, { em: "c" }], tone: "secondary" },
    { type: "paragraph", strong: ["x"], text: "y", muted: true },
    { type: "lines", items: ["a", ["b", { em: "c" }]] },
    { type: "list", items: ["a", ["b"]], ordered: true, tone: "muted" },
    { type: "nutrition", order: ["training", "rest"], labels: { training: "T", rest: "R" } },
  ], { nutritionTargets: nutr }).length === 0, errs([{ type: "list", items: ["a"] }]).join("; "));
ok("a segment that is a number is an error", has(errs([{ type: "paragraph", text: ["a", 3] }]), /text\[1\]/));
ok("a segment with two keys is an error", has(errs([{ type: "paragraph", text: [{ strong: "a", em: "b" }] }]), /text\[0\]/));
ok("a segment with an unknown key is an error", has(errs([{ type: "paragraph", text: [{ bold: "a" }] }]), /text\[0\]/));
ok("a segment with an empty value is an error", has(errs([{ type: "paragraph", text: [{ strong: "" }] }]), /text\[0\]/));
ok("an empty segment array is an error", has(errs([{ type: "paragraph", text: [] }]), /empty array/));
ok("a bad segment inside lines.items is an error", has(errs([{ type: "lines", items: [[{ x: 1 }]] }]), /items\[0\]\[0\]/));
ok("list.items that is not an array is an error", has(errs([{ type: "list", items: "a" }]), /list|items must be an array/) && has(errs([{ type: "list" }]), /items must be an array/));
ok("a bad segment inside list.items is an error", has(errs([{ type: "list", items: [["a", 1]] }]), /items\[0\]\[1\]/));
ok("a bad tone is an error (paragraph and list)",
  has(errs([{ type: "paragraph", text: "a", tone: "loud" }]), /tone/) && has(errs([{ type: "list", items: ["a"], tone: "loud" }]), /tone/));
ok("list.ordered must be a boolean", has(errs([{ type: "list", items: ["a"], ordered: "yes" }]), /ordered/));
ok("nutrition.order naming a day type missing from nutritionTargets is an error",
  has(errs([{ type: "nutrition", order: ["training", "weekend"] }], { nutritionTargets: nutr }), /"weekend"/));
ok("nutrition.order / labels of the wrong shape are errors",
  has(errs([{ type: "nutrition", order: "training" }], { nutritionTargets: nutr }), /order/) &&
  has(errs([{ type: "nutrition", labels: ["a"] }], { nutritionTargets: nutr }), /labels/));
ok("the new keys raise no 'unrecognised key' warning",
  !has(warns([{ type: "list", items: ["a"], ordered: true, tone: "muted" }, { type: "paragraph", text: "a", tone: "muted" }]), /unrecognised/));
{
  const w = warns([{ type: "paragraph", text: "a", muted: true }]);
  ok("a muted paragraph raises no warning (muted is a common part key)", !has(w, /muted/), w.join("; "));
}
ok("a list part with a typo'd key warns, like any other part", has(warns([{ type: "list", items: ["a"], itemz: 1 }]), /itemz/));

console.log(`\ntest-program-view-equivalence: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
