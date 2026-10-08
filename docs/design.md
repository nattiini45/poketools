# Design

> Shared design tokens and the `src/components/ui/*` primitive library.
> Implements the visual language defined in the (now archived) Phase 1–5
> visual overhaul plan, unified with the EvoLiga plaza language (2026-09
> redesign): one warm arena-sand palette app-wide.

## Overview

PokéTools uses one unified warm **arena-sand** palette — the EvoLiga plaza's
fighting-game character-select language (sand grounds, cream panels, amber
pick-energy accent) — defined as CSS custom properties in
`src/app/globals.css` and surfaced to Tailwind via `tailwind.config.ts` under
the `poke-*` namespace. Every page and component should use these tokens
rather than raw colors so theming stays consistent. The former brand red
`#E3350D` survives only as `poke-danger` (destructive actions, loss/error
semantics); the global accent is amber `#C05E0A` (sunlit) / `#F5B84B`
(moonlit).

That palette is the default, **plaza**. Each device can switch the whole site
to one of three optional **site palettes** carried over from the league
worlds: `sakura` (Sakura Park), `mountain` (Mountain Pass) and `clouds`
(Skyisle), each with a sunlit and a moonlit variant. The token names stay
the same; only their values change (see [Site palettes](#site-palettes)).
League world pages keep their own world palette whatever the site palette.

## File Structure

```
components.json              # ShadCN config (RSC-safe, aliases @/components/ui, @/lib/utils)
src/lib/utils.ts             # cn() helper (clsx + tailwind-merge)
src/lib/ui/table-params.ts   # parseTableParams(), pagination + sort helpers
src/lib/ui/use-client-table.ts # Client-side sort + pagination hook for data tables
src/app/globals.css          # CSS custom properties (--poke-*, ShadCN semantic bridge)
tailwind.config.ts           # maps CSS vars → Tailwind theme (poke + shadcn tokens)
src/components/ui/           # primitive component library (see below)
```

ShadCN semantic tokens (`--background`, `--primary`, `--border`, …) are mapped to
the existing `--poke-*` palette in `globals.css`, so Radix/CVA internals render
in the incumbent warm palette without raw hex in components.

## Tokens

### Color (`poke-*` in Tailwind: `bg-poke-*`, `text-poke-*`, `border-poke-*`)

Values below are the default **plaza** palette. The site palettes override
the 43 base colour tokens (`BASE_TOKEN_NAMES`) on `<html>`; the moment chips
and stat bars keep their plaza values, except that the dark sakura, mountain
and clouds variants re-ink the red, purple and blue moment chips
([Site palettes](#site-palettes)).

| Token | Use | Sunlit | Moonlit |
|---|---|---|---|
| `poke-base` | App background (arena ground) | `#E8D9B5` | `#0E0B06` |
| `poke-surface` | Card / panel fill | `#FFF8E9` | `#171208` |
| `poke-elevated` | Raised surfaces, table headers | `#FAEED6` | `#241C0E` |
| `poke-muted` | Subtle backgrounds, hover states | `#F1E4C8` | `#1D160A` |
| `poke-text-primary` / `-secondary` / `-muted` / `-tertiary` | Four-tier text hierarchy | `#241A0C` / `#5C4E37` / `#8B7B5E` / `#A3926F` | `#F5EDDD` / `#C4B596` / `#97886A` / `#7D6F52` |
| `poke-border` / `-border-strong` | Default + emphasized dividers | `#E3D2AC` / `#C9B183` | `#453C24` / `#5C5133` |
| `poke-accent` / `-accent-strong` / `-accent-light` | Global amber accent (CTAs, active tabs, links-of-honor) | `#C05E0A` / `#8F4206` / `#F7E8CF` | `#F5B84B` / `#FFD166` / tint |
| `poke-focus` | Focus rings, link text | `#B54708` | `#FB923C` |
| `poke-live` | Live/active state signals | `#166534` | `#4ADE80` |
| `poke-glow` | Accent halo wash (rgba) | accent @ 0.28 | accent @ 0.15 |
| `poke-blue` / `green` / `yellow` | Status hues (variable-backed, palette-dependent; opacity modifiers such as `/20` work) | `#3B82F6` / `#16A34A` / `#EAB308` | same |
| `poke-danger` (+ `-danger-light`) | Destructive / loss / error — the ONLY red in the system | `#DC2626` | same |
| `poke-blue-hover` / `green-hover` / `danger-hover` | Hover fill of a solid status button | `#2563EB` / `#15803D` / `#B91C1C` | same |
| `poke-on-blue` / `on-green` / `on-danger` | Text ON a solid status fill (never `text-white`: the moonlit site palettes use light status hues, so their on-colour is the dark ground) | `#FFFFFF` | same |
| `poke-yellow-ink` | Warning text (`Alert` `warning`, legality warnings, draw cells, MVP labels on the yellow tint) | `#a16207` | same |
| `poke-danger-ink` | Inline error line on a surface (never static `text-red-500`) | `#ef4444` | same |
| `poke-danger-tint-ink` | Text inside a `bg-red-500/10` or `/20` error box or chip (never static `text-red-400`) | `#f87171` | same |
| `poke-amber-ink` | Text on a `bg-amber-500/15` flag chip (never static `text-amber-600`) | `#d97706` | same |
| `poke-*-light` | Tinted backgrounds for badges / callouts | | |
| `poke-moment-*` | Highlight-moment palette used by broadcast moments | | |

Ink tokens meet WCAG AA (≥ 4.5:1) against base / surface / elevated in both
variants. Text placed ON a filled `poke-accent` background must use
`text-poke-surface` (never `text-white` — moonlit accent is bright gold).
Text placed ON a filled `poke-blue` / `poke-green` / `poke-danger` uses
`text-poke-on-blue` / `-on-green` / `-on-danger`, for the same reason.
Warning and error text uses the ink tokens above, never a static Tailwind
`text-red-*` / `text-amber-*` / `text-yellow-*`: those were tuned against
plaza's near-black dark surfaces and fall under 4.5:1 on the lighter dusk
surfaces of the other palettes. Plaza keeps the old static values, so
switching a component to a token changes no plaza pixel.

The seven status tokens `poke-blue`, `-blue-hover`, `-green`, `-green-hover`,
`-yellow`, `-danger` and `-danger-hover` are built with `tokenColor()` in
`tailwind.config.ts` (`color-mix(in srgb, var(--poke-…) calc(<alpha-value> *
100%), transparent)`), so they follow the palette and still honour opacity
modifiers. Every other `poke-*` colour stays a plain `var()`: Tailwind 3.4
silently drops `/NN` on those, and switching them would surface styles that
render nothing today.

**Artwork statics (`art.*`).** Colours that must never follow a palette live
in a separate static hex group: `art-ball-red` (`#DC2626`, the Pokéball's red
half) and `art-card-blue` (`#3B82F6`, the `MatchHighlightCard` glow).

**html2canvas rule.** `getComputedStyle` serialises a `color-mix()` status
utility as `color(srgb …)`, which html2canvas 1.4.1 rejects. No
`poke-{blue,blue-hover,green,green-hover,yellow,danger,danger-hover}` class may
appear inside a node passed to `renderNodeAsPng` (`src/lib/utils/export-node.ts`);
use the `art.*` statics there. `html-to-image` (`capture-node.ts`) is unaffected.

`src/lib/design/tokens.ts` mirrors the sunlit values as TS constants for
charts and inline styles; prefer the CSS-variable-backed Tailwind classes
wherever possible (they swap with the theme, the constants cannot).

### Typography
- `font-heading` → `--font-heading` (Nunito, self-hosted variable woff2 via
  `next/font/local`; fetched from Google at build time broke cold-cache CI
  builds). Used for headings, badges, table headers, labels.
- `font-body` → `--font-body` (DM Sans, self-hosted variable woff2). Body text.
- Base font-size is 18px (112.5%) for readability at 100% OS scaling.

### Shape & elevation
- `rounded-poke-{sm,md,lg,xl}` → `0.375rem / 0.5rem / 0.75rem / 1rem`
- `shadow-poke-{sm,md,lg,card,card-hover}` — soft, low-alpha shadows tuned for
  the sand palette.

### Panel recipes & headings
- `src/components/ui/panel.ts` exports the app-wide surface class strings
  (`PANEL`, `PANEL_INSET`, `PANEL_NOTICE`, `PANEL_HOVER`, `FOCUS_RING`,
  `TABLE_HEAD`) — the poke-token twin of the world contract in
  `src/components/world/panel.ts`. Compose panels from these instead of
  re-deriving radius/border/fill per page.
- Page and section headings carry the plaza accent bar:
  `<div className="mt-2 h-0.5 w-12 rounded-full bg-poke-accent" />` under a
  `font-heading font-bold tracking-tight` title (`PageContainer` and
  `Section` render it automatically).
- Glass chrome (NavBar, world HUD): translucent surface + `backdrop-blur(18px)
  saturate(1.25)` + sheen gradient + inset top highlight. The NavBar sheen
  lives in `globals.css` (`[data-navbar-glass]::before`).
- Tailwind `darkMode` is `["selector", '[data-theme="dark"]']` — `dark:`
  utilities are available and key off the ThemeProvider attribute.

### Motion

Numeric source of truth: `src/lib/motion/tokens.ts` (pure data, server-safe).
Presets that consume it: `src/components/shared/motion.tsx`. Never hard-code a
duration or easing curve in a component.

| Token | Value | Use |
|---|---|---|
| `DURATION.micro` | 140ms | Hover, press — must feel instantaneous |
| `DURATION.state` | 220ms | Toggle, select, discrete state change |
| `DURATION.overlay` | 280ms | Popover, toast, dialog |
| `DURATION.section` | 560ms | A page section arriving on scroll |
| `DURATION.hero` | 1100ms | Multi-beat hero sequences |
| `EASE.out` | `0.22, 1, 0.36, 1` | Entrances (decelerate, long settle) |
| `EASE.in` | `0.64, 0, 0.78, 0` | Exits (accelerate, faster) |
| `EASE.standard` | `0.4, 0, 0.2, 1` | Moves that start and end on screen |
| `OFFSET.{sm,md,lg}` | 8 / 16 / 24px | Entrance translation; nothing travels further |
| `STAGGER.{desktop,mobile}` | 60 / 40ms | Between siblings in a list |
| `SPRING.default` | `bounce 0`, 350ms | Every UI spring unless a gesture preceded it |
| `SPRING.momentum` | `bounce 0.2`, 400ms | Only after a flick or drag carried velocity |
| `SPRING.surface` | `bounce 0.05`, 450ms | Sheets and large panels |

Rules:

- **Springs animate from the presentation value, not the target.** That is what
  makes them interruptible; a user must be able to grab a moving element and
  reverse it without a jump.
- **Bounce is earned.** Overshoot belongs only to motion the user physically
  initiated. A menu that merely faded in must not bounce.
- **Enter and exit along the same path.** A panel entering from the right
  dismisses to the right, with the mirrored easing curve.
- **Animate `transform` and `opacity` only.** Never width/height/top/left, and
  never large-area filters.
- **Reduced motion is not "no feedback".** Under
  `prefers-reduced-motion: reduce`, translation and stagger drop but opacity
  cross-fades remain — content stays legible and state changes stay visible.

`WORLD_MOTION` in the same file carries the route-world constants (camera
damping, pointer parallax clamp, sway and bob amplitudes, reveal duration) so
the 3D layer obeys the same grammar as the DOM. See the route-world design spec (maintainer-only; not in this repo) §4.4.

## UI Primitives — `src/components/ui/`

All primitives are server-component-safe (no `'use client'` unless they need
interactivity) and consume the tokens above.

| Component | Purpose |
|---|---|
| `PageContainer` | Page shell: title/subtitle + max-width wrapper (`maxWidth="xl"` etc.) |
| `Card` | Surface container with `variant` (outlined/elevated), `padding`, optional `hover` |
| `Button` | Primary/secondary/ghost/danger variants × sm/md/lg sizes |
| `buttonStyles.ts` | `getButtonClasses(variant, size)` for non-`<Button>` callers (e.g. anchor tags) |
| `Badge` | Status/type chip with color variants (green/gray/blue/red/yellow/purple/…) |
| `Input` / `Select` / `Textarea` | Form controls with label + poke styling (Select keeps native `<select>` for GET forms) |
| `Table` | Data table with optional client sort; exports `SortableTableHeader` + `TablePagination` |
| `Tooltip` / `Popover` | Overlay primitives (Radix for click; custom portal for hover popovers) |
| `Modal` / `ConfirmDialog` | Dialog surfaces (Radix Dialog) |
| `Alert` | Inline message banners |
| `Section` / `CollapsibleSection` | Content grouping |
| `Combobox` | Searchable select |
| `Skeleton` | Loading placeholder |

### Table UX shared components

- **`SortableTableHeader`** — click/tap cycles **asc → desc → none**; lucide arrow
  indicators; `aria-sort`. Server pages pass `href`; client tables pass `onSort`.
- **`TablePagination`** — default 20 rows, 50/100 selector; prev/next + page numbers.
  Server pages pass `pageHref` / `perPageHref`; client tables use callbacks.
- **`parseTableParams()`** — reads `page` (≥1) and `perPage` ∈ {20,50,100} from URL params.

## Usage

```tsx
import PageContainer from '@/components/ui/PageContainer';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';

<PageContainer maxWidth="xl">
  <Card variant="outlined" padding="lg" className="border-poke-red/20">
    <Badge variant="green" size="sm">active</Badge>
  </Card>
</PageContainer>
```

Token usage in className:
```tsx
<div className="bg-poke-surface text-poke-text-primary rounded-poke-xl shadow-poke-card">
```

## Dependencies

- **Tailwind CSS 3** — token mapping in `tailwind.config.ts`.
- **`next/font/local`** — self-hosted Nunito (heading) and DM Sans (body)
  variable woff2; exposed as `--font-heading` / `--font-body`.
- Every feature module — these are the lowest-level building blocks.

## Related Modules

- Every module doc — all UI references back here for primitives.
- [Public Site](./public-site.md) / [Replays](./replays.md) — canonical
  consumers of `PageContainer` + `Card` + filter forms.

## Notes

- Do **not** introduce raw hex colors in components — extend the token set in
  `globals.css` + `tailwind.config.ts` instead.
- Dark mode is app-wide via the `data-theme` attribute (`light` / `dark`):
  `globals.css` swaps the full `--poke-*` variable set under
  `[data-theme="dark"]`, and Tailwind colors reference the variables so
  components never hard-code theme values. ThemeProvider owns the attribute.
- The site palette is a second, independent attribute next to it:
  `data-palette` on `<html>` (absent = plaza). Light/dark and the palette
  combine through CSS alone; neither attribute's owner touches the other
  ([Site palettes](#site-palettes)).
- The 18 Pokémon type colors live in `tailwind.config.ts` as HSL-tuned
  `poke-type-*` classes (normal … fairy); per-type contrast pairings
  (`text-white` vs `text-poke-text-primary`) are fixed in `TypeBadge.tsx`.
- When adding a new primitive, document it in the table above.

## Site palettes

A per-device colour scheme for the whole site, built from the colour cores
of the four league worlds (Layer 0 below: the colours each world's DOM
sections and its Lite page render in). The default `plaza` is exactly the
arena-sand palette above; a plaza user sees no change at all.

| Id | Label | Description | World dialect |
|---|---|---|---|
| `plaza` (default) | Plaza | Warm sand · default | `evoliga` |
| `sakura` | Sakura Park | Blossom and plum | `sakura` |
| `mountain` | Mountain Pass | Meadow and spruce | `mountain` |
| `clouds` | Skyisle | Cloud and slate | `clouds` |

Ids, labels and the token-name list live in `src/lib/design/site-palettes.ts`
(client- and server-safe, no React); the resolved token mirror for tests is
`src/lib/design/site-palette-tokens.ts`.

**Mechanism.**

- **Storage and attribute.** The pick is stored per device in localStorage
  under `poketools:site-palette` and applied as `<html data-palette="<id>">`.
  Plaza is the attribute's absence (and no stored value). It is independent
  of light/dark: `next-themes` keeps `data-theme`.
- **Pre-paint script** (`src/lib/design/site-palette-script.ts`). The root
  layout inlines `SITE_PALETTE_PREPAINT_SCRIPT` as the first child of
  `<head>`, so the attribute lands before `<body>` is parsed: no flash. It is a
  pure constant built from module constants (safe for
  `dangerouslySetInnerHTML`). It sets the attribute only when the stored value
  exactly matches a non-default id, swallows storage errors (the page renders
  plaza), never touches `data-theme`, and exits early on `/broadcast/*`.
  The CSP allows it through `script-src 'unsafe-inline'`; if the CSP ever moves
  to hashes, `site-palette-script.test.ts` pins the `sha256-…` value (a script
  change must update it on purpose).
- **Store and hook** (`src/lib/design/site-palette-store.ts`, `'use client'`).
  `useSitePalette()` is a `useSyncExternalStore` over the `<html>` attribute
  (the truth after first paint; `null` on the server and before hydration).
  `writeSitePalette(id)` applies, persists (plaza removes the key) and
  notifies; when storage fails the pick still applies for the page view.
  Other tabs follow through validated `storage` events. There is no Context
  or provider.
- **Guard** (`src/components/shared/SitePaletteGuard.tsx`, mounted once in the
  root layout). React 19 strips every attribute it did not render from the
  `<html>` singleton when it releases or re-acquires it; StrictMode's simulated
  remount does both on every dev load, which removed the pre-paint value.
  `watchSitePaletteAttribute()` re-applies the intended palette (this tab's
  pick, else storage, else plaza) on start, whenever `data-palette` changes,
  and on other tabs' `storage` events, so pages without the NavBar keep it
  too. It pauses while `withDefaultSitePalette` renders plaza for the social
  image and skips `/broadcast/*`.
- **Picker** (`src/components/shared/PalettePicker.tsx`). `PalettePicker` sits
  right before the light/dark toggle in the desktop NavBar: a disclosure
  button whose panel is a native radio group (`PaletteOptions`; arrow keys
  select and apply at once, Enter or Escape closes and returns focus to the
  button). It is never portalled: the panel stays inside `#site-nav`, so the
  D33 reveal over the 3D world keeps the bar open while the pointer or focus
  is in it (`RouteNavReveal` treats a pointer over `#site-nav`'s subtree as on
  the bar), and the panel consumes its own Escape so the bar stays revealed.
  `PalettePickerSection` is the inline group inside the mobile drawer's scroll
  region. Swatches read `var(--palette-<id>-<role>)` (ground, surface,
  accent), so they show each palette in the current light/dark mode with no
  hex. They preview the world cores: where the site lowers a core for AA, the
  swatch shows the core, not the site token. Today that is only the sunlit
  Sakura accent (core `#c2436c`, site `--poke-accent` `#b23a60`).
- **No scene churn.** `WorldStateProvider` observes only `data-theme`; a
  palette switch never starts a theme veil or a scene generation.

**CSS layers** (`src/app/globals.css`):

```
Layer 0  palette cores   :root / [data-theme="dark"]    --palette-<id>-<role>   (the one place a world-contract value lives)
Layer 1  site base set   :root + themed world elements  --poke-*, --background, ShadCN, moments, stat bars  (plaza)
Layer 2  site palettes   html[data-palette="<id>"] (+ [data-theme="dark"])  overrides Layer 1 on <html> only
Layer 3  world blocks    [data-world="<ns>"]            --world-* = var(--palette-<palette>-*), --hud-* (unchanged)
         root aliases    :root { --world-ground: var(--poke-base); --world-ink: var(--poke-text-primary); … }
                         (arena-* outside worlds follows the site)
         .league-hub     (unchanged)
```

- **World pin.** Every themed `[data-world]` subtree (`evoliga`, `sakura`,
  `mountain`, `clouds`) keeps its own world palette. Layer 1 also
  targets those elements through a zero-specificity `:where(…)` list, so
  non-hub content inside a world keeps the plaza `--poke-*` set, and Layer 3
  pins `--world-*` to the world's cores. The DOM-only `default` world (the
  `resolveWorld` fallback) is not pinned: it paints no ground of its own
  (`WorldShell` renders `data-world-ground` only for themed worlds), so its
  panels would otherwise sit plaza-coloured on a palette-coloured body. It
  follows the site palette like any other page. Portalled Radix content (tooltips,
  popovers, dialogs) mounts under `<body>`, so it follows the site palette,
  as does the NavBar, including its D33 reveal over the 3D world.
- **Broadcast exemption.** `/broadcast/*` (OBS overlays) never gets a
  `data-palette`: overlay output is the same for every viewer.
- **Stored social image.** "Create / Update Social Image"
  (`CreateSocialImageButton`) captures `#match-highlight-card` and stores the
  PNG for every viewer, so it runs the capture inside
  `withDefaultSitePalette()` (`site-palette-store.ts`): the attribute is
  removed for the capture (the page shows plaza for that moment) and put
  back afterwards, unless the viewer picked a palette meanwhile. The local
  download (`ExportCardButton`) keeps the viewer's palette. The image still
  follows the admin's light/dark mode, as before.
- **Contrast policy.** Every non-plaza palette meets WCAG 2.x in both modes:
  text ≥ 4.5:1 and non-text UI ≥ 3:1 over every pair the app relies on
  (ink tiers, accent, status text and fills, translucent status tints and
  hovers, badges, alerts, moment chips, navbar glass, the picker rows, and
  the component warning / error inks on their tints). Plaza
  keeps today's values; its pre-existing sub-floor pairs are pinned as
  `KNOWN_PLAZA_FAILURES` in `src/lib/design/__tests__/site-palettes.test.ts`,
  so the list can only shrink. Fixing them is a separate product decision.
- **Not palette-driven (yet).** `<meta name="theme-color">` and the web
  manifest stay plaza.

**Adding a palette.** Add its cores to Layer 0 (light and dark), one Layer 2
pair (`html[data-palette="<id>"]` and `…[data-theme="dark"]`, each with the
full token list), the id and meta to `SITE_PALETTE_IDS` / `SITE_PALETTES`, and
its values to the tokens mirror. The tests then list what is missing
(completeness, CSS ↔ TS parity, contrast floor, the pre-paint allowlist).

## World Tokens (Season Worlds)

Season **worlds** (see `./poketools-spec.md` §4.2 — keyed off
`seasons.format_type` via a world registry) are visual namespaces layered on
top of the base system above — they do not replace it.

- A world is a **CSS-variable namespace** (`--world-*`). A `WorldShell`
  component resolves the season's world from the registry and applies the
  world's variable set to its subtree.
- Every world defines two variants: **sunlit** (under `data-theme="light"`)
  and **moonlit** (under `data-theme="dark"`). The world must be fully legible
  and complete in both; sunlit and moonlit are the same world under different
  light, not two designs.
- World tokens govern surface treatment, accent dialect, and atmosphere
  inside the shell. The base system (ink, type colors, typography,
  accessibility rules) remains in force underneath.
- The **evoliga** world is an **arena world**: fighting-game
  character-select energy (roster grid, preview stage, player dock). Its
  palette is warm arena-floor sand in the sunlit variant and deep espresso
  with gold pick-energy in the moonlit variant — the same arena under
  different light.

### World-token contract (11 tokens)

- `--world-ground`, `--world-surface`, `--world-elevated` — arena surfaces
- `--world-ink`, `--world-ink-secondary` — arena text (body + secondary)
- `--world-accent`, `--world-accent-strong` — pick/highlight energy
- `--world-focus`, `--world-live` — focus rings and live-state signals
- `--world-glow` — ambient accent halo (rgba accent wash behind pick /
  preview moments)
- `--world-border` — hairline frame color for arena panels

Every world reads its contract from the **palette cores** in
`src/app/globals.css` (`--palette-<id>-<role>`, declared on `:root` and again
under `[data-theme="dark"]`): `[data-world="evoliga"]` declares
`--world-* = var(--palette-plaza-*)`, and the
`sakura` / `mountain` / `clouds` blocks read their own cores, so sunlit/moonlit
switching comes free via `[data-theme="dark"]` (the dark world blocks carry
only `--hud-*`). Every themed world is **pinned**: it renders the same whatever
site palette the viewer picked ([Site palettes](#site-palettes)). The DOM-only
`default` world declares no `--world-*`, so it reads the root aliases and
follows the site palette. Outside any world
the root aliases (`--world-ground: var(--poke-base)`, `--world-ink:
var(--poke-text-primary)`, `--world-accent: var(--poke-accent)`, …) still feed the
`arena-*` utilities, so those follow the site palette. A future world that
wants a distinct dialect adds its cores to Layer 0 and a
`[data-world="..."]` block that reads them. Both ink tiers meet WCAG AA
(≥ 4.5:1) against ground / surface / elevated in both variants.

Each token gets a sunlit and a moonlit value. Adding a future world (e.g.
Core Liga) means a new registry entry plus one new `--world-*` namespace —
never a fork of the base system.

**The three route-theme namespaces.** The multi-theme run (C-093..C-095)
added three dialects alongside `evoliga`, each a sunlit+moonlit pair of
`[data-world="..."]` blocks in `src/app/globals.css`: `sakura`
(cherry-blossom park — blossom-pink washes over lake teal), `mountain`
(alpine valley — granite/snow over meadow green), and `clouds` (sky-isle
chain — cloud white over high-altitude blue). A `WorldShell` stamps
`data-world` from the world's `tokenNamespace`, so any component inside a
world subtree resolves its dialect automatically. In the 3D scene the
dialect is extended, not replaced: the theme's `paletteExtension` merges
over the token-derived core with extension keys winning (the full contract lives in
the multi-theme route-worlds spec, maintainer-only; not in this repo).

### World tokens in 3D

The EvoLiga route world (`src/components/world/route/`) carries **no palette of
its own**. At mount it reads the computed `--world-*` values off the
`[data-world="evoliga"]` element and maps them to scene color roles — fog and
distant terrain from `--world-ground`, structure from `--world-surface` /
`--world-elevated`, emissive practicals from `--world-accent-strong`, the
focused-object rim from `--world-focus`, live state from `--world-live`.

Two consequences follow, and both are the point: sunlit and moonlit are the
same route under different light rather than two art directions, and because
the canvas is transparent with fog keyed to `--world-ground`, aerial
perspective dissolves into the page background instead of into a skybox.
Resolution lives in `src/lib/route-world/palette.ts`.