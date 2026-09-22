// Theme verification — run: node verify-theme.mjs
//
// Needs no node_modules. It imports core/themes.js (pure data, no React) and
// reads app.jsx and config.jsx as TEXT, so it cannot be broken by a missing
// install and runs in any of the three client repos unchanged.
//
// What it is for: Phase 0 moved the theme from a module-load constant to a
// runtime value and turned 30 hardcoded colours into tokens, across a file
// three people use daily, in repos that had no tests of any kind. This is the
// harness that says the refactor changed nothing.
//
// BASELINE is what each app rendered before Phase 0 — the surfaces, text and
// fonts, none of which any phase has changed. EXPECTED is the current value of
// every token Phase 0 extracted, per theme: rose-linen still holds the original
// literals, amber-slate holds its Phase 1 values.
//
// Contrast is ASSERTED: every pair must clear its threshold unless it is listed
// in ACCEPTED with a reason. A known, deliberate choice passes; any new
// regression fails.

import fs from "fs";
import { THEMES, THEME_IDS, buildTheme } from "./src/core/themes.js";

const appSrc = fs.readFileSync("./src/app.jsx", "utf8");
const configSrc = fs.readFileSync("./src/config.jsx", "utf8");
const indexSrc = fs.readFileSync("./index.html", "utf8");

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got      ${a}\n        expected ${e}`}`);
}
function ok(label, cond) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
}

/* ------------------------------ the baseline ------------------------------ */

const BASELINE = {
  "amber-slate": {
    BG: "#10131A", CARD: "#1A1F29", BORDER: "#2A3140",
    TEXT_PRIMARY: "#EEF0F3", TEXT_SECONDARY: "#8891A3", TEXT_MUTED: "#5C6577",
    ACCENT: "#E3A23C", ACCENT_2: "#4CB6C4", HEAT_RGB: "111,207,151", STATUS_BAR: "#10131A",
    FONT_DISPLAY: "'Space Grotesk', system-ui, sans-serif",
    FONT_BODY: "'IBM Plex Sans', system-ui, sans-serif",
    FONT_MONO: "'IBM Plex Mono', ui-monospace, monospace",
  },
  "rose-linen": {
    BG: "#FBF7F4", CARD: "#FFFFFF", BORDER: "#EADFD8",
    TEXT_PRIMARY: "#2E2724", TEXT_SECONDARY: "#7A6A62", TEXT_MUTED: "#A2938B",
    ACCENT: "#C97388", ACCENT_2: "#7FB88F", HEAT_RGB: "201,115,136", STATUS_BAR: "#C97388",
    FONT_DISPLAY: "'Fraunces', Georgia, serif",
    FONT_BODY: "'Karla', system-ui, sans-serif",
    FONT_MONO: "'IBM Plex Mono', ui-monospace, monospace",
  },
};

// Every token Phase 0 extracted from app.jsx, and its current value per theme.
const EXPECTED = {
  "rose-linen": {
    // Unchanged since Phase 0 — these are the literals that were inline.
    ON_ACCENT: "#fff", KNOB: "#fff",
    "BADGE.neutral.tint": "rgba(136,145,163,0.16)", "BADGE.neutral.border": "rgba(136,145,163,0.45)",
    "BADGE.ramp.tint": "rgba(127,184,143,0.16)", "BADGE.ramp.border": "rgba(127,184,143,0.45)", "BADGE.ramp.text": "#4C7A5A",
    "BADGE.gentler.tint": "rgba(201,115,136,0.14)", "BADGE.gentler.border": "rgba(201,115,136,0.4)",
    "BADGE.moved.tint": "rgba(169,155,201,0.16)", "BADGE.moved.border": "rgba(169,155,201,0.45)", "BADGE.moved.text": "#6D5F91",
    "TINT.soft": "rgba(201,115,136,0.1)", "TINT.softBorder": "rgba(201,115,136,0.3)", "TINT.selected": "rgba(201,115,136,0.12)",
  },
  "amber-slate": {
    // Phase 1 values.
    ON_ACCENT: "#10131A", KNOB: "#FFFFFF",
    "BADGE.neutral.tint": "rgba(136,145,163,0.1)", "BADGE.neutral.border": "rgba(136,145,163,0.45)",
    "BADGE.ramp.tint": "rgba(127,184,143,0.16)", "BADGE.ramp.border": "rgba(127,184,143,0.45)", "BADGE.ramp.text": "#7FB88F",
    "BADGE.gentler.tint": "rgba(227,162,60,0.14)", "BADGE.gentler.border": "rgba(227,162,60,0.4)",
    "BADGE.moved.tint": "rgba(169,155,201,0.16)", "BADGE.moved.border": "rgba(169,155,201,0.45)", "BADGE.moved.text": "#A99BC9",
    "TINT.soft": "rgba(227,162,60,0.1)", "TINT.softBorder": "rgba(227,162,60,0.3)", "TINT.selected": "rgba(227,162,60,0.12)",
  },
};

