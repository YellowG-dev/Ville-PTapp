// Themes — every colour decision in the app, named by the job it does.
//
// WHY THIS FILE EXISTS
// Before this, `app.jsx` destructured THEME once at module load
// (`const { BG, CARD, ... } = THEME;`) and used bare identifiers in 315 places.
// That is resolved exactly once, when the bundle loads, so nothing could ever
// change at runtime. A theme switcher is impossible against that shape, which
// is why this file — and the `useTheme()` hook in app.jsx — exist.
//
// WHY NOT CSS CUSTOM PROPERTIES
// Because recharts passes these values straight into SVG *presentation
// attributes* (`stroke={BORDER}`, `tick={{ fill: TEXT_MUTED }}`). `var()`
// resolves in CSS declarations, not in presentation attributes, so the charts
// would silently lose their colours. Keeping real string values in JS is the
// only mechanism that works everywhere in this app.
//
// NAMING RULE
// Tokens are named for the JOB, never the colour. `ON_ACCENT`, not `WHITE`.
// The day a theme has a pale accent, `ON_ACCENT` becomes dark and every one of
// its call sites follows. A token called `WHITE` would have to be edited in 18
// places, which is the problem this file removes.
//
// THIS FILE IS BYTE-IDENTICAL ACROSS THE THREE CLIENT REPOS.
// `config.jsx` is NOT — it stays per-client and picks a default from here.

/* -------------------------------------------------------------------------
   HISTORY — read before changing values

   Phase 0 (20 Sep 2026) moved every colour here unchanged. Phase 1 then fixed
   the DARK theme only:

     - ON_ACCENT went from white to dark. White failed on all eight fills it
       lands on in the dark apps (best 3.34:1); dark passes on all eight (worst
       5.57:1). It is not only the accent: ticks, chips and buttons also sit on
       every category colour, so the test was run against each of them.
     - KNOB split out of ON_ACCENT. The toggle knob sits on a grey track when
       the toggle is OFF — it is not on a fill. A dark knob there measured
       1.43:1, i.e. invisible. It stays white.
     - The Gentler-week badge and the soft tints were ROSE — Henna's accent,
       hardcoded in the shared app.jsx — so the dark apps showed amber text on
       a pink tint. They are now derived from amber.
     - Badge text on a dark card is the badge's own hue at full strength. The
       old dark greens and purples were chosen for a light card and measured
       2.19-2.49:1 on the dark one.

   Phase 3 added STATUS_BAR (moved out of index.html so the installed app's
   status bar follows the theme) and the runtime switcher.

   rose-linen was deliberately NOT changed. Its sub-4.5 pairs were reviewed one
   by one and judged acceptable for its one known user (owner decision, 20 Sep
   2026). They are listed as ACCEPTED in verify-theme.mjs, so a regression still
   fails the suite while these known choices do not.
   ------------------------------------------------------------------------- */

const SPACE_GROTESK =
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap";
const FRAUNCES =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Karla:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap";

