import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

/** A CSS-variable colour that still honours opacity modifiers (`/20`). A
 *  plain `var(--x)` cannot be alpha-blended by Tailwind 3.4: the class is
 *  silently dropped. color-mix with `transparent` interpolates
 *  premultiplied, so `color-mix(in srgb, X 20%, transparent)` renders the
 *  same pixels as the old `rgb(r g b / 0.2)`. Used ONLY for the status
 *  hues (they were static hex, so their `/NN` classes already render):
 *  switching the other `poke-*` tokens would make ~185 currently dropped
 *  utilities appear and change plaza (docs/design.md § Site palettes).
 *  Chrome serialises the computed value as `color(srgb …)`, which
 *  html2canvas rejects: never use these inside a renderNodeAsPng subtree
 *  (use the static `art.*` colours there). */
const tokenColor = (name: string) =>
  `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",

        // ─── Season world tokens (CSS-variable backed, same pattern as `poke`) ───
        // Scoped by [data-world="..."] in globals.css; sunlit + moonlit variants.
        arena: {
          ground: "var(--world-ground)",
          surface: "var(--world-surface)",
          elevated: "var(--world-elevated)",
          ink: "var(--world-ink)",
          "ink-secondary": "var(--world-ink-secondary)",
          accent: "var(--world-accent)",
          "accent-strong": "var(--world-accent-strong)",
          focus: "var(--world-focus)",
          live: "var(--world-live)",
          glow: "var(--world-glow)",
          border: "var(--world-border)",
        },

        // ─── Unified arena-sand palette (theme-dependent → CSS variables) ───
        poke: {
          // Backgrounds
          base: "var(--poke-base)",
          surface: "var(--poke-surface)",
          elevated: "var(--poke-elevated)",
          muted: "var(--poke-muted)",
          inverse: "var(--poke-inverse)",

          // Text
          "text-primary": "var(--poke-text-primary)",
          "text-secondary": "var(--poke-text-secondary)",
          "text-muted": "var(--poke-text-muted)",
          "text-tertiary": "var(--poke-text-tertiary)",
          "text-inverse": "var(--poke-surface)",
          "text-link": "var(--poke-focus)",

          // Accent (amber — the plaza pick-energy; sunlit/moonlit via vars)
          accent: "var(--poke-accent)",
          "accent-strong": "var(--poke-accent-strong)",
          "accent-light": "var(--poke-accent-light)",
          focus: "var(--poke-focus)",
          live: "var(--poke-live)",
          glow: "var(--poke-glow)",

          // Status colors (palette-dependent; hues honour /NN via tokenColor)
          blue: tokenColor("poke-blue"),
          "blue-hover": tokenColor("poke-blue-hover"),
          "blue-light": "var(--poke-blue-light)",
          green: tokenColor("poke-green"),
          "green-hover": tokenColor("poke-green-hover"),
          "green-light": "var(--poke-green-light)",
          yellow: tokenColor("poke-yellow"),
          "yellow-light": "var(--poke-yellow-light)",
          // Warning / error inks (text only; no alpha needed). Plaza keeps the
          // old static Tailwind values (yellow-700, red-500, red-400,
          // amber-600); the other site palettes give contrast-checked inks.
          "yellow-ink": "var(--poke-yellow-ink)",
          // Inline error line on a surface (was text-red-500)
          "danger-ink": "var(--poke-danger-ink)",
          // Text inside a bg-red-500/10 or /20 error box or chip (was text-red-400)
          "danger-tint-ink": "var(--poke-danger-tint-ink)",
          // Text on a bg-amber-500/15 flag chip (was text-amber-600)
          "amber-ink": "var(--poke-amber-ink)",
          danger: tokenColor("poke-danger"),
          "danger-hover": tokenColor("poke-danger-hover"),
          "danger-light": "var(--poke-danger-light)",
          // Text on a status fill (white in plaza; dark ink in the dark site palettes)
          "on-blue": "var(--poke-on-blue)",
          "on-green": "var(--poke-on-green)",
          "on-danger": "var(--poke-on-danger)",
          plum: "var(--poke-plum)",
          "plum-light": "var(--poke-plum-light)",

          // Border
          border: "var(--poke-border)",
          "border-strong": "var(--poke-border-strong)",
          "border-focus": "var(--poke-focus)",

          // ─── Pokémon type colors (HSL-tuned for warm bg) ───
          "type-normal": "hsl(60, 5%, 65%)",
          "type-fire": "hsl(10, 80%, 55%)",
          "type-water": "hsl(215, 75%, 55%)",
          "type-electric": "hsl(48, 90%, 55%)",
          "type-grass": "hsl(140, 55%, 45%)",
          "type-ice": "hsl(195, 70%, 65%)",
          "type-fighting": "hsl(5, 55%, 40%)",
          "type-poison": "hsl(280, 50%, 50%)",
          "type-ground": "hsl(35, 60%, 50%)",
          "type-flying": "hsl(225, 60%, 70%)",
          "type-psychic": "hsl(340, 65%, 55%)",
          "type-bug": "hsl(80, 55%, 45%)",
          "type-rock": "hsl(42, 45%, 40%)",
          "type-ghost": "hsl(270, 40%, 40%)",
          "type-dragon": "hsl(250, 55%, 50%)",
          "type-dark": "hsl(20, 15%, 30%)",
          "type-steel": "hsl(220, 15%, 60%)",
          "type-fairy": "hsl(330, 55%, 65%)",
        },

        // ─── Static artwork colours (never variable-backed) ───
        // For artwork that must not follow a site palette, or must stay rgb()
        // for html2canvas (MatchHighlightCard export). Values equal the old
        // static poke.danger / poke.blue, so plaza pixels are unchanged.
        art: {
          "ball-red": "#DC2626",
          "card-blue": "#3B82F6",
        },
      },
      fontFamily: {
        heading: ["var(--font-heading)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        "poke-sm": "0 1px 2px rgba(26, 23, 20, 0.05)",
        "poke-md":
          "0 4px 6px -1px rgba(26, 23, 20, 0.07), 0 2px 4px -2px rgba(26, 23, 20, 0.05)",
        "poke-lg":
          "0 10px 15px -3px rgba(26, 23, 20, 0.08), 0 4px 6px -4px rgba(26, 23, 20, 0.04)",
        "poke-card": "0 2px 8px rgba(26, 23, 20, 0.06)",
        "poke-card-hover":
          "0 8px 20px rgba(26, 23, 20, 0.10), 0 2px 6px rgba(26, 23, 20, 0.06)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "poke-sm": "0.375rem",
        "poke-md": "0.5rem",
        "poke-lg": "0.75rem",
        "poke-xl": "1rem",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
        "slide-out-right": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(100%)" },
        },
        "type-shimmer": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.5s ease-in-out infinite",
        "fade-in": "fade-in 0.3s ease-out",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        "slide-out-right": "slide-out-right 0.2s ease-in",
        "type-shimmer": "type-shimmer 0.6s ease-in-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
export default config;
