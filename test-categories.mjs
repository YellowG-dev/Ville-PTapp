/**
 * test-categories.mjs — Step 9 Phase 6: standard categories.
 *
 * Run:  node test-categories.mjs      (plain node, no browser)
 *
 * Proves the rule John set: no existing category colour or icon changes for
 * Ville. BASELINE below is the category list as it stood on main before
 * Phase 6 (config.jsx catsFor); a colour written as ACCENT / ACCENT_2 follows the
 * active theme, a hex is fixed. Every baseline entry must come out of the current
 * config.jsx with the same label, colour and icon, under every theme. The
 * categories Phase 6 adds must exist for every standard slot.
 *
 * Per-client on purpose: each repo holds only its own baseline.
 */
import * as esbuild from "esbuild";
import * as lucide from "lucide-react";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { THEMES } from "./src/core/themes.js";
import { STANDARD_SLOTS } from "./src/core/program-schema.js";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};

const BASELINE = {
  "strength": {
    "label": "Strength",
    "color": "ACCENT",
    "icon": "Dumbbell"
  },
  "run": {
    "label": "Run",
    "color": "ACCENT_2",
    "icon": "Activity"
  },
  "bike": {
    "label": "Bike",
    "color": "#6FCF97",
    "icon": "Bike"
  },
  "yoga": {
    "label": "Yoga",
    "color": "#A99BC9",
    "icon": "Flower2"
  },
  "mobility": {
    "label": "Mobility",
    "color": "#7FB88F",
    "icon": "Wind"
  },
  "check": {
    "label": "Check",
    "color": "#8891A3",
    "icon": "Scale"
  },
  "rest": {
    "label": "Rest",
    "color": "#8891A3",
    "icon": "Scale"
  },
  "activity": {
    "label": "Activity",
    "color": "#9C8CF0",
    "icon": "Footprints"
  },
  "testing": {
    "label": "Testing",
    "color": "#5B9BD5",
    "icon": "Gauge"
  }
};

const OUT_DIR = "node_modules/.tmp-categories";
let config;
try {
  mkdirSync(OUT_DIR, { recursive: true });
  await esbuild.build({
    entryPoints: ["src/config.jsx"], bundle: true, format: "esm", outfile: `${OUT_DIR}/config.mjs`,
    external: ["react", "react-dom", "lucide-react"], loader: { ".jsx": "jsx" }, logLevel: "silent",
  });
  config = await import(pathToFileURL(resolve(`${OUT_DIR}/config.mjs`)).href);
} finally {
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
}

for (const id of Object.keys(THEMES)) {
  const t = THEMES[id];
  const cats = config.makeTheme(id).CATS;
  console.log(`\n${config.CLIENT_NAME} — theme ${id}`);
  for (const [name, spec] of Object.entries(BASELINE)) {
    const want = spec.color === "ACCENT" ? t.ACCENT : spec.color === "ACCENT_2" ? t.ACCENT_2 : spec.color;
    const got = cats[name];
    ok(`${name}: same label, colour and icon as before`,
      got && got.label === spec.label && got.color === want && got.Icon === lucide[spec.icon],
      got ? `${got.label} ${got.color} vs ${spec.label} ${want}` : "missing");
  }
  for (const s of STANDARD_SLOTS) {
    ok(`standard slot "${s.id}" has a category with an icon`, Boolean(cats[s.id] && cats[s.id].Icon && cats[s.id].color && cats[s.id].label));
  }
  ok("OK_COLOR is unchanged (derived from mobility)", config.makeTheme(id).OK_COLOR === (BASELINE.mobility
    ? (BASELINE.mobility.color === "ACCENT_2" ? t.ACCENT_2 : BASELINE.mobility.color) : t.OK));
}

console.log(`\ntest-categories (${config.CLIENT_NAME}): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
