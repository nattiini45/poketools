/**
 * Design tokens as TypeScript constants (sunlit values).
 * Use these when you need color values in computed styles, charts, or inline styles.
 * For Tailwind classes, use the `poke-*` utility classes instead — those are
 * CSS-variable backed and swap to the moonlit variant under [data-theme="dark"],
 * which these constants cannot.
 */

export const typeColors: Record<string, { bg: string; text: string }> = {
  Normal: { bg: "hsl(60, 5%, 65%)", text: "#FFFFFF" },
  Fire: { bg: "hsl(10, 80%, 55%)", text: "#FFFFFF" },
  Water: { bg: "hsl(215, 75%, 55%)", text: "#FFFFFF" },
  Electric: { bg: "hsl(48, 90%, 55%)", text: "#1A1714" },
  Grass: { bg: "hsl(140, 55%, 45%)", text: "#FFFFFF" },
  Ice: { bg: "hsl(195, 70%, 65%)", text: "#1A1714" },
  Fighting: { bg: "hsl(5, 55%, 40%)", text: "#FFFFFF" },
  Poison: { bg: "hsl(280, 50%, 50%)", text: "#FFFFFF" },
  Ground: { bg: "hsl(35, 60%, 50%)", text: "#FFFFFF" },
  Flying: { bg: "hsl(225, 60%, 70%)", text: "#1A1714" },
  Psychic: { bg: "hsl(340, 65%, 55%)", text: "#FFFFFF" },
  Bug: { bg: "hsl(80, 55%, 45%)", text: "#FFFFFF" },
  Rock: { bg: "hsl(42, 45%, 40%)", text: "#FFFFFF" },
  Ghost: { bg: "hsl(270, 40%, 40%)", text: "#FFFFFF" },
  Dragon: { bg: "hsl(250, 55%, 50%)", text: "#FFFFFF" },
  Dark: { bg: "hsl(20, 15%, 30%)", text: "#FFFFFF" },
  Steel: { bg: "hsl(220, 15%, 60%)", text: "#FFFFFF" },
  Fairy: { bg: "hsl(330, 55%, 65%)", text: "#1A1714" },
};
