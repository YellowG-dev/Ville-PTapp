/**
 * categories.jsx — a display category (label, colour, icon) for each standard
 * slot, so a slot added to a programme looks like itself in every client.
 *
 * Byte-identical across all four client repos, like app.jsx.
 *
 * Why it exists. A section's colour and icon come from CATS[section.cat], and a
 * block's `cat` defaults to its slot name. CATS is per-client data built by
 * catsFor() in config.jsx, so a slot the client never defined a category for
 * (a Run block in Henna's app, say) fell back to the grey "check" colour and
 * the dumbbell. standardCats() supplies the missing ones.
 *
 * Each client's catsFor() spreads this FIRST and its own entries after, so every
 * entry a client already defines wins and no existing colour or icon changes:
 *
 *   return { ...standardCats({ ACCENT, ACCENT_2 }), ...own };
 *
 * Colours are the slot catalogue's (program-schema.js STANDARD_SLOTS), so a
 * slot's Today card and its Calendar dot agree. Strength takes the theme's
 * ACCENT instead: all four clients already draw strength in the accent, and the
 * catalogue value is just that colour under the dark theme. ACCENT_2 is
 * accepted so a caller can pass the whole pair, but no standard slot uses it.
 */
import { Dumbbell, Activity, Footprints, Waves, Bike, Flower2, HeartPulse } from "lucide-react";
import { STANDARD_SLOTS } from "./program-schema.js";

const ICONS = {
  strength: Dumbbell,
  run: Activity,
  walk: Footprints,
  swim: Waves,
  bike: Bike,
  yoga: Flower2,
  cardio: HeartPulse,
};

export function standardCats({ ACCENT }) {
  const cats = {};
  for (const slot of STANDARD_SLOTS) {
    cats[slot.id] = {
      label: slot.label,
      color: slot.id === "strength" && ACCENT ? ACCENT : slot.color,
      Icon: ICONS[slot.id],
    };
  }
  return cats;
}
