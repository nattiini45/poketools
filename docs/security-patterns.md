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

### A02 — Cryptographic Failures

- All secrets live in environment variables (`.env.local`). Template: `.env.example`.
- Social integration credentials encrypted with `encryptJson()` / `decryptJson()` from `src/lib/social/encryption.ts`.
- Never log secrets, tokens, or API keys — even in `console.error`.

### A03 — Injection

- **SQL:** All queries use Supabase SDK parameterized methods (`.eq()`, `.in()`, `.ilike()`). Never build raw SQL strings. If raw SQL is needed for migrations, it goes in `supabase/migrations/`.
- **XSS:** React 19 auto-escapes JSX interpolations. Never use `dangerouslySetInnerHTML` with user-controlled content. The single existing usage (`OverlayShell.tsx`) injects static keyframe CSS defined in `src/lib/broadcast/animations.ts`.
- **Command injection:** Never use `eval()`, `Function()`, `child_process.exec()`, or dynamic code execution.

### A04 — Insecure Design

- Rate limits on expensive operations: `src/lib/avatar/rate-limit.ts` (avatar generation), `src/lib/ai/rate-limit.ts` (AI analysis). Both use atomic Supabase RPC with `FOR UPDATE` locks.
- Match state transitions enforce a legal state graph — no arbitrary status overwrites.
- Bootstrap route uses constant-time delay to prevent timing attacks.

### A05 — Security Misconfiguration

- `next.config.mjs` sets security headers: HSTS (2yr + preload), X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Permissions-Policy (camera/mic/geo disabled), CSP, COOP: same-origin.
- `poweredByHeader: false` — no X-Powered-By header exposed.
- API routes get `X-Robots-Tag: noindex, nofollow`.
- Image sources allowlisted via `images.remotePatterns`.
- **API roles hold no privileges in `public`.** The anon key ships in the browser bundle, so anything `anon` or `authenticated` can read through PostgREST (`/rest/v1/*`) or pg_graphql is public, whatever the app renders. Anyone can sign up, so `authenticated` is no more trusted than `anon`. An RLS policy filters rows, not columns: `USING (true)` exposes every column the role is granted. Neither role holds any privilege on a table, sequence or function in `public`, and postgres's default privileges give new objects nothing for them either (`supabase/migrations/20261008081443_close_public_api_roles.sql`; `public.matches` first in `20261008081402_revoke_anon_private_match_columns.sql`; both applied to live 2026-10-08). The exception is an object created outside a migration as `supabase_admin` (the dashboard): that role's default privileges still grant both API roles and postgres cannot change them, so check V7 and V10 after creating one and revoke in a migration. A new migration never grants to `anon`, `authenticated` or `PUBLIC`, and enables RLS on every table it creates; the service-role client is the only reader. To hide some columns but keep others readable, revoke the table privilege and grant a column list: revoking single columns under a table-level grant does nothing. A dump restore does not carry the revokes, so re-run both files after it. The Security Advisor does not catch this (lint 0024 skips `SELECT` policies); verify with `has_column_privilege` and the default-privilege query (`docs/security/anon-match-columns.md`, V1 and V7). `src/lib/supabase/__tests__/migration-api-grants.test.ts` replays the migrations in CI; `src/lib/supabase/__tests__/api-role-grants.local.test.ts` (opt-in, local stack) probes REST as both roles.

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

## Related

- [`AGENTS.md`](../AGENTS.md) — always-needed security subset and never-do list.
- [`openwiki/operations/security.md`](../openwiki/operations/security.md) — navigable wiki summary of this page.
- CI guard: `ENFORCE=1 node scripts/check-safe-error-response.mjs` (logic: `scripts/safe-error-scan.mjs`).
