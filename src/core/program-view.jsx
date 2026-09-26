/**
 * program-view.jsx — the Program tab, rendered from the programme definition.
 *
 * Byte-identical across all four client repos, like app.jsx. Everything it
 * draws comes from `program.programView`: an ordered list of cards, each with
 * an ordered `body` of parts. The contract lives in program-schema.js.
 *
 * Why it exists. Each client's Program tab used to be hand-written JSX that
 * read blocks by hardcoded key — BLOCKS.strength.a.label. Since Step 8 the
 * programme is delivered from the database, so a coach can publish one whose
 * blocks are renamed or removed, and that read becomes undefined.label: a
 * white screen on the tab. Here every lookup goes through the accessors, and a
 * missing block, slot or list renders nothing or a fallback, never an
 * exception.
 *
 * Colour arrives as a TOKEN, never a raw value, so a card follows a theme
 * change instead of clashing with it. resolveColor turns the token into
 * whatever this client's theme says.
 *
 * Section and ExerciseList are passed in from app.jsx, which owns them.
 */
import React from "react";
import {
  blocksFor, slotMetaFor, slotOptionsFor, mobilityFor,
} from "./program-schema.js";

/** Display order of the week table: Monday first, Sunday last. */
const DOW = [
  [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"],
];

function resolveColor(token, theme) {
  if (token === "accent2") return theme.ACCENT_2;
  if (typeof token === "string" && token.startsWith("cat:")) {
    const cat = theme.CATS && theme.CATS[token.slice(4)];
    return (cat && cat.color) || theme.ACCENT;
  }
  return theme.ACCENT;                     // "accent", undefined, anything odd
}

/* ------------------------------- Body parts ------------------------------- */

/** A block's movements, optionally without the prose notes kept alongside them. */
function exercisesOf(block, excludeTyped) {
  const list = block && Array.isArray(block.exercises) ? block.exercises : [];
  return excludeTyped ? list.filter((e) => !e.type) : list;
}

function renderExercises(part, key, ctx, color) {
  const { program, theme, ExerciseList } = ctx;
  const grp = blocksFor(program, part.group);
  const keys = Array.isArray(part.keys) ? part.keys : Object.keys(grp);
  // A key the delivered programme no longer carries is skipped, not drawn empty.
  const present = keys.filter((k) => grp[k]);

  if (part.groupByBlock) {
    return (
      <div key={key} className="space-y-3">
        {present.map((k) => (
          <div key={k} className="space-y-1.5">
            <p className="text-xs font-semibold" style={{ color: theme.TEXT_SECONDARY }}>{grp[k].label}</p>
            <ExerciseList exercises={exercisesOf(grp[k], part.excludeTyped)} color={color} />
          </div>
        ))}
      </div>
    );
  }

  const all = present.reduce((acc, k) => acc.concat(exercisesOf(grp[k], part.excludeTyped)), []);
  return <ExerciseList key={key} exercises={all} color={color} />;
}

/** One weekday's line: every slot with a value, joined, or the day's own note. */
function dayLine(program, day) {
  const slots = Array.isArray(program && program.slots) ? program.slots : [];
  const parts = [];
  for (const slot of slots) {
    const value = day && day[slot];
    if (!value) continue;
    const opt = slotOptionsFor(program, slot).find((o) => o.value === value);
    parts.push(`${slotMetaFor(program, slot).label} — ${opt ? opt.label : value}`);
  }
  if (!parts.length) return (day && day.note) || "Rest";
  return parts.join(" + ");
}

function renderWeek(part, key, program, theme) {
  const schedule = (program && program.schedule) || {};
  const week = schedule[part.week || "A"] || {};
  return (
    <div key={key} className="space-y-1 text-xs">
      {DOW.map(([dow, name]) => (
        <div key={dow} className="flex items-center justify-between gap-2">
          <span style={{ fontFamily: theme.FONT_MONO, color: theme.TEXT_SECONDARY, width: 44 }}
                className="shrink-0">{name}</span>
          <span className="flex-1">{dayLine(program, week[dow])}</span>
        </div>
      ))}
    </div>
  );
}

/** A flex row, not a table row: it has to wrap sanely at phone width. */
function tableRow(cells, key, theme, isHeader) {
  const last = cells.length - 1;
  return (
    <div key={key} className="flex items-center justify-between gap-2">
      {cells.map((cell, i) => {
        const style = {};
        if (isHeader || i === 0) style.color = theme.TEXT_SECONDARY;
        else if (i === last) style.color = theme.TEXT_MUTED;
        if (i === 0) style.width = 36;
        return (
          <span key={i} style={style} className={i === 0 ? "shrink-0" : "flex-1"}>{cell}</span>
        );
      })}
    </div>
  );
}

function renderTable(part, key, theme) {
  const rows = Array.isArray(part.rows) ? part.rows : [];
  const columns = Array.isArray(part.columns) ? part.columns : null;
  return (
    <div key={key} className="space-y-1 text-xs" style={{ fontFamily: theme.FONT_MONO }}>
      {columns && tableRow(columns, "head", theme, true)}
      {rows.map((row, i) => tableRow(Array.isArray(row) ? row : [row], i, theme, false))}
    </div>
  );
}

/** Only one client has nutrition targets; for the rest this renders nothing. */
function renderNutrition(key, program, theme) {
  const targets = program && program.nutritionTargets;
  if (!targets || typeof targets !== "object") return null;
  const dayTypes = Object.keys(targets);
  if (!dayTypes.length) return null;
  return (
    <div key={key} className="grid grid-cols-2 gap-3">
      {dayTypes.map((k) => {
        const t = targets[k] || {};
        return (
          <div key={k}>
            <p className="text-xs font-semibold" style={{ color: theme.TEXT_SECONDARY }}>{k}</p>
            <p className="text-xs" style={{ fontFamily: theme.FONT_MONO }}>&lt; {t.cal} kcal</p>
            <p className="text-[11px]" style={{ fontFamily: theme.FONT_MONO, color: theme.TEXT_MUTED }}>
              P &gt;{t.protein}g · F &lt;{t.fat}g · C &lt;{t.carbs}g
            </p>
          </div>
        );
      })}
    </div>
  );
}

function renderPart(part, key, ctx) {
  if (!part || typeof part !== "object") return null;
  const { program, theme, ExerciseList } = ctx;
  const { TEXT_MUTED, TEXT_SECONDARY } = theme;
  // A part may override its card's colour: the yoga list inside a
  // mobility-coloured card is drawn in the yoga colour.
  const color = part.color ? resolveColor(part.color, theme) : ctx.cardColor;

  switch (part.type) {
    case "heading":
      return (
        <p key={key} className="text-xs font-semibold" style={{ color: TEXT_SECONDARY }}>{part.text}</p>
      );

    case "paragraph":
      return (
        <p key={key} className="text-xs" style={part.muted ? { color: TEXT_MUTED } : undefined}>
          {part.strong ? (
            <>
              <span className="font-semibold" style={{ color: TEXT_SECONDARY }}>{part.strong}</span>
              {" "}
              {part.text}
            </>
          ) : part.text}
        </p>
      );

    case "lines":
      return (
        <div key={key} className="space-y-1">
          {(Array.isArray(part.items) ? part.items : []).map((line, i) => (
            <p key={i} className="text-xs" style={{ color: TEXT_MUTED }}>{line}</p>
          ))}
        </div>
      );

    case "exercises":
      return renderExercises(part, key, ctx, color);

    case "mobility":
      return <ExerciseList key={key} exercises={mobilityFor(program)} color={color} />;

    case "week":
      return renderWeek(part, key, program, theme);

    case "table":
      return renderTable(part, key, theme);

    case "nutrition":
      return renderNutrition(key, program, theme);

    default:
      return null;                        // an unknown part type draws nothing
  }
}

/* --------------------------------- Cards ---------------------------------- */

export function GeneratedProgramView({ program, Section, ExerciseList, theme }) {
  const cards = program && program.programView;
  if (!Array.isArray(cards) || !cards.length) return null;

  return (
    <div className="px-4 max-w-md mx-auto space-y-3">
      {cards.map((card, i) => {
        if (!card || typeof card !== "object") return null;

        // titleFrom takes the title off the block itself, so a renamed block
        // cannot leave a stale title behind. If the block is gone, fall back to
        // the card's own title; with neither, the card is skipped entirely.
        let title = card.title;
        let subtitle = card.subtitle;
        if (card.titleFrom && typeof card.titleFrom === "object") {
          const block = blocksFor(program, card.titleFrom.group)[card.titleFrom.key];
          if (block) {
            title = block.label || card.title;
            subtitle = block.subtitle || card.subtitle;
          }
        }
        if (!title) return null;

        const cardColor = resolveColor(card.color, theme);
        const body = Array.isArray(card.body) ? card.body : [];
        return (
          <Section key={i} title={title} subtitle={subtitle} color={cardColor} defaultOpen={card.defaultOpen}>
            {body.map((part, j) => renderPart(part, j, { program, theme, ExerciseList, cardColor }))}
          </Section>
        );
      })}
    </div>
  );
}
