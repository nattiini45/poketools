/**
 * Design tokens as TypeScript constants (sunlit values).
 * Use these when you need color values in computed styles, charts, or inline styles.
 * For Tailwind classes, use the `poke-*` utility classes instead — those are
 * CSS-variable backed and swap to the moonlit variant under [data-theme="dark"],
 * which these constants cannot.
 */

export const colors = {
  bg: {
    base: "#E8D9B5",
    surface: "#FFF8E9",
    elevated: "#FAEED6",
    muted: "#F1E4C8",
    inverse: "#241A0C",
  },
  text: {
    primary: "#241A0C",
    secondary: "#5C4E37",
    muted: "#8B7B5E",
    inverse: "#FFF8E9",
    link: "#B54708",
  },
  accent: {
    accent: "#C05E0A",
    accentStrong: "#8F4206",
    blue: "#3B82F6",
    blueHover: "#2563EB",
    green: "#16A34A",
    yellow: "#EAB308",
    danger: "#DC2626",
  },
  border: {
    default: "#E3D2AC",
    strong: "#C9B183",
    focus: "#B54708",
  },
} as const;

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

export const shadows = {
  sm: "0 1px 2px rgba(26, 23, 20, 0.05)",
  md: "0 4px 6px -1px rgba(26, 23, 20, 0.07), 0 2px 4px -2px rgba(26, 23, 20, 0.05)",
  lg: "0 10px 15px -3px rgba(26, 23, 20, 0.08), 0 4px 6px -4px rgba(26, 23, 20, 0.04)",
  card: "0 2px 8px rgba(26, 23, 20, 0.06)",
  cardHover: "0 8px 20px rgba(26, 23, 20, 0.10), 0 2px 6px rgba(26, 23, 20, 0.06)",
} as const;
