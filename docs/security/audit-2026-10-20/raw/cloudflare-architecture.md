# Architecture summary — PokéTools (`poketools`)

## 1. Product, principals, normal authority, protected resources

PokéTools 0.2.1 is a self-hosted competitive-Pokémon league and tournament manager: leagues and seasons, Swiss/round-robin/elimination tournaments, snake and linear drafts, an Evolution-Point-Buy draft room, a teambuilder with Showdown paste import/export, replay parsing and stats, Glicko-2 ratings, broadcast overlays, wiki, avatars, and AI analysis. One deployment serves one community, with its own Supabase project, Discord application, and secrets.

Principals by decreasing trust: anonymous visitor (public reads only); a NextAuth identity with no `players` row, which passes `requireAuth` but not `requirePlayer`; a guest roster row with no identity; a player (active, suspended, or banned); a content creator; a resource admin scoped by `resource_admins` to one season or tournament; a site admin (`players.is_admin`); an environment-configured superadmin (`SUPERADMIN_DISCORD_ID` / `SUPERADMIN_EMAIL`); a cron caller holding `CRON_SECRET`; a bootstrap caller holding `BOOTSTRAP_SECRET`; and the AI tool caller.

Protected resources: match results and their confirmation state, draft picks/tokens/redraft state, team sheets and their capability share links, player identity and standing, social-integration credentials, and the full admin export.

## 2. Comparable baseline

`docs/challonge-mapping.md` makes the comparison explicit: Challonge is a multi-tenant SaaS bracket engine with registration, fees, and Stripe; PokéTools is a self-hosted bracket core plus Pokémon-specific engines over a Discord-authenticated roster. The trade-off it accepts is no payment flow and no self-service registration surface, in exchange for organizer moderation and operator-held secrets — which moves risk into per-route authorization and secret handling rather than billing. Pokémon Showdown (`@pkmn/protocol`, `@pkmn/sets`) and Smogon (`@smogon/calc`) are the protocol and data comparables for replay and paste parsing. These calibrate effort and severity only.

## 3. Stack, deployment paths, offline limits

TypeScript (strict) on React 19 / Next.js 16 App Router, NextAuth v5 with JWT sessions, Supabase Postgres/PostgREST/Storage/Realtime, zod 4, `@pkmn/*`, `@smogon/calc`, AI SDKs, `sharp`/`canvas`; Node 22; npm. Deployment modes selected in source: Vercel production/preview (`VERCEL=1` selects the Postgres limiter, `vercel.json` declares crons); self-hosted `next build`/`next start` (in-memory limiter, no scheduler); local Supabase-in-Docker development.

Offline: `vitest` runs hermetically with dummy Supabase env and mocked query modules; `tsc --noEmit` and ESLint are read-only. Blocked: `npm ci`, `next build`/`dev` (the prebuild hook fetches private assets over the network and writes into `src/` and `public/`), `GAUNTLET_TESTS`, any Supabase CLI or Docker stack, and every upload/capture script.

This host enforces no OS sandbox (Windows: no network namespace, read-only mounts, or cgroup limits) and this session exposes no shell. Target-controlled execution is unavailable for the entire run, so every runtime, RLS/grant, Realtime, GoTrue, proxy, and scheduler question is `needs_validation`, never `confirmed`.

## 4. Entry surfaces and important source-to-sink paths

242 route handlers under `src/app/api/**/route.ts` and 120 pages. There is no `middleware.ts`: authorization is per route and per server component. Notable surfaces: roughly 60 public handlers; the machine routes (`/api/cron/*`, `/api/bootstrap`, `/api/seed-rulesets`); the capability-token route `/api/teams/shared/[token]`; multipart XLSX imports; base64 image inputs; the AI agent chat and its tool loop; the server-side internal call from `parse-replay`/`manual-result` into `/api/ai/match-analysis` carrying the caller's own cookie; and outbound fetches (proxy-image, replay, pokepast, Replicate output, Discord webhook, Smogon, storage re-upload).