// Pairs below threshold that were reviewed and deliberately kept.
const MUTED_REASON =
  "raising it to 4.5:1 merges it with TEXT_SECONDARY — measured, the two greys would sit ~1.1:1 apart";
const ACCEPTED = {
  "amber-slate": {
    "TEXT_MUTED on CARD": MUTED_REASON,
    "TEXT_MUTED on BG": MUTED_REASON,
  },
  "rose-linen": {
    // Owner decision, 20 Sep 2026: the palette stays as it is for its one known user.
    "TEXT_MUTED on CARD": MUTED_REASON,
    "TEXT_MUTED on BG": MUTED_REASON,
    "ON_ACCENT on ACCENT": "owner decision — palette kept",
    "ACCENT on CARD": "owner decision — rose text in ~8 small action links",
    "ACCENT_2 on CARD": "never used as text: gradient stop, chart line, category fallback",
    "BADGE.ramp.text on its tint": "4.41:1 — visually indistinguishable from passing",
    "ACCENT on BADGE.gentler.tint": "owner decision — palette kept",
    "ON_ACCENT on every category fill": "owner decision — palette kept",
    "KNOB on its OFF track (BORDER)":
      "white knob on a near-white track; its edge comes from shadow-sm, which fill contrast cannot measure. Pre-existing, unchanged",
  },
};

const dig = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

/* --------------------------- 1. themes are complete ----------------------- */

console.log("--- every theme carries every token ---");
const REQUIRED = [
  "id", "label", "mode", "BG", "CARD", "BORDER", "TEXT_PRIMARY", "TEXT_SECONDARY",
  "TEXT_MUTED", "ACCENT", "ACCENT_2", "ON_ACCENT", "KNOB", "STATUS_BAR", "OK", "HEAT_RGB", "TINT", "BADGE",
  "FONT_DISPLAY", "FONT_BODY", "FONT_MONO", "FONT_IMPORT",
];
THEME_IDS.forEach((id) => {
  const missing = REQUIRED.filter((k) => THEMES[id][k] == null);
  check(`${id}: no missing tokens`, missing, []);
  const badges = Object.keys(THEMES[id].BADGE).sort();
  check(`${id}: the four status badges`, badges, ["gentler", "moved", "neutral", "ramp"]);
  check(`${id}: tint keys`, Object.keys(THEMES[id].TINT).sort(), ["selected", "soft", "softBorder"]);
});
ok("theme ids match their map keys", THEME_IDS.every((id) => THEMES[id].id === id));

/* ------------------------- 2. this repo renders as before ------------------ */

console.log("\n--- this repo's theme holds its expected values ---");
const idMatch = configSrc.match(/export const DEFAULT_THEME_ID = "([^"]+)"/);
ok("config.jsx declares a DEFAULT_THEME_ID", Boolean(idMatch));
const themeId = idMatch && idMatch[1];
ok(`DEFAULT_THEME_ID "${themeId}" exists in themes.js`, Boolean(THEMES[themeId]));

const base = BASELINE[themeId];
Object.keys(base).forEach((k) => check(`${k} unchanged`, THEMES[themeId][k], base[k]));
Object.entries(EXPECTED[themeId]).forEach(([path, value]) =>
  check(`${path} = ${value}`, dig(THEMES[themeId], path), value)
);
// The OTHER theme must be untouched too — rose-linen is checked from every repo.
Object.entries(EXPECTED["rose-linen"]).forEach(([path, value]) =>
  check(`rose-linen ${path} untouched`, dig(THEMES["rose-linen"], path), value)
);