export const THEMES = {
  // Juha's and Joonatan's current look, unchanged.
  "amber-slate": {
    id: "amber-slate",
    label: "Amber on slate",
    mode: "dark",
    BG: "#10131A",
    CARD: "#1A1F29",
    BORDER: "#2A3140",
    TEXT_PRIMARY: "#EEF0F3",
    TEXT_SECONDARY: "#8891A3",
    TEXT_MUTED: "#5C6577",
    ACCENT: "#E3A23C",
    ACCENT_2: "#4CB6C4",
    // Foreground on any filled swatch — accent buttons, category dots, ticks.
    // Foreground on any filled swatch — the accent AND every category colour.
    ON_ACCENT: "#10131A",
    // The toggle knob. Not "on accent": when the toggle is off it sits on BORDER.
    KNOB: "#FFFFFF",
    // The phone's status bar in the installed app (<meta name="theme-color">).
    // index.html carries the default theme's value for first paint; the app
    // updates it when the theme changes.
    STATUS_BAR: "#10131A",
    // Fallback "target met" green when a palette defines no mobility colour.
    OK: "#7FB88F",
    HEAT_RGB: "111,207,151",
    TINT: {
      soft: "rgba(227,162,60,0.1)",
      softBorder: "rgba(227,162,60,0.3)",
      selected: "rgba(227,162,60,0.12)",
    },
    BADGE: {
      // Text follows CATS.check.color (client data), so only the tint can move:
      // 0.16 -> 0.10 lifts it from 4.11:1 to 4.53:1.
      neutral: { tint: "rgba(136,145,163,0.1)", border: "rgba(136,145,163,0.45)" },
      ramp: { tint: "rgba(127,184,143,0.16)", border: "rgba(127,184,143,0.45)", text: "#7FB88F" },
      // Text follows ACCENT.
      gentler: { tint: "rgba(227,162,60,0.14)", border: "rgba(227,162,60,0.4)" },
      moved: { tint: "rgba(169,155,201,0.16)", border: "rgba(169,155,201,0.45)", text: "#A99BC9" },
    },
    FONT_DISPLAY: "'Space Grotesk', system-ui, sans-serif",
    FONT_BODY: "'IBM Plex Sans', system-ui, sans-serif",
    FONT_MONO: "'IBM Plex Mono', ui-monospace, monospace",
    FONT_IMPORT: SPACE_GROTESK,
  },

  // Henna's current look, unchanged. Note this is a LIGHT theme — the app has
  // had one all along; it was simply baked into one repo's config.jsx.
  "rose-linen": {
    id: "rose-linen",
    label: "Rose on linen",
    mode: "light",
    BG: "#FBF7F4",
    CARD: "#FFFFFF",
    BORDER: "#EADFD8",
    TEXT_PRIMARY: "#2E2724",
    TEXT_SECONDARY: "#7A6A62",
    TEXT_MUTED: "#A2938B",
    ACCENT: "#C97388",
    ACCENT_2: "#7FB88F",
    ON_ACCENT: "#fff",
    KNOB: "#fff",
    // Henna's status bar was always her accent, not her background. Kept.
    STATUS_BAR: "#C97388",
    OK: "#7FB88F",
    HEAT_RGB: "201,115,136",
    // These rose and lilac values were written for THIS palette, which is why
    // they looked wrong in the dark apps and right here. Unchanged since Phase 0.
    TINT: {
      soft: "rgba(201,115,136,0.1)",
      softBorder: "rgba(201,115,136,0.3)",
      selected: "rgba(201,115,136,0.12)",
    },
    BADGE: {
      neutral: { tint: "rgba(136,145,163,0.16)", border: "rgba(136,145,163,0.45)" },
      ramp: { tint: "rgba(127,184,143,0.16)", border: "rgba(127,184,143,0.45)", text: "#4C7A5A" },
      gentler: { tint: "rgba(201,115,136,0.14)", border: "rgba(201,115,136,0.4)" },
      moved: { tint: "rgba(169,155,201,0.16)", border: "rgba(169,155,201,0.45)", text: "#6D5F91" },
    },
    FONT_DISPLAY: "'Fraunces', Georgia, serif",
    FONT_BODY: "'Karla', system-ui, sans-serif",
    FONT_MONO: "'IBM Plex Mono', ui-monospace, monospace",
    FONT_IMPORT: FRAUNCES,
  },
};

export const THEME_IDS = Object.keys(THEMES);

/**
 * Merge a theme with a client's own category palette.
 *
 * CATS is CLIENT data, not theme data: Juha has nine categories, Henna and
 * Joonatan six, and they are not the same six. Putting them in the theme would
 * force every theme to carry categories that two of the three apps never show.
 * The theme supplies colours; `config.jsx` decides which categories exist.
 *
 * Returns the exact key set `app.jsx` expects, so no call site changes.
 */
export function buildTheme(id, cats) {
  const theme = THEMES[id] || THEMES[THEME_IDS[0]];
  return {
    ...theme,
    CATS: cats,
    // Preserves the previous derivation exactly:
    //   const OK_COLOR = (CATS.mobility && CATS.mobility.color) || "#7FB88F";
    OK_COLOR: (cats && cats.mobility && cats.mobility.color) || theme.OK,
  };
}
