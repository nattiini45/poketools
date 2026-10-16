# Admin Module

> Site-wide administration surface: server-rendered management pages backed by a guarded admin API for data imports, exports, maintenance jobs, and moderation.

## Overview
The Admin module is a Next.js App Router surface (route group `/admin` and `/api/admin`) for running the platform. Every page is wrapped in an `AdminGuard` client component and every API route calls `requireAdmin()`, so only site-wide admins (`player.isAdmin`) can reach either side. Pages are thin server components that delegate to client content components (`*Console`, `*Manager`, `*Tools`) living alongside them; the API does the heavy lifting against Supabase and internal `src/lib` services.

## File Structure
```
src/app/admin/
├── layout.tsx          # NavBar + AdminGuard + AdminSidebar + PageTransitionWrapper shell
├── page.tsx            # Dashboard (AdminDashboardContent) + management links
├── AdminDashboardContent.tsx
├── leagues/            # list, new, [id], archived
├── tournaments/        # list, new (TournamentCreator), [id]/rounds, archived
├── rulesets/           # list, new, [id]/edit
├── matches/            # list, [id] (AdminMatchActions), [id]/games/[gid]/edit, [id]/import-replay
├── players/            # roster (PlayerRoster)
├── achievements/       # AchievementDefinitionsManager
├── social/             # Discord / X / Threads / Bluesky config
├── wiki/               # WikiModerationPanel (notes, reports)
├── meta-data/          # Smogon usage/sample-set imports (MetaDataConsole)
├── audit/              # AuditLogBrowser
├── data/               # import players / export datasets (AdminDataTools)
├── kale/               # KaleConsole
└── test-players/       # isolated dummy accounts (TestPlayersConsole)

src/app/api/admin/      # guarded route handlers (see API Routes)
src/lib/admin/
└── export-rate-limit.ts  # daily export quota via Supabase RPC
```

## Core Functions/Classes

- **Auth guard** — `requireAdmin()` in `src/lib/auth/helpers.ts`: resolves the session player and throws `AuthError(403)` unless `isAdmin`. Pages additionally render through `components/shared/AdminGuard`.
- **Export rate limit** — `checkAndRecordAdminExport()` in `src/lib/admin/export-rate-limit.ts`: enforces `ADMIN_EXPORT_DAILY_LIMIT = 20` via the `check_and_record_admin_export` Supabase RPC, returning `{ allowed, remaining, reset_at }`.
- **Dashboard content** — `AdminDashboardContent.tsx`: live counts, attention-required matches, and recent audit activity fed by `/api/admin/dashboard`.
- **Aggregate maintenance** — `GET`/`POST /api/admin/aggregates`: query aggregate-job queue stats, or `drain` pending jobs / `rebuild` a scope (`tournament`, `league`, `all_time`) from `battle_stats`.
- **Reconcile** — `POST /api/admin/reconcile`: dry-run (`repair: false`) or repair season-derived data, scoped to one `season` or `all`.
- **Data export** — `POST /api/admin/export`: zod-validated CSV/JSON export of `players`, `tournaments`, `matches`, `seasons`, `games`, `battle_stats`, rate-limited and audit-logged.

## Layout and navigation
- **Sidebar** — `src/components/admin/AdminSidebar.tsx` renders the role-filtered groups from `adminNav.ts` (`visibleAdminNav`). At `lg` (1024 px) and up it is a sticky 224 px side rail beside the content column. Below `lg` it renders one horizontally scrolling chip row per group instead.
- **Responsive shell** — `src/app/admin/layout.tsx` lays out the sidebar and the content column as a column below `lg` (`flex flex-col`), so the chip rows sit above the content, and as a top-aligned row from `lg` (`lg:flex-row lg:items-start lg:gap-8`). The mobile nav is capped at the column width (`min-w-0 w-full`) and each chip row scrolls inside it, so the page never scrolls sideways at phone or tablet widths. The content column keeps `min-w-0` (and `lg:flex-1` beside the rail), so its flex minimum is never its content's intrinsic width; wide content (tables) still needs its own `overflow-x-auto` wrapper on the page. Before the PR #65 test-pass fix the chip nav sat beside the content below `lg`: at 390 px the content column got zero width, the page widened to 1331 px and dialogs (Substitute) centred off-screen. Regression test: `src/components/admin/__tests__/admin-layout-responsive.test.tsx`.

