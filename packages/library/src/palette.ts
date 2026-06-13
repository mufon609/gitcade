/**
 * The ONE fixed 8-color GitCade palette (a Sweetie16 subset). Art direction is
 * LOCKED (MASTER-PLAN §2): every generated sprite, tile, and background — and any
 * runtime-drawn shape (particles, HUD bars) — draws from exactly these colors so
 * the whole catalog reads as one coherent minimalist game.
 *
 * This is the canonical copy. `scripts/gen-assets.ts` carries an identical literal
 * (it must run standalone on Node with zero imports); a unit test asserts the two
 * never drift.
 */
export const LIBRARY_PALETTE = [
  "#1a1c2c", // 0 ink (near-black)
  "#41a6f6", // 1 blue
  "#3b5dc9", // 2 deep blue
  "#ef7d57", // 3 orange
  "#ffcd75", // 4 yellow
  "#a7f070", // 5 green
  "#b13e53", // 6 red
  "#f4f4f4", // 7 light
] as const;

/** Semantic aliases into {@link LIBRARY_PALETTE} for readable runtime drawing. */
export const PALETTE = {
  ink: LIBRARY_PALETTE[0],
  blue: LIBRARY_PALETTE[1],
  deepBlue: LIBRARY_PALETTE[2],
  orange: LIBRARY_PALETTE[3],
  yellow: LIBRARY_PALETTE[4],
  green: LIBRARY_PALETTE[5],
  red: LIBRARY_PALETTE[6],
  light: LIBRARY_PALETTE[7],
} as const;