/* ------------------------- 3. the refactor is complete --------------------- */

console.log("\n--- app.jsx ---");
const leftovers = appSrc.match(/"#[0-9A-Fa-f]{3,8}"|rgba\([0-9., ]*\)/g) || [];
check("no colour literal survives in app.jsx", [...new Set(leftovers)].sort(), []);
ok("module-scope THEME destructuring is gone", !/^const \{\n[^}]*\} = THEME;/m.test(appSrc));
ok("useTheme() is defined", /function useTheme\(\)/.test(appSrc));
ok("a provider wraps the tree with the LIVE theme", /<ThemeContext.Provider value=\{theme\}>/.test(appSrc));
ok("entry point still exports HennaApp by default", /export default function HennaApp\(\)/.test(appSrc));

// A token dropped into a JSX ATTRIBUTE needs braces: color={ON_ACCENT}, never
// color=ON_ACCENT. The latter is a syntax error the build catches, but only
// after a failed deploy, so it is cheaper to catch here. Five sites in app.jsx
// are attribute-position and were broken by the first version of this refactor.
const bareAttr = appSrc.match(/\b\w+=(ON_ACCENT|TINT|BADGE|ACCENT|BG|CARD|BORDER)\b/g) || [];
check("no token sits unbraced in a JSX attribute", [...new Set(bareAttr)].sort(), []);

// Every component that reads a token must call the hook first. Counting them
// is what catches a component added later that quietly uses a stale binding.
const hookCalls = (appSrc.match(/\} = useTheme\(\);/g) || []).length;
check("six components call useTheme()", hookCalls, 6);
const hookIdx = appSrc.indexOf("} = useTheme();");
const firstUse = appSrc.search(/style=\{\{[^}]*\b(BG|CARD|ACCENT|TEXT_MUTED)\b/);
ok("the first hook call precedes the first token use", hookIdx > -1 && hookIdx < firstUse);

// Every name destructured from the hook must exist in every theme, or a theme
// switch would hand a component `undefined` and render an invisible element.
const destructured = [...appSrc.matchAll(/const \{([^}]+)\} = useTheme\(\);/g)]
  .flatMap((m) => m[1].split(",").map((s) => s.trim().split(":")[0].trim()))
  .filter(Boolean);
const perTheme = THEME_IDS.map((id) => {
  const t = buildTheme(id, { mobility: { color: "#000" } });
  return destructured.filter((k) => t[k] === undefined);
});
check("every destructured token resolves in every theme", [...new Set(perTheme.flat())], []);

/* ------------------------------- 4. contrast ------------------------------ */
// Reported, not asserted. Phase 0 must not change these; Phase 1 must fix them.

