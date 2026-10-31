# Security Patterns (OWASP)

> Full OWASP-mapped security rules, the mandatory error-handling pattern, and the input-validation pattern for this repository.

The always-needed subset (auth guards, `safeErrorResponse()`, error transparency, ownership checks) lives in [`AGENTS.md`](../AGENTS.md#security-requirements); this doc holds the complete patterns an agent needs when writing or reviewing API routes, auth, or validation code. Load it when a task touches `src/app/api/**`, auth helpers, or request-body handling.

## OWASP Top 10 (2021) Mapping

Every agent writing code in this repo must follow these patterns. They map to the [OWASP Top 10 (2021)](https://owasp.org/Top10/) categories.

### A01 — Broken Access Control

- Every protected API route MUST call `requireAuth()`, `requireAdmin()`, `requireCreator()`, or `requireResourceAdmin()` from `src/lib/auth/helpers.ts` as its first operation.
- Resource ownership checks (e.g., `team.player_id !== player.playerId`) must happen in the API route, never in client components.
- Auth helper hierarchy: `requireAuth()` → `requirePlayer()` → `requireAdmin()` / `requireCreator()` / `requireResourceAdmin(type, id)` / `requireDraftAdmin(poolId)`.
- Public routes (dex search, calc, usage stats, broadcast overlays, wiki pages) are intentionally unguarded — document with a comment: `// Public: no auth required`.
- `requireSuperadmin()` is for the few actions a site admin must not take (restoring a league from the trash, the pending-rebuild run). It checks the superadmin identity of the session (provider and user id) and reads the player row live, in good standing. Pages use `SuperadminGuard`, which reads `getLiveAccess().isSuperadmin`; the league trash page reads no trash data before the viewer is known to be the superadmin.
- Stored studio definitions (formats, rulesets) are guarded by the live definition row, never the token: `requireRulesetViewer` / `requireRulesetOwner` re-read the player and the definition's metadata (never its draft body), and a malformed or unknown id is a 404 for site admins too. Access rules are pure (`src/lib/studio-core/access.ts`) and tested as an actor-by-definition matrix.
- **A version id is a capability to read that version.** The public ruleset routes serve a version of a *private* ruleset only while a league or phase pins it (a league's page shows its rules to everyone); a guessed or leaked id of an unpinned private version answers 404 (`src/lib/ruleset-studio/exposure.ts`). Usage names (which leagues pin a shared ruleset) are shown only to site admins and the admins of a league-owned ruleset; everyone else gets counts.
- **Owner-rights database functions.** Everything in `public` is `service_role` only. Two league-trash helpers run with the owner's rights (`SECURITY DEFINER`, an empty `search_path`, `EXECUTE` granted to `service_role` only), each for one reason `service_role` cannot do itself: `league_trash_schema_version()` (the highest applied migration, which lives in `supabase_migrations`) and `league_trash__insert_archive_rows(trash_id, step)` (the INSERT of the read-only archive `redraft_trade_requests`, whose INSERT was revoked from `service_role` on purpose; it takes no rows and no SQL from the caller: the rows come from the trash entry and the filter from the restore plan step, and only a step of a table in `league_trash__archive_tables()` is accepted). A new owner-rights function needs the same justification, an empty `search_path` and a test in `src/lib/supabase/__tests__/migration-api-grants.test.ts`.
- **Junction tables make hard deletes fail on purpose.** While a league is in the trash, the foreign keys of `league_trash_players`, `league_trash_rulesets` and `league_trash_point_buy_versions` (`ON DELETE RESTRICT`) make the database refuse a delete of a player, ruleset version or list version the league references (23503). Routes that delete one of these map it with `leagueTrashBlockOf` to a precise message instead of a generic failure.

### A02 — Cryptographic Failures

- All secrets live in environment variables (`.env.local`). Template: `.env.example`.
- Social integration credentials encrypted with `encryptJson()` / `decryptJson()` from `src/lib/social/encryption.ts`.
- Never log secrets, tokens, or API keys — even in `console.error`.

### A03 — Injection

- **SQL:** All queries use Supabase SDK parameterized methods (`.eq()`, `.in()`, `.ilike()`). Never build raw SQL strings. If raw SQL is needed for migrations, it goes in `supabase/migrations/`.
- **PostgREST logic trees:** `.or()` / `.not()` / `.and()` strings are NOT parameterized: postgrest-js sends them as-is and PostgREST parses `,` `(` `)` `.` in them, so an unquoted user value can add conditions (run by the service-role client). Build them with `src/lib/supabase/postgrest-filter.ts` (`ilikeAnyOf`, `postgrestQuoted`, `escapeLikeTerm`), and pass ids only after `assertValidUuid`. A user LIKE pattern also escapes `%`/`_`/`\` (`escapeLikeTerm`); `*` stays a PostgREST wildcard alias in `like`/`ilike` values.
- **XSS:** React 19 auto-escapes JSX interpolations. Never use `dangerouslySetInnerHTML` with user-controlled content. The single existing usage (`OverlayShell.tsx`) injects static keyframe CSS defined in `src/lib/broadcast/animations.ts`.
- **Command injection:** Never use `eval()`, `Function()`, `child_process.exec()`, or dynamic code execution.

### A04 — Insecure Design

- Rate limits on expensive operations: `src/lib/avatar/rate-limit.ts` (avatar generation), `src/lib/ai/rate-limit.ts` (AI analysis). Both use atomic Supabase RPC with `FOR UPDATE` locks.
- Request rate limits: `src/lib/utils/rate-limit.ts` (`checkRateLimit(bucket, identity, { limit, windowSeconds, failMode })`), one atomic `rate_limit_hit` RPC per check (fixed window in `rate_limit_buckets`, durable across instances and cold starts; identities are stored only as unsalted SHA-256 prefixes, which keeps them out of plain sight but is reversible by brute force for IPv4 addresses, so treat `rate_limit_buckets` (service_role only) as personal data like request logs; `anon` and `authenticated` hold nothing on it, while `service_role` also holds REFERENCES, TRIGGER and TRUNCATE from Supabase's default privileges, which is expected for the server role). The store comes from `RATE_LIMIT_STORE` (validated in `src/lib/env.ts`, documented in `.env.example`): `postgres` uses the RPC; `memory` uses a bounded in-process counter and makes no RPC. Unset means `postgres` only on a Vercel deployment (`VERCEL=1`) and `memory` everywhere else (`next dev`, a local `next start`, the capture harness), so local runs and automation never spend the hosted Supabase quota; NODE_ENV does not decide it. An invalid value never falls back: it stops the server at boot (`src/instrumentation.ts` runs `assertBootEnv()` from `src/lib/env.ts`, which validates `bootEnvSchemas` and throws one `MissingEnvError` naming the key, never the value), so a misconfigured deployment fails once and loudly instead of answering every limited route (signup, forgot-password, password sign-in, calc, proxy-image …) with a 500; the per-call read in `rateLimitStore()` still throws `MissingEnvError` as the backstop. The RPC is raced against a 1.5 s timeout; a timeout counts as a limiter failure. Signed-in routes key on the player id; public routes (for example `/api/proxy-image` 60/min, `/api/replay-frames` 30/min, and the anonymous share-link read `GET /api/teams/shared/[token]` 60/min, checked before the token is validated so well-formed guesses cannot spend unbounded Supabase queries) key on the client IP through `checkPublicRateLimit()` (the LAST `X-Forwarded-For` hop, which the client cannot forge, and for IPv6 only its /64 prefix (`rateLimitIpIdentity`), since one host commonly holds a whole /64; a request with no address header is a local run, which the in-memory store lets through instead of throttling the capture harness in one shared bucket, while the Postgres store still counts it in the shared `unknown` bucket with a warning); the auth routes (`src/lib/auth/rate-limits.ts`) key on the client IP (the same /64 rule) and the inbox the address delivers to (`emailIdentity`: lower-cased, a `+tag` suffix dropped (kept when the local part is only the tag), and for Gmail the dots dropped and `googlemail.com` folded in); `POST /api/account/link-email` counts every attempt with a valid address per player (5/hour) and per inbox (3/hour), both fail closed; a request with no client IP header skips the per-IP check when a per-email check applies, instead of sharing one site-wide bucket; password sign-in, reset-password and confirm-email have no per-email check, so such a request shares the one `unknown` IP bucket (deliberate: the production host always sets the header, and skipping would switch the brute-force brake off for exactly the requests of unknown origin). Limiter failures are logged and fail open, except signup, forgot-password and resend-verification, which fail closed with a 503 (`rate_limit_unavailable`) because they send email to arbitrary addresses, and `POST /api/bootstrap` and the bootstrap-secret path of `POST /api/seed-rulesets` (one shared `bootstrap` bucket), which fail closed because an uncapped guess at a one-time admin promotion is worse than the route being briefly unavailable. Never set `RATE_LIMIT_STORE=memory` on a deployment: the counter is per serverless instance and resets on every cold start. Auth limits (`AUTH_RATE_LIMITS`): signup, forgot-password and resend-verification 10/hour per IP and 3/hour per email (fail closed); reset-password and confirm-email 10 per 15 min per IP; password sign-in 30 per 15 min per IP (no per-email bucket, so nobody can lock an account owner out).
- Match state transitions enforce a legal state graph — no arbitrary status overwrites.
- Bootstrap (`POST /api/bootstrap`) promotes the caller's existing player row only while no admin exists, atomically (`bootstrap_first_admin` under an advisory lock); it compares the secret with `secretsEqual` (constant time, length-independent), answers "admin exists" before checking the secret once bootstrap is over, and caps attempts per IP with the request limiter (5 per 15 min, shared with the bootstrap-secret path of `POST /api/seed-rulesets`; the cap fails closed with 503 `rate_limit_unavailable`). A rejected secret is logged as a `console.warn` line that never contains the submitted or the expected value. No fixed delays: they are no brute-force control.

### A05 — Security Misconfiguration

- `next.config.mjs` sets security headers: HSTS (2yr + preload), X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Permissions-Policy (camera/mic/geo disabled), CSP, COOP: same-origin.
- `poweredByHeader: false` — no X-Powered-By header exposed.
- API routes get `X-Robots-Tag: noindex, nofollow`.
- Image sources allowlisted via `images.remotePatterns`.
- **API roles hold no privileges in `public`.** The anon key ships in the browser bundle, so anything `anon` or `authenticated` can read through PostgREST (`/rest/v1/*`) or pg_graphql is public, whatever the app renders. Anyone can sign up, so `authenticated` is no more trusted than `anon`. An RLS policy filters rows, not columns: `USING (true)` exposes every column the role is granted. Neither role holds any privilege on a table, sequence or function in `public`, and postgres's default privileges give new objects nothing for them either (`supabase/migrations/20261008081443_close_public_api_roles.sql`; `public.matches` first in `20261008081402_revoke_anon_private_match_columns.sql`). The exception is an object created outside a migration as `supabase_admin` (the dashboard): that role's default privileges still grant both API roles and postgres cannot change them, so check V7 and V10 after creating one and revoke in a migration. A new migration never grants to `anon`, `authenticated` or `PUBLIC`, and enables RLS on every table it creates; the service-role client is the only reader. To hide some columns but keep others readable, revoke the table privilege and grant a column list: revoking single columns under a table-level grant does nothing. A dump restore does not carry the revokes, so re-run both files after it. The Security Advisor does not catch this (lint 0024 skips `SELECT` policies); verify with `has_column_privilege` and the default-privilege query (`docs/security/anon-match-columns.md`, V1 and V7). `src/lib/supabase/__tests__/migration-api-grants.test.ts` replays the migrations in CI; `src/lib/supabase/__tests__/api-role-grants.local.test.ts` (opt-in, local stack) probes REST as both roles.

### A06 — Vulnerable Components

- Pin major versions in `package.json`. Check changelogs before updating `next-auth` (v5 beta).
- CI runs `npm audit` twice (`.github/workflows/ci.yml`). `npm audit --omit=dev --audit-level=high` blocks on critical/high findings in production dependencies, which is what ships. A second run over all dependencies only reports (`continue-on-error`, since 2026-10-06): dev-tooling findings with no patched release (braces, GHSA-vfj7-8cjw-p6xm) do not block. Fix a dev-only critical/high when a patch exists; never let one reach a production dependency.

### A07 — Auth Bypass

- Session management: NextAuth v5 with JWT strategy. Two providers resolve to the same `players` row: Discord OAuth (`checks: ['state']`) and a Credentials provider backed by Supabase Auth email/password (server-side GoTrue via `src/lib/supabase/auth-client.ts`; no `@supabase/ssr`, no persisted Supabase sessions). See `docs/auth-email-password.md`.
- Superadmin: Discord ID in `SUPERADMIN_DISCORD_ID` (Discord sessions) and optional `SUPERADMIN_EMAIL` (email sessions), auto-promoted on every request.
- No direct session manipulation — always go through NextAuth helpers.

### A10 — Logging & Monitoring

- Use `safeErrorResponse()` for all API route error handling — it logs the real error server-side and returns a safe fallback message.
- Never expose stack traces, SQL errors, or internal paths in API responses.
- Every error branch that returns a response WITHOUT `safeErrorResponse()` must `console.error` the original error first. An early-return error branch that logs nothing makes the failure undiagnosable — that is a bug, not a style choice.
- Distinct failure causes must stay distinguishable — via specific safe messages or per-cause `code` values — in both the response and the server logs.
- AI analysis endpoints log token usage via Braintrust (optional).

## Error Handling Pattern (Mandatory)

Every API route catch block must use `safeErrorResponse()`:

```typescript
import { safeErrorResponse } from '@/lib/api/error-response';

export async function POST(request: Request) {
  try {
    const player = await requirePlayer();
    // ... business logic
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create resource');
  }
}
```

This helper: (1) passes `UserFacingError` subclasses through — specific message + optional `code` + status, logged server-side, (2) passes `AuthError` messages through (they're user-facing by design; not logged), (3) logs everything else server-side with `console.error` and returns the static fallback string to the client.

**Error transparency (mandatory):** generalization, suppression, and masking of errors are forbidden — we need to know what's wrong.

- **No generalization** — never collapse distinct failure causes into one generic message. If four different failures can reach a branch, the client and the server log must both be able to tell which one happened: pass the specific message through when it is safe, or give each cause its own `code`. One shared `code` for all causes disambiguates nothing.
- **No suppression** — never swallow an error. Empty catch blocks, catches that return without logging, and early-return error branches that skip both `safeErrorResponse()` and `console.error` are bugs. A branch that returns its own `NextResponse` instead of calling `safeErrorResponse()` must `console.error(err)` first.
- **No masking** — domain error classes whose messages are constructed to be user-facing (no internals: `AuthError`, and domain errors like the core-assignment errors built from pool/participant counts) keep their specific messages end-to-end. Do not overwrite them with hand-written generic strings in individual routes. The mechanism: extend `UserFacingError` from `src/lib/api/user-facing-error.ts` (carries the safe message + optional `code` + status; `safeErrorResponse()` passes it through and logs it server-side) rather than hand-patching each route. Example: the core-assignment errors in `src/lib/season/core-assignment.ts`.
- The static-fallback rule protects against leaking *internals* (stack traces, SQL errors, unexpected exceptions). It is not a license to hide *domain* errors. When in doubt: log the real error server-side, and return the most specific message that contains no internals.

## Input Validation Pattern

No centralized schema library for most routes — validation is manual and domain-specific (Zod is used in `src/lib/validation/schemas.ts`; see the date-encoding rule in [`src/lib/AGENTS.md`](../src/lib/AGENTS.md)). Follow these patterns:

1. **Whitelist enums** — define `VALID_*` constants, check with `.includes()`:
   ```typescript
   const VALID_CATEGORIES = ['battle', 'draft', 'social'] as const;
   if (!VALID_CATEGORIES.includes(body.category)) {
     return NextResponse.json({ success: false, error: 'Invalid category' }, { status: 400 });
   }
   ```

2. **Length/bounds** — validate string lengths and numeric ranges before processing.

3. **Type guards** — use `parseCreateBody()` style helpers for complex payloads (see `src/app/api/admin/achievements/route.ts` for the pattern).

4. **URL validation** — regex patterns for external URLs (see Discord webhook URL validation in `src/app/api/discord-webhooks/route.ts`).

5. **File uploads** — `validateUpload()` for MIME type and size checks (see `src/app/api/avatar/transform/route.ts`).

6. **UUID path segments** — a dynamic segment that must be a UUID is checked before any query: `const invalid = rejectInvalidPathId(id, 'INVALID_SEASON_ID'); if (invalid) return invalid;` (`src/lib/api/invalid-path-id.ts`). A malformed id names no row, so the answer is **404** with the resource's catalogued `INVALID_<NOUN>_ID` code; without the guard Postgres rejects the non-UUID filter and the route answers 500. Every API route with a UUID path segment carries it, in every handler (GET and the write methods), except the exclusions named in the header of `src/app/api/__tests__/path-id-guards.test.ts`: segments that are not UUIDs (`[name]`, `[species]`, `[pokemon]`, `[token]`, `[...nextauth]`), handlers that read no id (`drafts/[id]/favorites` GET/PUT, and the retired `seasons/[id]/draft-tokens` POST, `seasons/[id]/kill-tokens` GET/POST and `seasons/[id]/redraft` POST, which answer 410 whatever the id), a UUID that arrives as a query parameter (`drafts/route.ts`, guarded in its own test) and any route that header still lists as not yet swept. The shared guard tests pin the `INVALID_*_ID` guards: every guarded public GET is listed in `src/app/api/__tests__/public-path-id-guards.test.ts`, and every guarded handler behind an auth guard in `src/app/api/__tests__/path-id-guards.test.ts`, the league groups (`seasons/[id]/groups/**`) and phase groups (`seasons/[id]/phases/[phaseId]/groups/**`) routes included; a new route adds itself to one of them. Draft routes keep their own convention: their own uuid check, `requireDraftAdmin` or `getQueuePool` answer a malformed pool id with `POOL_NOT_FOUND` (404) before any query, and every such handler is pinned in the shared test (`drafts/[id]` GET/PATCH/DELETE, `state`, `my-turn`, `audit`, `config`, `end`, `extensions`, `free-order`, `pause`, `start`, `picks` GET/POST, `redraft`, `redraft/publish`, `redraft/submission` GET/PUT, `redraft/submissions`, `undo`, `replay-events` POST; the public `replay-events` GET is in the public guard test). A draft route's other segments (`pickId`, `playerId`, `redraftSlotId`) use the `INVALID_*_ID` guard and are in the shared test. The guard runs after the identity guard (`requirePlayer` / `requireAdmin` …), before any query and, where the handler allows it, before the body is parsed; every draft route does (a malformed pool id with a malformed body answers 404). `requireResourceAdmin(type, id)` refuses a malformed season or tournament id itself with the same 404 (`INVALID_SEASON_ID` / `INVALID_TOURNAMENT_ID`, site admins included). A UUID **query** parameter that is malformed is a 400 `INVALID_PARAM` with `params.name`, with one exception: `GET /api/drafts?season_id=` treats the season id like a path segment and answers 404 `INVALID_SEASON_ID` before the identity guard (the answer is the same for everyone, so it reveals nothing; pinned in `path-id-guards.test.ts`).

## Related

- [`AGENTS.md`](../AGENTS.md) — always-needed security subset and never-do list.
- [`openwiki/operations/security.md`](../openwiki/operations/security.md) — navigable wiki summary of this page.
- CI guard: `ENFORCE=1 node scripts/check-safe-error-response.mjs` (logic: `scripts/safe-error-scan.mjs`).
