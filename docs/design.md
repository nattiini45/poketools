# Design

> Shared design tokens and the `src/components/ui/*` primitive library.
> Implements the visual language defined in the (now archived) Phase 1–5
> visual overhaul plan, unified with the EvoLiga plaza language (2026-09
> redesign): one warm arena-sand palette app-wide.

## Overview

PokéTools uses one unified warm **arena-sand** palette — the EvoLiga plaza's
fighting-game character-select language (sand grounds, cream panels, amber
pick-energy accent) — defined as CSS custom properties in
`src/app/globals.css` and surfaced to Tailwind by the `@theme` blocks at its top under
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

### Direction B (redesign F3)

Since F3 the site's semantic layer is **Direction B, "Character Select"**
(plan addendum D, Caspar 2026-11-09): sand ground, cream surfaces, one amber,
four tier plates for the top ranks, skewed plates for active nav, tabs and
buttons (F4). The B tokens below are the names new code uses; today's
`poke-*` and shadcn names alias onto them on `<html>`, so pages restyle
without edits. The frozen surfaces keep their look ([Frozen surfaces](#frozen-surfaces-and-the-16-px-root)).

## File Structure

```
components.json              # ShadCN config (RSC-safe, aliases @/components/ui, @/lib/utils/cn)
src/lib/utils/cn.ts          # cn() helper (clsx + tailwind-merge)
src/lib/ui/table-params.ts   # parseTableParams(), pagination + sort helpers
src/lib/ui/use-client-table.ts # Client-side sort + pagination hook for data tables
src/app/globals.css          # Tailwind 4 entry (@theme: CSS vars → utilities), CSS custom properties (--poke-*, ShadCN semantic bridge)
src/app/tailwind-base.css    # Tailwind 3.4's preflight, the site's base layer (Tailwind 4's preflight is not imported)
src/components/ui/           # primitive component library (see below)
```

ShadCN semantic tokens (`--background`, `--primary`, `--border`, …) are mapped to
the existing `--poke-*` palette in `globals.css`, so Radix/CVA internals render
in the incumbent warm palette without raw hex in components.

## Tokens

### Direction B tokens (`bg-page`, `text-fg`, `border-hairline`, …)

Declared in `globals.css` (" Direction B tokens") and mapped to Tailwind in
`@theme inline`. Every text pair reads at 4.5:1 or more on every ground
(`b-tokens.test.ts`); washes are solid hex, never `/NN` modifiers (Q3).

| Token | Sunlit | Moonlit | Use |
|---|---|---|---|
| `page` | `#EEE3CA` | `#0E0B06` | Page ground |
| `surface` | `#FFF8E9` | `#171208` | Cards, nav bar |
| `elevated` | `#FAEED6` | `#211A0D` | Table heads, hover base, search field |
| `sunken` | `#E8D9B5` | `#2A2110` | Wells, the hero's arena sand |
| `hairline` / `hairline-strong` | `#E3D2AC` / `#C9B183` | `#3A311C` / `#5C5133` | Borders |
| `fg` / `fg-muted` | `#241A0C` / `#5C4E37` | `#F5EDDD` / `#C4B596` | The two text colours |
| `accent-ink` / `accent-fill` / `accent-subtle` | `#9A4806` / `#CF660B` / `#F7E8CF` | `#FFD166` / `#F5B84B` / `#3B2D13` | The one amber: links and active text, primary button fill, selected wash. `accent-fill` is `#CF660B` instead of the render's `#C05E0A` so dark ink on it reads at 4.5:1 |
| `tier-1…4` | `#F2C14E` · `#F4A97F` · `#8EB4EA` · `#9BD3A6` | `#F5B84B` · `#F09A6B` · `#6E9BE0` · `#5FBF7A` | Top-four rank plates; ink on a plate is always `tier-ink` (`#241A0C`) |
| `tier-1…4-soft` | `#FCE7A6` · `#FBCFA6` · `#C3DBF6` · `#C4E9CD` | same | Soft fills (rank row wash) |
| `live` / `win` / `loss` (+ `-bg`) | `#166534` / `#166534` on `#D7EED3` / `#A91B1B` on `#F6D9D4` | `#6EE7A0` / on `#253420` / `#F8A09B` on `#3B2920` | Status only |
| `hover` / `selected` | `#F4EDDE` / `#E9E2D3` | `#241F15` / `#2D281D` | 5 % and 10 % of `fg` over `surface`, as solid hex |
| `scrim` | `#241A0C` at 40 % | `#000` at 50 % | Modal and nav sheet backdrops (the one translucent token) |
| `--skew` | `-10deg` | same | Every skewed plate (F4) |

The legacy names alias onto the set: `poke-base` → `page`, `poke-surface` → `surface`, `poke-elevated` → `elevated`, `poke-text-primary` → `fg`, `poke-text-secondary` → `fg-muted`, `poke-border(-strong)` → `hairline(-strong)`, `poke-accent` → `accent-ink`, `poke-accent-light` → `accent-subtle`, `poke-live` → `live`, and shadcn's
`--background` / `--foreground`. A site palette (`html[data-palette]`) still
overrides these aliases; reducing it to the accent alone (D6) is a later step.
The tables below describe the legacy names as they stand for themed worlds and
site palettes.

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
| `poke-text-primary` / `-secondary` / `-muted` / `-tertiary` | Four-tier text hierarchy | `#241A0C` / `#5C4E37` / `#675940` / `#6C5E46` | `#F5EDDD` / `#C4B596` / `#97886A` / `#938567` |
| `poke-border` / `-border-strong` | Default + emphasized dividers | `#E3D2AC` / `#C9B183` | `#453C24` / `#5C5133` |
| `poke-accent` / `-accent-strong` / `-accent-light` | Global amber accent (CTAs, active tabs, links-of-honor) | `#9A4806` / `#843C05` / `#F7E8CF` | `#F5B84B` / `#FFD166` / tint |
| `poke-focus` | Focus rings, link text | `#954506` | `#FB923C` |
| `poke-live` | Live/active state signals | `#166534` | `#4ADE80` |
| `poke-glow` | Accent halo wash (rgba) | accent @ 0.28 | accent @ 0.15 |
| `poke-blue` / `green` / `yellow` | Status hues (variable-backed, palette-dependent; opacity modifiers such as `/20` work) | `#1E4BC8` / `#166534` / `#EAB308` | `#659FF6` / `#34C26A` / `#EAB308` |
| `poke-danger` (+ `-danger-light`) | Destructive / loss / error — the ONLY red in the system | `#A91B1B` | `#F4807A` |
| `poke-blue-hover` / `green-hover` / `danger-hover` | Hover fill of a solid status button | `#1A3FA6` / `#14532D` / `#8E1616` | `#87B4F8` / `#5BD389` / `#F8A09B` |
| `poke-on-blue` / `on-green` / `on-danger` | Text ON a solid status fill (never `text-white`: the moonlit status hues are light in every palette, so their on-colour is the dark ground) | `#FFFFFF` | `#0E0B06` |
| `poke-yellow-ink` | Warning text (`Alert` `warning`, legality warnings, draw cells, MVP labels on the yellow tint) | `#854d0e` | `#f2c55c` |
| `poke-danger-ink` | Inline error line on a surface (never static `text-red-500`) | `#A91B1B` (= `poke-danger`) | `#F4807A` (= `poke-danger`) |
| `poke-danger-tint-ink` | Text inside a `bg-red-500/10` or `/20` error box or chip (never static `text-red-400`) | `#8E1616` (= `poke-danger-hover`) | `#F8A09B` (= `poke-danger-hover`) |
| `poke-amber-ink` | Text on a `bg-amber-500/15` flag chip (never static `text-amber-600`) | `#92400e` | `#fbbf24` |
| `poke-*-light` | Tinted backgrounds for badges / callouts | | |
| `poke-moment-*` | Highlight-moment palette used by broadcast moments | | |

Ink tokens meet WCAG AA (≥ 4.5:1) against base / surface / elevated in both
variants, in every site palette, plaza included (the sunlit text tokens are
dark enough for the darkest ground, `poke-base`, so the same value reads on
every card). Text placed ON a filled `poke-accent` background must use
`text-poke-surface` (never `text-white` — moonlit accent is bright gold).
Text placed ON a filled `poke-blue` / `poke-green` / `poke-danger` uses
`text-poke-on-blue` / `-on-green` / `-on-danger`, for the same reason.
Warning and error text uses the ink tokens above, never a static Tailwind
`text-red-*` / `text-amber-*` / `text-yellow-*` (or `text-blue-*` on a
badge): a static shade is tuned against one surface and falls under 4.5:1 on
the others. The moonlit status hues are light, so a solid status fill carries
dark ink (`poke-on-*`) there and white in the sunlit variant.

Every `poke-*` colour is a plain `var()` in `@theme inline`, so it resolves
where it is used (world, palette and frozen-root overrides apply) and Tailwind 4
alpha-blends it with `/NN`. On Tailwind 3 only the seven status tokens
`poke-blue`, `-blue-hover`, `-green`, `-green-hover`, `-yellow`, `-danger`
and `-danger-hover` rendered `/NN`; a modifier on any other token rendered
nothing, so `tailwind-status-tokens.test.ts` keeps those out of the source until
they come back as deliberate visual changes.

**Artwork statics (`art.*`).** Colours that must never follow a palette live
in a separate static hex group: `art-ball-red` (`#DC2626`, the Pokéball's red
half) and `art-card-blue` (`#3B82F6`).

`src/lib/design/tokens.ts` mirrors the sunlit values as TS constants for
charts and inline styles; prefer the CSS-variable-backed Tailwind classes
wherever possible (they swap with the theme, the constants cannot).

### Typography

Fonts (OFL, self-hosted woff2 through `next/font/local`, so the build never fetches a font):

- `font-heading` → Geist Pixel Square: display and title text, the wordmark. One
  weight, so `font-synthesis-weight: none` keeps it from being faked bold.
- `font-body` → Geist Sans (variable, 100–900): everything else, at weights 400 and 550.
- `font-mono` → Geist Mono (variable): pure number columns.
- Emoji fall back to the system emoji font (Geist has none).
- Frozen roots keep Nunito, DM Sans and the system mono stack: `[data-frozen]`
  re-points `--font-heading-face`, `--font-body-face` and `--font-mono`
  (`globals.css`, "Fonts").

Type roles (`typeClass(role)` in `src/lib/design/type.ts`; the size utilities
are `text-<role>`, and `cn()` merges them as font sizes, so
`cn('text-caption', 'text-fg-muted')` keeps both):

| Role | Size / line height | Face |
|---|---|---|
| display | 28 / 34 | Geist Pixel Square |
| title | 18 / 24 | Geist Pixel Square |
| subtitle | 15 / 22 | Geist Sans 550 |
| body | 14 / 20 | Geist Sans |
| caption | 12 / 16 | Geist Sans |
| micro | 11 / 14 | Geist Sans (the floor) |

The root is 16 px (`html { font-size: 100% }`), except on draft-room pages
([Frozen surfaces](#frozen-surfaces-and-the-16-px-root)).

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
- Page and section headings are set in the pixel face without the former plaza
  accent bar: `PageContainer` renders its title in the display role, `Section`
  and `CollapsibleSection` in the title role. All three take an optional
  `icon` (an approved `ItemIconId`), drawn left of the title at 48 px (page)
  or 24 px (section). `Alert` sets its message in Geist Sans (`font-body`):
  the pixel face is for titles and headings only.
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
| `DURATION.instant` | 0ms | No tween; reduced motion on a height tween (`CollapsibleSection`) |
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
| `SPRING.fast` | `bounce 0`, 80ms | Hover, focus rings, fades, tooltips, selection indicators |
| `SPRING.moderate` | `bounce 0`, 160ms | Short travel: indicators, switch thumbs, popovers, drawers |
| `SPRING.slow` | `bounce 0.12`, 240ms | Large surfaces: dialogs, side panels, stepped flows |
| `SPRING_EXIT.{fast,moderate,slow}` | 60 / 120 / 160ms tweens | The exit paired with each speed |
| `SPRING.momentum` | `bounce 0.2`, 400ms | Only after a flick or drag carried velocity |
| `SPRING.default` | `bounce 0`, 350ms | The pre-F3 default, for the frozen world HUD only |
| `--motion-fast` / `--motion-moderate` / `--motion-slow` | 80 / 160 / 240ms | The same speeds for CSS transitions. A CSS module outside the frozen surfaces may not hard-code a duration (`motion-guards.test.ts`) |

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
  One `MotionConfig reducedMotion="user"` (`components/shared/MotionProvider.tsx`,
  re-exported through the motion barrel) is mounted in the root layout and turns
  transform animations off for every `motion` primitive. A primitive that moves
  on its own clock (`CountUpNumber`) or that should not stagger (`PageTransitionWrapper`,
  `AnimatedList`, an animated `Table`, the dashboard) reads `useReducedMotion()`
  as well and sets its stagger to 0; `CollapsibleSection` does too, because
  `MotionConfig` leaves a height tween running, and its height snaps at
  `DURATION.instant` while the opacity fade stays; Tailwind enter/exit
  animations drop their slide with `motion-reduce:` (`BottomSheet`). No
  `transition={{ duration: <number> }}` literal in `src/components`
  (`motion-guards.test.ts`). Broadcast overlays use no motion primitive: they
  follow the caster's `anim=` option, not the viewer's OS setting.

`WORLD_MOTION` in the same file carries the route-world constants (camera
damping, pointer parallax clamp, sway and bob amplitudes, reveal duration) so
the 3D layer obeys the same grammar as the DOM. See the route-world design spec (maintainer-only; not in this repo) §4.4.

## Frozen surfaces and the 16 px root

The draft rooms, themed route worlds, broadcast overlays, EPB animations
(`CrystalXPBar`, `EvolutionRosterCard`), the match highlight card and the social
images keep their pre-redesign pixels (plan addendum B). Their roots carry
`data-frozen="<surface>"` (no styles), and the visual harness holds them to zero
diff (`docs/visual-harness.md`). They were built against an 18 px root, so:

- `frozen-pins.css` (F1) pins the site colours a frozen root inherits.
- `frozen-scale.css` (F3, generated by `npx --no-install tsx scripts/design/frozen-scale.mts`,
  checked by `frozen-scale.test.ts`) re-declares every rem-valued theme token
  (`--spacing`, `--text-*`, `--radius*`, `--container-*`) at 18 px on `[data-frozen]`,
  and the outermost root's font size. Tailwind 4 utilities read these
  variables where they are used, so frozen subtrees keep their geometry. Rerun
  the script after changing a rem token.
- Inside frozen code, write lengths through the spacing scale (`min-w-112`,
  `calc(var(--spacing)*30)`), never an arbitrary `rem` value: those cannot be pinned.
  Plain `rounded` is one spacing step for the same reason.
- Draft-room pages keep the pre-F3 site look (`html:has([data-frozen="draft-room"])`): the
  18 px root, the plaza ground and the Nunito / DM Sans page font. The room fills
  the page under the nav and leaves its ground transparent, and its sticky clock
  bar paints pixel-identical only under the root size and page font it was built
  with, even with identical geometry.
- The containers that size a frozen root keep their pre-F3 pixel widths until
  their track redesigns them: the layout `<main>` (1440 px, 18/27/36 px gutters),
  `PageContainer` (756/1008/1152/1440 px) and the draft board's roster grid gap.
- Fonts: see [Typography](#typography).

## Guardrails

`npm run design:guards` (`scripts/design/check-design-guards.mts`) reports, at warn level
and outside the frozen surfaces (`src/lib/design/frozen-surfaces.ts`): text below 11
px, `uppercase` and `tracking-*`, static Tailwind palette colours, and raw
`<select>`. Pass `--paths "<files>"` to list the hits in the files you touched;
new code should add none.

## Direction B primitives (redesign F4)

### Skewed plates

`SkewPlate` and `SkewChip` (`src/components/ui`) draw a plate sheared by `--skew` (−10°) behind an upright,
selectable label; only the plate span is skewed (`.skew-plate`, `.skew-plate-bg` in `globals.css`).

- `SkewPlate variant="nav"`: the active item gets the gold (`tier-1`) plate with dark ink.
- `variant="tab"`: a surface plate with a strong hairline; the active tab adds a 3 px accent underside.
- `variant="button"`: `tone="primary"` is the amber `accent-fill` with dark ink, `"secondary"` the surface plate.
- `variant="rank"`: the tier 1–4 plates for the top four.
- `glideId`, shared by the items of one row, makes the nav plate or tab underside glide between them with
  `SPRING.moderate` (reduced motion: no glide, through the root `MotionConfig`).
- The label carries an invisible copy at weight 550, so a heavier active label never resizes the plate; nothing
  has a fixed width, so German labels widen it.
- Put the plate inside the link or button it labels. That element's focus ring moves onto the plate (outline on
  the skewed box, offset 2 px).
- `SkewChip` is the small static plate for status chips and score or stat plates: `neutral`, `accent`, `live`,
  `win`, `loss`, `tier-1…4`.

### Item icons

`ItemIcon` (`src/components/ui/ItemIcon.tsx`) draws the approved item icons for nav, tabs, section headers and
states (the map in `src/lib/pkmn/item-icons.ts`): Showdown's per-file icons through `getItemSpriteUrl`, and the four
sheet-only ones (`ability-shield`, `electric-seed`, `gold-bottle-cap`, `weakness-policy`) from pinned sheet
coordinates, like `ball-sprites.ts`. `size` is 24, 48, 72 or 96 (anything else is a type error), rendering is
`image-rendering: pixelated`, and the icon is decorative (`alt=""`): the label beside it names it.

### Fluid primitives

The [Fluid Functionalism](https://www.fluidfunctionalism.com) components and systems (Radix flavour) are vendored
in `src/components/ui/fluid/`, `src/lib/fluid/` and `src/hooks/fluid/` (README there; paths in
`src/lib/design/vendored.ts`). They are never edited to change behaviour: pages reach them through wrappers in
`src/components/ui/`. Their theme variables map onto the B tokens in `globals.css` ("Fluid Functionalism
system"): solid `--active` and `--tint` washes, umber `--surface-1…8` steps in moonlit, `--focus-ring` is the
accent ink, and the `--fs-*` / `--lh-*` sizes are the F3 type roles (compact steps one size down and keeps the
11 px floor). The lint rules of the React Compiler, the duration guard and the i18n literal check skip the vendored
folders; wrappers pass translated labels.

`/ui-preview` (dev only, 404 in production) shows the type roles, item icons, plates, @fluid controls and the site
primitives on the site theme; the harness captures it as the `dev-ui-preview` surface.

### Site primitives on @fluid

`Button`, `Badge`, `Input` and `Textarea` keep their props and paths and render the @fluid control; `Card` keeps
its container API on the B surfaces (`surface`, `elevated`, `hairline`) with @fluid's 80 ms colour hover instead of
the lift (the @fluid `Card` in `fluid/card.tsx` is the clickable tile for new layouts).

- `Button`: `primary` is @fluid's primary fill recoloured to `accent-fill` with plate ink, `success` the same fill
  in `poke-green`, `danger` the same fill in `poke-danger` with `poke-on-danger` ink, `secondary` @fluid's
  bordered `tertiary`, `ghost` its ghost. `sm` is the compact 28 px step, `md` and `lg` the 36 px step. `getButtonClasses` still returns the
  pre-redesign classes for links styled as buttons; the surface tracks move those onto `<Button asChild>`.
- `Badge`: the @fluid solid badge in the B status colours: `green` and `red` are `win` and `loss` on their `-bg`,
  `blue`, `yellow` and `purple` the `poke-blue`, `poke-yellow-ink` and `poke-plum` inks on 15 % of their hue mixed
  into the ground,
  `accent` `accent-ink` on `accent-subtle`, `default` and `gray` the neutral fill. `xs` and `sm` are the 20 px step,
  `md` the 24 px step.
- `Input` and `Textarea` keep the label, hint and error wiring of `field-a11y.tsx` around the @fluid field.
- Frozen surfaces keep the pre-redesign `Button`, `Card`, `Badge` and `buttonStyles` from
  `src/components/ui/frozen/`. Every module a frozen source reaches imports them from there
  (`src/components/ui/__tests__/frozen-primitives.test.ts` walks the imports), including shared pieces such as
  the draft admin forms, `MatchStatusBadge`, `TournamentReportCard` and the stats tables.
- `light-dark()` in the @fluid classes needs the `--lightningcss-light` / `--lightningcss-dark` pair that
  `globals.css` sets per `data-theme`, since the site sets no `color-scheme`.

## UI Primitives — `src/components/ui/`

All primitives are server-component-safe (no `'use client'` unless they need
interactivity) and consume the tokens above.

| Component | Purpose |
|---|---|
| `PageContainer` | Page shell: title/subtitle + max-width wrapper (`maxWidth="xl"` etc.); the title row wraps, so the `action` slot drops below the title on narrow screens |
| `Card` | Surface container with `variant` (outlined/elevated), `padding`, optional `hover` (B surfaces; see "Site primitives on @fluid") |
| `Button` | Primary/secondary/ghost/danger/success variants × sm/md/lg sizes, on the @fluid button |
| `buttonStyles.ts` | `getButtonClasses(variant, size)` for non-`<Button>` callers (e.g. anchor tags) |
| `Badge` | Status/type chip with color variants (green/gray/blue/red/yellow/purple/…), on the @fluid badge |
| `frozen/` | The pre-redesign `Button`, `Card`, `Badge` and `buttonStyles` the frozen surfaces import |
| `Input` / `Select` / `Textarea` | Form controls with label + poke styling (Select keeps native `<select>` for GET forms). Ids come from `useId` (an explicit `id` wins), never from the label text. An `error` sets `aria-invalid` and describes the control through an always-rendered `aria-live="polite"` region; a `hint` (all three take one) describes it while there is no error; a caller's `aria-describedby` is kept and the field's id is appended (`field-a11y.tsx`) |
| `Table` | Data table with optional client sort; exports `SortableTableHeader` + `TablePagination` |
| `Tooltip` / `Popover` | Overlay primitives (Radix for click; custom portal for hover popovers) |
| `Modal` / `ConfirmDialog` | Dialog surfaces (Radix Dialog) |
| `BottomSheet` (`components/shared`) | Mobile sheet on the same Radix Dialog: dialog role named by its title, focus trap, visible close button, swipe-down handle; it restores focus to the element that had it when the sheet opened (Radix only restores to a `Dialog.Trigger`) |
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

- **Tailwind CSS 4** (`@tailwindcss/postcss`) — token mapping in the `@theme` blocks of `globals.css`; enter/exit animations (`animate-in`, `fade-in-0`, `zoom-in-95`, `slide-in-from-*`) from `tw-animate-css`, imported after the utilities. Where Tailwind 4's defaults differ from 3's (colour palette, font stacks, type-scale line heights, px breakpoints) the theme keeps Tailwind 3's values.
- **Browser support** (Q7): Tailwind 4 needs Safari 16.4+, Chrome 111+ and Firefox 128+ (`@property`, `color-mix()`, cascade layers). That is the supported matrix; older browsers get Tailwind's fallbacks, untested.
- **`next/font/local`** — self-hosted Nunito (heading) and DM Sans (body)
  variable woff2; exposed as `--font-heading-face` / `--font-body-face`.
- Every feature module — these are the lowest-level building blocks.

## Related Modules

- Every module doc — all UI references back here for primitives.
- [Public Site](./public-site.md) / [Replays](./replays.md) — canonical
  consumers of `PageContainer` + `Card` + filter forms.

## Notes

- Do **not** introduce raw hex colors in components — extend the token set in
  `globals.css` (custom property plus its `@theme` entry) instead.
- Dark mode is app-wide via the `data-theme` attribute (`light` / `dark`):
  `globals.css` swaps the full `--poke-*` variable set under
  `[data-theme="dark"]`, and Tailwind colors reference the variables so
  components never hard-code theme values. ThemeProvider owns the attribute.
- The site palette is a second, independent attribute next to it:
  `data-palette` on `<html>` (absent = plaza). Light/dark and the palette
  combine through CSS alone; neither attribute's owner touches the other
  ([Site palettes](#site-palettes)).
- The 18 Pokémon type colors live in the `@theme` block of `globals.css` as HSL-tuned
  `poke-type-*` classes (normal … fairy); per-type contrast pairings
  (`text-white` vs `text-poke-text-primary`) are fixed in `TypeBadgeView.tsx` (the hook-free half that `TypeBadge.tsx` wraps with the localized label; a server component renders the view directly so no name table reaches the client).
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
  The layout stamps the request's CSP nonce (`x-nonce`, set by `src/proxy.ts`)
  on the tag, which the nonce policy requires; the static policy of
  `next.config.mjs` still allows it through `script-src 'unsafe-inline'`.
  `site-palette-script.test.ts` pins the `sha256-…` value (a script change must
  update it on purpose).
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
  right before the light/dark toggle in the NavBar (the link row shows from
  `xl`, a menu button replaces it below; at `md` to `xl` the language and palette
  pickers stay in the bar): a disclosure
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
- **Contrast policy.** Every palette, plaza included, meets WCAG 2.x AA in
  both modes: text ≥ 4.5:1 and large text / non-text UI ≥ 3:1 over every pair
  the app relies on (ink tiers, accent, status text and fills, translucent
  status tints and hovers, badges, alerts, moment chips, navbar glass, the
  picker rows, and the component warning / error inks on their tints).
  `src/lib/design/__tests__/site-palettes.test.ts` computes the ratio of each
  documented pair for every palette x mode and fails on any pair under its
  floor; there is no allow-list, so a new token value or component pairing
  that drops under AA fails the suite. Tune a failing text token by darkening
  the ink (sunlit) or lightening it (moonlit), never by changing a ground.
  Plaza's sunlit `poke-accent`, `-accent-strong` and `-focus` are therefore
  darker than the plaza cores (`--palette-plaza-accent` `#C05E0A` and
  friends): the cores stay the EvoLiga world's, the site base set carries
  literals (the same pattern as sakura). The art statics (`art.*`) and the
  `border` tokens are not text and are not gated; a form control's border is
  decorative today (its fill and label carry the component).
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