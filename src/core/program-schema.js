/**
 * program-schema.js — the contract for a program definition.
 *
 * ONE file, shared by three callers, so all three agree on what "valid" means:
 *   - Coach-PTapp, before it publishes a definition to `programs.definition`
 *   - the client app, after it fetches one and before it trusts it
 *   - verify-program-delivery.mjs, in the build check
 *
 * Why it exists: every check below marks a place where a bad definition either
 * throws in the client or — worse — silently renders the wrong session. The
 * line references are to app.jsx at BA958B052BF700F2 (126,056 bytes).
 */

export const SCHEMA_VERSION = 2;

/* ------------------------------ small helpers ----------------------------- */

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.length > 0;
const isHex = (v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

/** Keys a definition must carry. Missing any of these is a hard failure. */
export const REQUIRED_KEYS = [
  "id", "clientName", "slots", "blocks", "schedule",
  "daily", "tracking", "slotMeta", "slotOptions",
];

/** Keys that may be absent. Listed so an unexpected key can be reported. */
export const OPTIONAL_KEYS = [
  "schemaVersion", "testing", "mobility", "nutritionTargets", "programView",
  "deloadAnchor", "deloadWave", "gentlerNote", "restLabel", "restSubtitle",
  "showDeloadToggle", "usesHeartRate", "startDate",
];

/* -------------------------------- validate -------------------------------- */

/**
 * validate(def) -> { ok, errors, warnings }
 *
 * errors   = the client must NOT run this definition; fall back to compiled.
 * warnings = it will run, but something is probably a mistake worth seeing.
 */
export function validate(def) {
  const errors = [];
  const warnings = [];
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  if (!isObj(def)) return { ok: false, errors: ["definition is not an object"], warnings };

  for (const k of REQUIRED_KEYS) {
    if (def[k] === undefined) E(`missing required key: ${k}`);
  }
  for (const k of Object.keys(def)) {
    if (!REQUIRED_KEYS.includes(k) && !OPTIONAL_KEYS.includes(k)) {
      W(`unrecognised key carried in definition: ${k}`);
    }
  }

  if (def.schemaVersion !== undefined && def.schemaVersion !== SCHEMA_VERSION) {
    W(`schemaVersion is ${def.schemaVersion}, this code expects ${SCHEMA_VERSION}`);
  }

  // --- slots: the array app.jsx iterates at line 2124 to build the day view.
  const slots = def.slots;
  if (!Array.isArray(slots) || slots.length === 0) {
    E("slots must be a non-empty array");
    return { ok: false, errors, warnings };   // nothing below is checkable
  }
  if (!slots.every(isStr)) E("every entry in slots must be a non-empty string");
  if (new Set(slots).size !== slots.length) E("slots contains duplicates");

  // --- slotMeta: app.jsx line 2129 reads meta.cat off this. A slot with no
  //     entry here is the crash the whole contract exists to prevent.
  if (isObj(def.slotMeta)) {
    for (const s of slots) {
      const m = def.slotMeta[s];
      if (!isObj(m)) { E(`slotMeta.${s} is missing — app.jsx would throw on meta.cat`); continue; }
      if (!isStr(m.label)) E(`slotMeta.${s}.label must be a non-empty string`);
      if (!isHex(m.color)) E(`slotMeta.${s}.color must be a #rrggbb hex string (got ${JSON.stringify(m.color)})`);
      for (const k of Object.keys(m)) {
        if (!["label", "color", "cat"].includes(k)) W(`slotMeta.${s} carries unexpected key: ${k}`);
      }
    }
  } else E("slotMeta must be an object");

  // --- blocks: the sessions themselves. app.jsx reads blocks[slot][value].
  if (isObj(def.blocks)) {
    for (const s of slots) {
      if (!isObj(def.blocks[s])) E(`blocks.${s} is missing — no sessions defined for that slot`);
    }
    for (const g of Object.keys(def.blocks)) {
      if (!slots.includes(g)) W(`blocks.${g} has no matching slot, so it is unreachable`);
      for (const [key, blk] of Object.entries(def.blocks[g] || {})) {
        if (!isObj(blk)) { E(`blocks.${g}.${key} is not an object`); continue; }
        if (!isStr(blk.label)) E(`blocks.${g}.${key}.label must be a non-empty string`);
        if (blk.exercises !== undefined) {
          if (!Array.isArray(blk.exercises)) E(`blocks.${g}.${key}.exercises must be an array`);
          else blk.exercises.forEach((ex, i) => {
            if (!isObj(ex)) E(`blocks.${g}.${key}.exercises[${i}] is not an object`);
            else if (!isStr(ex.id)) E(`blocks.${g}.${key}.exercises[${i}] has no id`);
          });
        }
      }
    }
  } else E("blocks must be an object");

  // --- slotOptions: the "Change" buttons at app.jsx line 2166.
  //     An option whose value has no block resolves to an empty session.
  if (isObj(def.slotOptions)) {
    for (const s of slots) {
      const opts = def.slotOptions[s];
      if (!Array.isArray(opts) || opts.length === 0) {
        E(`slotOptions.${s} is missing or empty — the Change picker would throw`);
        continue;
      }
      if (!opts.some((o) => isObj(o) && o.value === null)) {
        W(`slotOptions.${s} has no { value: null } entry, so the slot cannot be cleared`);
      }
      opts.forEach((o, i) => {
        if (!isObj(o)) { E(`slotOptions.${s}[${i}] is not an object`); return; }
        if (!isStr(o.label)) E(`slotOptions.${s}[${i}].label must be a non-empty string`);
        if (o.value === null) return;
        if (!isStr(o.value)) { E(`slotOptions.${s}[${i}].value must be a string or null`); return; }
        if (isObj(def.blocks) && isObj(def.blocks[s]) && def.blocks[s][o.value] === undefined) {
          E(`slotOptions.${s} offers "${o.value}" but blocks.${s}.${o.value} does not exist`);
        }
      });
    }
  } else E("slotOptions must be an object");

  // --- schedule: the default week. A value with no block here is the silent
  //     failure mode — the day renders as rest and nobody sees an error.
  if (isObj(def.schedule)) {
    for (const wk of ["A", "B"]) {
      if (!isObj(def.schedule[wk])) { E(`schedule.${wk} is missing`); continue; }
      for (const [dow, day] of Object.entries(def.schedule[wk])) {
        if (!/^[0-6]$/.test(dow)) { W(`schedule.${wk} has key "${dow}", expected 0-6`); continue; }
        if (!isObj(day)) { E(`schedule.${wk}.${dow} is not an object`); continue; }
        for (const [k, v] of Object.entries(day)) {
          if (k === "note") continue;
          if (!slots.includes(k)) { W(`schedule.${wk}.${dow} sets "${k}", which is not a slot`); continue; }
          if (v === null) continue;
          if (isObj(def.blocks) && isObj(def.blocks[k]) && def.blocks[k][v] === undefined) {
            E(`schedule.${wk}.${dow}.${k} = "${v}" but blocks.${k}.${v} does not exist — that day would silently render as rest`);
          }
        }
      }
    }
  } else E("schedule must be an object");

  // --- mobility / nutritionTargets: display data, so shape only.
  if (def.mobility !== undefined) {
    if (!Array.isArray(def.mobility)) E("mobility must be an array");
    else def.mobility.forEach((m, i) => {
      if (!isObj(m) || !isStr(m.id)) E(`mobility[${i}] must be an object with an id`);
    });
  }
  if (def.nutritionTargets !== undefined) {
    if (!isObj(def.nutritionTargets)) E("nutritionTargets must be an object");
    else for (const k of Object.keys(def.nutritionTargets)) {
      const t = def.nutritionTargets[k];
      if (!isObj(t)) E(`nutritionTargets.${k} is not an object`);
      else for (const f of ["cal", "protein", "fat", "carbs"]) {
        if (typeof t[f] !== "number") E(`nutritionTargets.${k}.${f} must be a number`);
      }
    }
  }

  // --- tracking / daily: duplicate ids overwrite each other in the log.
  if (isObj(def.tracking)) {
    const ids = [];
    for (const g of ["scales", "numbers", "rates"]) {
      const arr = def.tracking[g];
      if (arr === undefined) continue;
      if (!Array.isArray(arr)) { E(`tracking.${g} must be an array`); continue; }
      arr.forEach((t, i) => {
        // A bare string is the documented shorthand: app.jsx normalises it with
        // `typeof spec === "string" ? { id: spec, label: spec } : spec`, and
        // Henna's programme uses it (scales: ["energy", "symptoms"]). Rejecting
        // it here would fail a working programme.
        if (isStr(t)) { ids.push(t); return; }
        if (!isObj(t) || !isStr(t.id)) E(`tracking.${g}[${i}] must be a string, or an object with an id`);
        else ids.push(t.id);
      });
    }
    // Other keys on tracking are feature flags (weight, nutrition, testing,
    // heartRate) rather than metric groups, so they are left alone.
    const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
    if (dup.length) E(`duplicate tracking ids: ${[...new Set(dup)].join(", ")}`);
  } else E("tracking must be an object");

  if (!isObj(def.daily) && !Array.isArray(def.daily)) E("daily must be an object or array");

  // --- programView: the generated Program tab.
  if (def.programView !== undefined) {
    validateProgramView(def, E, W);
  }

  // --- JSON round-trip. A function or a React component here means the
  //     definition cannot survive being stored, and the loss is silent.
  try {
    const round = JSON.parse(JSON.stringify(def));
    if (JSON.stringify(round) !== JSON.stringify(def)) {
      W("definition does not round-trip through JSON unchanged");
    }
  } catch (err) {
    E(`definition is not JSON-serialisable: ${err.message}`);
  }
  const bad = findNonData(def);
  if (bad.length) E(`non-data values (function/symbol) at: ${bad.slice(0, 5).join(", ")}`);

  return { ok: errors.length === 0, errors, warnings };
}

/* ------------------------------ programView -------------------------------- */

/**
 * The Program tab as data.
 *
 * Each entry is one collapsible card, in order. A card has a title, an optional
 * subtitle and colour, and an ordered `body` of parts.
 *
 * The body is a LIST, not a single kind. That is the shape the real Program tabs
 * need: Ville's "Running" card is an exercise list followed by a prose note,
 * "Yoga and daily mobility" is two exercise lists then a note, and Juha's
 * nutrition card is a table plus two paragraphs. A one-kind-per-card model
 * cannot express any of those.
 *
 * Body part types:
 *   heading   — a bold lead-in line inside the card
 *   paragraph — one block of prose; `strong` optionally bolds a lead-in phrase
 *   lines     — short lines kept on separate rows (numbered goals, rules)
 *   exercises — the exercise list of one or more blocks in a group
 *   mobility  — the mobility list
 *   week      — the generated default-week table, built from `schedule`
 *   table     — a small labelled grid (heart-rate zones, macro targets)
 *   nutrition — renders `nutritionTargets`
 *
 * A card may also set `titleFrom: { group, key }` to take its title and subtitle
 * from a block rather than repeating them, and an `exercises` part may set
 * `groupByBlock: true` to show each block's own label above its list.
 *
 * Colour is a TOKEN, never a raw hex: "accent", "accent2", or "cat:<name>" to
 * follow a category colour. Themes are per-client and switchable, so a hex here
 * would survive a theme change and clash with it.
 */
export const PROGRAM_VIEW_PART_TYPES = [
  "heading", "paragraph", "lines", "exercises", "mobility", "week", "table", "nutrition",
];

const COLOR_TOKEN = /^(accent|accent2|cat:[a-zA-Z][a-zA-Z0-9_-]*)$/;

/** Keys each part type defines, used to catch typos that would render nothing. */
const PART_KEYS = {
  heading:   ["text"],
  paragraph: ["text", "strong"],
  lines:     ["items"],
  exercises: ["group", "keys", "excludeTyped", "groupByBlock", "label"],
  mobility:  [],
  week:      ["week"],
  table:     ["columns", "rows"],
  nutrition: [],
};

function validateProgramView(def, E, W) {
  const pv = def.programView;
  if (!Array.isArray(pv)) { E("programView must be an array of cards"); return; }
  if (!pv.length) { W("programView is an empty array — the Program tab would be blank"); return; }

  pv.forEach((card, i) => {
    const at = `programView[${i}]`;
    if (!isObj(card)) { E(`${at} is not an object`); return; }

    // A card may take its title from a block instead of repeating it. Ville's
    // three strength cards are titled "A — Legs" and so on; hardcoding those
    // strings would leave a stale title the moment a coach renames the block,
    // which is the same class of bug this whole contract removes.
    if (card.titleFrom !== undefined) {
      const tf = card.titleFrom;
      if (!isObj(tf) || !isStr(tf.group) || !isStr(tf.key)) {
        E(`${at}.titleFrom must be { group, key }`);
      } else {
        const grp = isObj(def.blocks) ? def.blocks[tf.group] : null;
        if (!isObj(grp)) E(`${at}.titleFrom.group "${tf.group}" does not exist in blocks`);
        else if (grp[tf.key] === undefined) E(`${at}.titleFrom references blocks.${tf.group}.${tf.key}, which does not exist`);
      }
      if (card.title !== undefined && !isStr(card.title)) E(`${at}.title must be a non-empty string when present`);
    } else if (!isStr(card.title)) {
      E(`${at}.title must be a non-empty string (or use titleFrom)`);
    }
    if (card.subtitle !== undefined && !isStr(card.subtitle)) E(`${at}.subtitle must be a non-empty string when present`);
    if (card.color !== undefined) {
      if (!isStr(card.color) || !COLOR_TOKEN.test(card.color)) {
        E(`${at}.color must be "accent", "accent2" or "cat:<name>" (got ${JSON.stringify(card.color)}) — a raw hex would not follow a theme change`);
      }
    }
    if (card.defaultOpen !== undefined && typeof card.defaultOpen !== "boolean") {
      E(`${at}.defaultOpen must be a boolean`);
    }
    for (const k of Object.keys(card)) {
      if (!["title", "subtitle", "color", "defaultOpen", "titleFrom", "body"].includes(k)) {
        W(`${at} carries unrecognised key "${k}" — it will not render`);
      }
    }
    if (!Array.isArray(card.body) || !card.body.length) {
      E(`${at}.body must be a non-empty array of parts`);
      return;
    }
    card.body.forEach((part, j) => validatePart(def, part, `${at}.body[${j}]`, E, W));
  });
}

/** Keys any part may carry, on top of the ones its own type defines. */
const COMMON_PART_KEYS = ["type", "color", "muted"];

function validatePart(def, part, at, E, W) {
  if (!isObj(part)) { E(`${at} is not an object`); return; }
  if (!PROGRAM_VIEW_PART_TYPES.includes(part.type)) {
    E(`${at}.type must be one of ${PROGRAM_VIEW_PART_TYPES.join(", ")} (got ${JSON.stringify(part.type)})`);
    return;
  }

  // A part may override its card's colour — Ville's yoga list sits in a
  // mobility-coloured card but is drawn in the yoga colour. Same token rule as
  // the card, for the same reason: a hex would not follow a theme change.
  if (part.color !== undefined && (!isStr(part.color) || !COLOR_TOKEN.test(part.color))) {
    E(`${at}.color must be "accent", "accent2" or "cat:<name>" (got ${JSON.stringify(part.color)})`);
  }
  if (part.muted !== undefined && typeof part.muted !== "boolean") {
    E(`${at}.muted must be a boolean`);
  }

  // An unrecognised key is almost always a typo that would render as nothing at
  // all, so it is worth saying out loud rather than ignoring.
  const allowed = COMMON_PART_KEYS.concat(PART_KEYS[part.type] || []);
  for (const k of Object.keys(part)) {
    if (!allowed.includes(k)) W(`${at} carries unrecognised key "${k}" — it will not render`);
  }

  if (part.type === "heading") {
    if (!isStr(part.text)) E(`${at}.text must be a non-empty string`);
  }

  if (part.type === "paragraph") {
    if (!isStr(part.text)) E(`${at}.text must be a non-empty string`);
    if (part.strong !== undefined && !isStr(part.strong)) E(`${at}.strong must be a non-empty string when present`);
  }

  if (part.type === "lines") {
    if (!Array.isArray(part.items) || !part.items.length) E(`${at}.items must be a non-empty array`);
    else part.items.forEach((t, k) => { if (!isStr(t)) E(`${at}.items[${k}] must be a non-empty string`); });
  }

  if (part.type === "exercises") {
    if (!isStr(part.group)) { E(`${at}.group must name a block group`); return; }
    const grp = isObj(def.blocks) ? def.blocks[part.group] : null;
    if (!isObj(grp)) { E(`${at}.group "${part.group}" does not exist in blocks`); return; }
    if (part.keys !== undefined) {
      if (!Array.isArray(part.keys) || !part.keys.length) { E(`${at}.keys must be a non-empty array when present`); return; }
      // THE check this whole section exists for. The compiled ProgramView
      // hardcodes ["a","b","c"] and throws if a key is renamed or dropped;
      // here a stale reference is a validation error, caught before it ships.
      part.keys.forEach((k) => {
        if (grp[k] === undefined) E(`${at}.keys references blocks.${part.group}.${k}, which does not exist`);
      });
    }
    if (part.excludeTyped !== undefined && typeof part.excludeTyped !== "boolean") {
      E(`${at}.excludeTyped must be a boolean`);
    }
    if (part.groupByBlock !== undefined && typeof part.groupByBlock !== "boolean") {
      E(`${at}.groupByBlock must be a boolean`);
    }
    if (part.label !== undefined && !isStr(part.label)) E(`${at}.label must be a non-empty string when present`);
  }

  if (part.type === "mobility" && def.mobility === undefined) {
    E(`${at} is a mobility part but the definition has no mobility list`);
  }

  if (part.type === "nutrition" && def.nutritionTargets === undefined) {
    E(`${at} is a nutrition part but the definition has no nutritionTargets`);
  }

  if (part.type === "week") {
    if (part.week !== undefined && !["A", "B"].includes(part.week)) {
      E(`${at}.week must be "A" or "B" when present`);
    }
  }

  if (part.type === "table") {
    if (part.columns !== undefined) {
      if (!Array.isArray(part.columns) || !part.columns.length) E(`${at}.columns must be a non-empty array when present`);
      else part.columns.forEach((c, k) => { if (!isStr(c)) E(`${at}.columns[${k}] must be a non-empty string`); });
    }
    if (!Array.isArray(part.rows) || !part.rows.length) { E(`${at}.rows must be a non-empty array`); return; }
    part.rows.forEach((r, k) => {
      if (!Array.isArray(r) || !r.length) { E(`${at}.rows[${k}] must be a non-empty array`); return; }
      if (!r.every((c) => typeof c === "string")) E(`${at}.rows[${k}] must contain only strings`);
      if (part.columns && r.length !== part.columns.length) {
        E(`${at}.rows[${k}] has ${r.length} cells but there are ${part.columns.length} columns`);
      }
    });
  }
}

/* --------------------------- non-data value scan --------------------------- */

/**
 * Walk the definition for values that cannot be stored (functions, symbols) and
 * for genuine cycles.
 *
 * `stack` holds only the CURRENT ancestor chain, not everything already seen.
 * That distinction matters: the program files deliberately share objects —
 * `SCHEDULE = { A: WEEK, B: WEEK }` is one object referenced twice, and an
 * exercise like BSS appears in several blocks. A shared reference is a DAG and
 * serialises fine (JSON just writes it out twice); only an object that contains
 * itself is a real cycle. A global "seen" set cannot tell those apart and would
 * reject every valid compiled programme.
 */
function findNonData(v, path = "definition", stack = new Set(), out = []) {
  if (out.length >= 10) return out;
  const t = typeof v;
  if (t === "function" || t === "symbol" || t === "bigint") { out.push(`${path} (${t})`); return out; }
  if (v === null || t !== "object") return out;
  if (stack.has(v)) { out.push(`${path} (circular)`); return out; }
  stack.add(v);
  if (Array.isArray(v)) v.forEach((x, i) => findNonData(x, `${path}[${i}]`, stack, out));
  else for (const [k, x] of Object.entries(v)) findNonData(x, `${path}.${k}`, stack, out);
  stack.delete(v);          // leaving this node: siblings may share it legitimately
  return out;
}

/* -------------------------------- resolve ---------------------------------- */

/**
 * Pick the definition in force on `date` from rows the coach published:
 * the greatest effective_from that is <= date. Same rule Coach-PTapp scores by,
 * so a past day can be re-scored against the programme that was actually live.
 *
 * rows: [{ id, effective_from, definition }]  — effective_from may be
 * "-infinity", which Postgres returns for the oldest rows.
 */
export function resolveForDate(rows, date) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const target = toDayNumber(date);
  let best = null;
  let bestFrom = -Infinity;
  for (const r of rows) {
    const from = effectiveFromNumber(r && r.effective_from);
    if (from === null || from > target) continue;
    if (from >= bestFrom) { bestFrom = from; best = r; }
  }
  return best;
}