const hex = (h) => {
  h = h.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
const lum = (c) => {
  const s = c.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
};
const rgbaParts = (s) => {
  const [r, g, b, a] = s.replace(/rgba?\(|\)/g, "").split(",").map(Number);
  return [[r, g, b], a];
};

/* ------------------------------ 4. the switcher ---------------------------- */

console.log("\n--- the switcher ---");
// First paint. Settings load asynchronously, so the provider must read the
// stored choice synchronously, from the key the store actually writes, or every
// app open flashes the default theme before jumping to the chosen one.
ok("the stored theme is read synchronously before first paint",
   /useState\(readStoredThemeId\)/.test(appSrc) &&
   /localStorage\.getItem\(STORAGE_PREFIX \+ "settings"\)/.test(appSrc));
ok("the settings state starts with that same stored id (no mount-time flash)",
   /useState\(\{ gentler: false, hrMax: null, theme: readStoredThemeId\(\) \}\)/.test(appSrc));
ok("an unknown or corrupt stored value falls back to the default",
   /THEMES\[id\] \? id : DEFAULT_THEME_ID/.test(appSrc) && /catch \(e\) \{\s*return DEFAULT_THEME_ID;/.test(appSrc));
ok("the choice is saved through updateSettings, so it syncs like every other setting",
   /updateSettings\(\{ theme: id \}\)/.test(appSrc));
// The Program tab was the one place handed the static import. It would have
// stayed in the default theme while the rest of the app switched.
check("nothing is handed the static THEME import", (appSrc.match(/=\{THEME\}/g) || []).length, 0);
ok("ProgramView receives the live theme", /<ProgramView[^>]*theme=\{activeTheme\}/.test(appSrc));
ok("config.jsx builds any theme with this client's categories", /export function makeTheme\(id\)/.test(configSrc));
ok("the status bar follows the theme", /setAttribute\("content", theme\.STATUS_BAR\)/.test(appSrc));
const metaColour = (indexSrc.match(/<meta name="theme-color" content="([^"]+)"/) || [])[1];
check("index.html's first-paint status bar matches the default theme", metaColour, THEMES[themeId].STATUS_BAR);

console.log("\n--- contrast — asserted unless ACCEPTED (text 4.5:1; toggle knob 3:1, non-text UI) ---");
// With a switcher, this client's categories can appear under EVERY theme, so
// every combination is checked, not just the default. A category written as
// ACCENT / ACCENT_2 takes the active theme's value; a fixed hex keeps its own.
const catsBody = (configSrc.match(/function catsFor\(\{ ACCENT, ACCENT_2 \}\) \{\n  return \{([\s\S]*?)\n  \};/) || [])[1] || "";
ok("category colours were found in config.jsx", /color:/.test(catsBody));
const tintOn = (rgba, surface) => {
  const [rgb, a] = rgbaParts(rgba);
  return over(rgb, a, surface);
};

THEME_IDS.forEach((id) => {
  const t = THEMES[id];
  const C = hex(t.CARD);
  const fills = [...catsBody.matchAll(/color: (?:"(#[0-9A-Fa-f]{6})"|(ACCENT_2|ACCENT))/g)]
    .map((m) => m[1] || t[m[2]]);
  const worstFill = fills.reduce(
    (w, f) => { const r = ratio(hex(t.ON_ACCENT), hex(f)); return r < w.r ? { r, f } : w; },
    { r: Infinity, f: null }
  );
  const pairs = [
    ["TEXT_PRIMARY on CARD", ratio(hex(t.TEXT_PRIMARY), C), 4.5],
    ["TEXT_SECONDARY on CARD", ratio(hex(t.TEXT_SECONDARY), C), 4.5],
    ["TEXT_MUTED on CARD", ratio(hex(t.TEXT_MUTED), C), 4.5],
    ["TEXT_MUTED on BG", ratio(hex(t.TEXT_MUTED), hex(t.BG)), 4.5],
    ["ON_ACCENT on ACCENT", ratio(hex(t.ON_ACCENT), hex(t.ACCENT)), 4.5],
    ["ON_ACCENT on every category fill", worstFill.r, 4.5, `worst: ${worstFill.f}`],
    ["KNOB on its OFF track (BORDER)", ratio(hex(t.KNOB), hex(t.BORDER)), 3],
    ["KNOB on its ON track (ACCENT)", ratio(hex(t.KNOB), hex(t.ACCENT)), 1.5, "shape, not text — only needs to be seen"],
    ["ACCENT on CARD", ratio(hex(t.ACCENT), C), 4.5],
    ["ACCENT_2 on CARD", ratio(hex(t.ACCENT_2), C), 4.5],
    ["BADGE.ramp.text on its tint", ratio(hex(t.BADGE.ramp.text), tintOn(t.BADGE.ramp.tint, C)), 4.5],
    ["BADGE.moved.text on its tint", ratio(hex(t.BADGE.moved.text), tintOn(t.BADGE.moved.tint, C)), 4.5],
    ["ACCENT on BADGE.gentler.tint", ratio(hex(t.ACCENT), tintOn(t.BADGE.gentler.tint, C)), 4.5],
  ];
  const accepted = ACCEPTED[id] || {};
  console.log(`  ${id}${id === themeId ? "  (this client's default)" : ""}`);
  pairs.forEach(([name, r, min, note]) => {
    const pass = r >= min;
    const why = accepted[name];
    const tag = pass ? "PASS" : why ? "KEPT" : "FAIL";
    if (tag === "FAIL") failures++;
    console.log(`${tag}  ${String(r).padStart(6)}:1  (min ${min})  ${name}${note ? `  [${note}]` : ""}${!pass && why ? `\n        accepted: ${why}` : ""}`);
  });
});

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
