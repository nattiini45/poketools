# Visual-capture harness

Module doc for `scripts/visual/`. It proves that a change leaves the frozen surfaces pixel-identical, and it captures every other surface for review. The redesign (one PR per step: Tailwind 4, tokens, fonts, primitives) runs it on every PR.

## What it captures

Two manifests, both expanded into one job per page load (target × matrix × viewport × theme):

- **`frozen.json`: frozen surfaces, zero diff required.** The frozen set has no default tolerance: per-channel threshold 0 and 0 changed pixels. After the Tailwind 4 switch every frozen capture was pixel-identical to Tailwind 3 (518 of 518), so rounding needs no allowance; a 1 px move of a root's children or a 3-level change of its text colour fails the run. `tolerance` stays reserved for GPU-drawn content. Each capture is an element screenshot clipped to the surface's root, so site chrome around it may change. Roots are marked with `data-frozen="<surface>"` in the components (or are the surface's own root: `[data-world]`, `#match-highlight-card`); broadcast overlays are captured as whole pages, because an overlay is the page.

  | Surface | How it is reached | Root |
  |---|---|---|
  | Draft room: pick screen, redraft center, token center, in-room admin sheet, their sheets and dialogs | `/draft-preview?scenario=…&world=evoliga\|sakura\|none&now=…` (30 scenarios; the four admin control-page scenarios are not frozen) | `[data-frozen="draft-room"]` |
  | Themed route worlds (DOM tier) | `/route-preview?world=…&scenario=…&tier=lite` | `[data-world]` |
  | Themed world league pages | `/leagues/<seeded id>` | `[data-world]` |
  | Broadcast overlays | `/broadcast/…` with seeded ids, 1920×1080 | full page |
  | EPB match replay (XP bars, evolution reveal), closed and opened | seeded EPB match page | `[data-frozen="epb-replay"]` |
  | EPB roster cards (`EvolutionRosterCard`: every stage, progress band and source, wildcard, regular pick, current picker) | `/leagues/<seeded legacy EPB league>/draft`, signed in as the admin (the legacy board renders only for a signed-in viewer) | `[data-frozen="epb-roster-card"]`, one capture per card |
  | Match highlight card | seeded match page | `#match-highlight-card` |
  | Social match card (next/og) | `social-images.tsx` renders fixed fixtures, no browser | the PNG itself |

  Every target runs at 1440×900 (desktop) and 390×844 (mobile) unless it names its own viewports, in sunlit (light) and moonlit (dark).

- **`routes.json`: surface captures, reviewed and never gated.** Public, player and admin pages at 390, 768, 1280 and 1440 px, both themes, `en` and `de`, as an anonymous visitor, a player and a site admin.

## Running it

Prerequisites: `npm ci`, Playwright's Chromium (`npx playwright install chromium`), and for seeded targets the local stack with the visual seed:

```bash
npx supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor
npx supabase db reset --local      # optional: a clean database
npm run visual:seed                # fixed ids and dates; safe to run again
```

Compare a PR against its base (what CI's advisory `visual` job does):

```bash
npm run visual:compare -- --base origin/main --head HEAD          # both refs in worktrees beside the checkout
npm run visual:compare -- --base origin/main                      # head = this working tree (no dev server may run here)
npm run visual:compare -- --base origin/main --head-url http://localhost:3010   # head = a dev server you already run here
```

A base from before the harness (no `scripts/visual/frozen.json`, so no `data-frozen` markers) has nothing to compare against: `compare.mjs` says so and exits 0.

Or capture and diff labels by hand:

```bash
npm run visual:capture -- --label before [--set frozen|surfaces|all] [--only draft-room,route-world] [--base-url http://localhost:3010]
npm run visual:capture -- --label after
npm run visual:diff -- --base before --head after
```

Output goes to `.visual/` (gitignored): `<label>/<set>/*.png` with a `manifest.json`, and `diff-<base>-vs-<head>-<set>/report.md` with the base, head and diff image (changed pixels in magenta) of every capture that changed. `diff.mjs` exits 1 when a frozen capture changed, appeared, disappeared, changed size or failed to load.

`run.mjs` boots its own `next dev` on port 3123 (3124 and 3125 in `compare.mjs`) behind `.claude/local-db.cjs`, with the example pack (`FORMAT_PACK=example`). Next allows one dev server per checkout, so pass `--base-url` when one already runs.

## Determinism

- **Time.** Targets with `"clock": true` pin the browser clock to the manifest's `now` and pass it to the page (`/draft-preview?now=` builds its scenario from that instant), so countdowns read the same in every run. The seed writes fixed dates.
- **Motion.** `prefers-reduced-motion: reduce`, Playwright's `animations: 'disabled'`, the dev overlay hidden, fonts awaited, lazy images switched to eager and every image loaded and decoded, then a quiet network for 600 ms.
- **Chrome.** Element captures hide every fixed or sticky element that neither sits inside a root nor contains one (the sticky nav bar over a scrolled root), so a chrome change never shows up as a frozen diff.
- **Position.** Element captures also drop everything that comes before or after a root (and the vertical padding, margin and border of its ancestors, plus the root's own vertical margin, which a parent's `space-y-*` puts above the root on Tailwind 3 and below it on Tailwind 4), so a taller or shorter nav, page header or footer never moves the root or changes how far the page scrolls, and then nudge each static or relative root to whole pixels across and to the next multiple of 64 px down. Text, borders, gradients and rotated boxes rasterise by their offset on the page, so an unchanged surface captured under different chrome is pixel-identical. Lazy images inside a root are loaded before the capture.
- **Ground.** The page ground is chrome as well: element captures clear the background of every ancestor of a root and paint the page with the plaza ground (`--palette-plaza-ground`), so the pixels a root leaves transparent (rounded corners, an outlined card) show the same backdrop whatever the site's ground is.
- **Raster.** Chromium runs with software raster on one thread (`DETERMINISTIC_CHROMIUM_ARGS` in `run.mjs`): GPU and tiled raster anti-alias rounded corners differently from run to run.
- **Timers.** Overlays that rotate or play on an interval (match story, moment reel, weekly recap, attract screen) run on a paused fake clock (`advanceMs`): the harness steps it until the overlay has its data, then runs it forward by exactly `advanceMs`, one capture per act or slide.
- **Rate limits.** A `429` from the app would capture a page without its data, so that job fails and is run again after the `Retry-After` wait (up to four attempts).
- **Data order.** A frozen surface must not depend on row order the database leaves open. The recap's usage list and stat leaders break ties by name for this reason.
- **Network.** Every request is intercepted. Loopback goes through; images from the allow-listed sprite hosts (`lib.mjs`, `EXTERNAL_IMAGE_HOSTS`) are served from `.visual/cache` after their first fetch; anything else is aborted and fails the run. A capture therefore never reaches the hosted Supabase project or a Storage bucket (AGENTS.md: automation never spends the Supabase quota).
- **Same code on both sides.** `compare.mjs` copies the head's `scripts/visual/` into the base worktree, hard-links `node_modules` when the lockfiles match (`npm ci` otherwise) and hard-links the gitignored local assets under `public/`.
- **Proof.** Two runs on an unchanged tree give zero diff; a one-pixel change in `draft-tool.module.css` fails the run.

## Adding a frozen target

Add an entry to `frozen.json`: `id`, `url` (`{name}` placeholders come from the matrix, the seed ids in `seed-ids.json` and `now`/`theme`/`viewport`), `roots` or `fullPage`, and optionally `matrix`, `viewports`, `themes`, `needs` (seed ids it requires), `mask` (selectors painted over, for content that cannot be pinned), `clock`, `waitFor` (a selector to wait for before the capture, e.g. until a confirm dialog has armed), `advanceMs` (with `clock`: fake timers, run forward this many ms once the page has rendered `waitFor` or its overlay content; may be a `{matrix}` placeholder), `settleMs` and `tolerance` (`{ maxChangedPct, threshold }`, only for GPU-drawn content). Mark a new frozen component root with `data-frozen="<surface>"`; the attribute carries no styles.

## Not covered

- The WebGL route tier: GPU output is not bit-stable across machines. `scripts/capture-route.mjs` remains the tool for route-tier stills; the DOM it draws over the canvas (HUD, Station Card, focus panel) is covered here through the lite tier and the league pages.
- The private format pack: captures run with the example pack, as CI does. A maintainer run with the companion attached compares the same way (`FORMAT_PACK` stays `example` in the harness; change it locally to capture the private pack).