function toDayNumber(date) {
  const d = date instanceof Date ? date : new Date(date);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function effectiveFromNumber(v) {
  if (v === "-infinity" || v === null || v === undefined) return -Infinity;
  if (v === "infinity") return Infinity;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/* ------------------------- defended metadata access ------------------------ */
/**
 * Every read of slot metadata in the client goes through these.
 *
 * Why: `PROGRAM.slots` drives the loop that renders a day, and with delivery
 * that array comes from the database while the bundle is whatever was last
 * deployed. A winter programme that adds a "ski" slot therefore asks the app for
 * metadata it has never compiled. Before this, app.jsx read SLOT_META[slot]
 * directly and the next line touched meta.cat — an unknown slot was a white
 * screen. These accessors turn that into a plain grey session instead.
 *
 * They are deliberately NOT a substitute for validate(): a definition that
 * fails validation should be rejected and the compiled one used. This is the
 * second line of defence, for the case that slips through.
 */

export const FALLBACK_SLOT_COLOR = "#8891A3";

/** Title-case a slot key for display: "ski" -> "Ski", "nordic_walk" -> "Nordic walk". */
function labelFromKey(slot) {
  if (!slot || typeof slot !== "string") return "Session";
  const words = slot.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function slotMetaFor(program, slot) {
  const m = program && program.slotMeta && program.slotMeta[slot];
  if (m && typeof m === "object") return m;
  return { label: labelFromKey(slot), color: FALLBACK_SLOT_COLOR };
}

/** Always returns a usable array, so `.map` in the picker cannot throw. */
export function slotOptionsFor(program, slot) {
  const o = program && program.slotOptions && program.slotOptions[slot];
  if (Array.isArray(o) && o.length) return o;
  return [{ value: null, label: "None" }];
}

/** Always returns an object, so blocksFor(p, s)[v] yields undefined, not a throw. */
export function blocksFor(program, slot) {
  const b = program && program.blocks && program.blocks[slot];
  return b && typeof b === "object" ? b : {};
}

/** The mobility list, or an empty list — never undefined. */
export function mobilityFor(program) {
  return program && Array.isArray(program.mobility) ? program.mobility : [];
}