## Data Flows
- **Read**: admin pages (server components) query Supabase via `src/lib/supabase/queries/*` and render through `AdminGuard`; the dashboard pulls live aggregates from `/api/admin/dashboard`.
- **Write**: mutations go through `/api/admin/*` routes, which call `requireAdmin()`, validate input (zod schemas from `src/lib/validation`), execute against Supabase or internal services, and emit audit events via `logAuditEvent()`.
- **Maintenance**: long-running jobs (`aggregates`, `reconcile`) set `maxDuration = 300`; exports are capped by the daily rate-limit RPC and stream CSV/JSON back to the browser.

## Dependencies
- **External Libraries**: `zod` (input validation), `next/server` (route handlers).
- **Internal Modules**:
  - [Supabase Module](./supabase.md) — data access and RPC calls
  - [Audit](./audit.md) — `logAuditEvent` used by export and other mutations
  - [Reconcile](./reconcile.md) — `reconcileSeasonDerivedData` / `reconcileAllSeasons`
  - [Import](./import.md) — import routes and backfill jobs
  - `src/lib/match/aggregate-queue` and `aggregate-rebuild` — aggregate maintenance
  - [Security Patterns](./security-patterns.md) — auth guards

## API Routes
All routes call `requireAdmin()` and return `ApiResult` envelopes; errors go through `safeErrorResponse`.

- **Dashboard & audit**: `/api/admin/dashboard` (counts + attention + activity), `/api/admin/audit-log`.
- **Data export/import**: `/api/admin/export`, `/api/admin/players/import`, `/api/admin/import-sets`, `/api/admin/import-sample-sets`, `/api/admin/import-stats`, `/api/admin/import-usage-stats`, `/api/admin/import/point-buy`, `/api/admin/import/team-roles`.
- **Match/game operations**: `/api/admin/matches`, `/api/admin/matches/[id]/reset`, `/api/admin/matches/[id]/replay-import`, `/api/admin/matches/[id]/replay-preview`, `/api/admin/games/[id]`.
  - The per-match admin pages (`/admin/matches/[id]`, `/import-replay`, `/games/[gid]/edit`) need more than `AdminGuard`'s any-admin check: the viewer must be a site admin or a resource admin of that match's tournament or league. `canAdministerMatch(match.tournament_id)` in `src/app/admin/matches/[id]/match-access.tsx` decides it from the live `getLiveAccess()` read; any other admin sees `MatchAccessDenied`. It is the same rule as `/api/admin/matches/[id]/reset` and `/api/admin/games/[id]`.
- **Player discipline**: `/api/admin/players/[id]/suspend`, `/api/admin/players/[id]/unsuspend`.
- **Achievements & gamification**: `/api/admin/achievements`, `/api/admin/achievements/[id]`, `/api/admin/backfill-gamification`.
- **Maintenance jobs**: `/api/admin/aggregates`, `/api/admin/reconcile`, `/api/admin/rounds/[id]/reset`.
- **Wiki moderation**: `/api/admin/wiki/notes`, `/api/admin/wiki/reports`, `/api/admin/wiki/reports/[id]`.
- **Testing**: `/api/admin/test-players`.
  - Test leagues: a site admin marks a league as one on `/admin/leagues/[id]` (**Test League** section, checkbox *Test league — excluded from public lists and all-time stats*, `LeagueTestFlagControl`). It PATCHes `{ is_test_season }` to `/api/seasons/[id]`, which refuses league admins (**403**), audits `season.set_test_flag` and expires the league's reads and the season list. Public league lists hide test leagues; the admin lists keep them with a **Test** badge, and the league's own URL still works. Details: [Season](./season.md#test-leagues).

## Related Modules
- [Audit](./audit.md)
- [Reconcile](./reconcile.md)
- [Import](./import.md)
- [Tournament](./tournament.md)
- [Season](./season.md)
- [Security Patterns](./security-patterns.md)