Decisive sink properties: the only database client is service-role and bypasses RLS (`src/lib/supabase/client.ts`), so PostgREST filter construction and per-route authorization are the real controls; the revocation migration leaves `anon`/`authenticated` with no table privileges, so RLS policies are inert; and several writes terminate in SQL RPCs whose argument validation lives in `supabase/migrations/**`.

## 5. Trust boundaries and strongest source-visible control on each

- Route → data: live per-call re-read of `status`, `is_admin`, `is_creator`, and `resource_admins(count)` (`src/lib/auth/helpers.ts`). The strongest control in the app; revocation is immediate and JWT copies are display-only by design.
- Route → public: allowlist mappers (`toPublicPlayer`, `filterTeamForShare`, `toPublicProfileView`, `toPublicPicks`) plus `safeErrorResponse`.
- Browser → route: NextAuth JWT cookie. No global gate and no visible per-route anti-CSRF token.
- Server → internet: per-sink allowlists (proxy-image host/path, avatar output host, Discord webhook regex, social image own-origin).
- Upload → parser: extension/MIME/magic-byte/8 MB gate in `src/lib/import/xlsx-upload.ts`, then a hand-rolled parser with its own part caps.
- Model → tools: zod at dispatch plus server-forced `ruleset_id` and `player_core`; `playerId` remains caller/tool-supplied.
- Machine → app: timing-safe bearer compares; bootstrap checks "an admin exists" before comparing the secret.
- Service-role key containment rests on `server-only` imports and convention alone.

## 6. Repository-relative starting paths

`src/app/api/**`, `src/auth.ts`, `src/lib/auth/**`, `src/lib/api/**`, `src/lib/supabase/**`, `src/lib/players/**`, `src/lib/team*`, `src/lib/draft/**`, `src/lib/pkmn/**`, `src/lib/import/**`, `src/lib/ai/**`, `src/lib/avatar/**`, `src/lib/social/**`, `src/lib/discord/**`, `src/lib/utils/{crypto,rate-limit,csv}.ts`, `src/lib/validation/schemas.ts`, `next.config.mjs`, `vercel.json`, `supabase/migrations/**`.

## 7. Prior coverage

No compatible prior `coverage-ledger.json` or `findings.json` was supplied for this repository. Every unit is therefore seeded `planned` with `prior_status: "none"`: no carried confirmed records, no same-source exclusions, and no changed-source or blocked revalidation targets. The checkout is a maintainer worktree, not a clean clone — gitignored private-overlay outputs are live under `src/` (`.overlay-manifest.json`, e.g. `src/app/api/legacy-stats/`), alongside `src/format-packs/private/`, `/.internal/`, `/gauntlet/`, `.next/`, and `node_modules/`. The reviewed source ref is tracked files only; overlay-generated and private-pack files are out of scope and must not be reported against the commit.

## 8. Companion selection

Selected: `WEB-PROTOCOL-AND-AUTH.md` (OAuth/link/session/CSRF boundaries on cookie-authenticated routes), `AI-AND-LLM.md` (agent tool loop and context assembly), `DATA-ISOLATION-AND-LIFECYCLE.md` (service-role data access, export/import, public-read caches, share capabilities), `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md` (XLSX and image parsing, paid AI/avatar spend), `CLOUD-AND-DEPLOYMENT.md` (SSRF toward metadata/internal services, deployment-selected limiter and scheduler paths). Excluded with reasons: `CLIENT-SIDE.md` (no dynamic HTML sink found; the three `dangerouslySetInnerHTML` uses are static constants and browser storage is not authoritative), `SUPPLY-CHAIN-AND-RELEASE.md` (dependencies are lockfile-pinned, and `npm ci`/`audit` are prohibited offline; no update or publish path is reachable from untrusted input), `PROTOCOLS-RPC-AND-MESSAGING.md` (no non-HTTP protocol; Realtime is browser-only and its authorization is deployment state), `DESKTOP-MOBILE-AND-LOCAL-IPC.md` (no IPC, deep-link, or native surface), `MEMORY-SAFETY-AND-BINARY.md` (no native or unsafe code on any request path).