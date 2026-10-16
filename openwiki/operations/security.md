# Security

> OWASP-mapped security rules, auth hierarchy, error handling, and input validation patterns.

All security rules are defined in `AGENTS.md` (always-needed subset) and `docs/security-patterns.md` (full OWASP and error/validation patterns). This page provides a navigable summary.

## OWASP Top 10 (2021) Mapping

### A01 — Broken Access Control

- Every protected API route MUST call `requireAuth()`, `requireAdmin()`, `requireCreator()`, or `requireResourceAdmin()` as its first operation.
- Resource ownership checks happen in the API route, never in client components.
- Auth helper hierarchy: `requireAuth()` → `requirePlayer()` → `requireAdmin()` / `requireCreator()` / `requireResourceAdmin(type, id)`.
- Public routes documented with `// Public: no auth required`.

### A02 — Cryptographic Failures

- All secrets in environment variables (`.env.local`). Template: `.env.example`.
- Social credentials encrypted with `encryptJson()` / `decryptJson()` from `src/lib/social/encryption.ts`.
- Never log secrets, tokens, or API keys.

### A03 — Injection

- **SQL:** All queries use Supabase SDK parameterized methods. Never build raw SQL strings.
- **XSS:** React 19 auto-escapes JSX. Never use `dangerouslySetInnerHTML` with user-controlled content. Single existing usage (`OverlayShell.tsx`) injects static keyframe CSS from `src/lib/broadcast/animations.ts`.
- **Command injection:** Never use `eval()`, `Function()`, `child_process.exec()`, or dynamic code execution.

### A04 — Insecure Design

- Rate limits: `src/lib/avatar/rate-limit.ts` (avatar generation), `src/lib/ai/rate-limit.ts` (AI analysis). Both use atomic Supabase RPC with `FOR UPDATE` locks.
- Match state transitions enforce a legal state graph — no arbitrary status overwrites.
- Bootstrap route uses constant-time delay to prevent timing attacks.

### A05 — Security Misconfiguration

`next.config.mjs` sets comprehensive security headers:
- HSTS (2 years + preload)
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Permissions-Policy (camera/mic/geo disabled)
- Content-Security-Policy (strict — allowlisted image sources, Supabase connect)
- Cross-Origin-Opener-Policy: same-origin
- `poweredByHeader: false`
- API routes get `X-Robots-Tag: noindex, nofollow`

### A06 — Vulnerable Components

- Pin major versions in `package.json`. Check changelogs before updating `next-auth` (v5 beta).
- `npm audit` runs in CI — critical/high findings are blocking.

### A07 — Auth Bypass

- Session management: NextAuth v5 with JWT strategy.
- Two providers: Discord OAuth (`checks: ['state']`) and Credentials (Supabase Auth email/password).
- Superadmin auto-promoted on every request.
- No direct session manipulation.

### A10 — Logging & Monitoring

- `safeErrorResponse()` logs real errors server-side, returns safe fallback.
- Never expose stack traces, SQL errors, or internal paths.
- Every error branch that returns without `safeErrorResponse()` must `console.error` first.
- Distinct failure causes must stay distinguishable.
- AI endpoints log token usage via Braintrust (optional).

## Error Handling Pattern (Mandatory)

```typescript
import { safeErrorResponse } from '@/lib/api/error-response';

export async function POST(request: Request) {
  try {
    const player = await requirePlayer();
    // business logic
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create resource');
  }
}
```

### `safeErrorResponse` behavior
1. `UserFacingError` subclasses → passes through (specific message + optional `code` + status), logged server-side
2. `AuthError` → passes through (user-facing by design, not logged)
3. Everything else → `console.error` + static fallback string

### Error transparency rules
- **No generalization** — never collapse distinct failure causes into one generic message
- **No suppression** — empty catch blocks and log-less error returns are bugs
- **No masking** — domain errors whose messages are user-facing keep their messages end-to-end
- Use `UserFacingError` (`src/lib/api/user-facing-error.ts`) for new user-facing error types

### CI enforcement
`ENFORCE=1 node scripts/check-safe-error-response.mjs` fails the build on any raw `NextResponse` return inside a catch block that doesn't `console.error` first. Escape hatch: `// safe-error-response-allow: <reason>`.

## Input Validation

Manual and domain-specific. No centralized schema library.

### Patterns
1. **Whitelist enums** — `VALID_*` constants with `.includes()`
2. **Length/bounds** — string length and numeric range checks
3. **Type guards** — `parseCreateBody()` style helpers for complex payloads
4. **URL validation** — regex patterns for external URLs
5. **File uploads** — `validateUpload()` for MIME type and size
6. **Zod** — Used by AI agent tool schemas (`src/lib/ai/agent/tools/schemas.ts`) and some validation modules (`src/lib/validation/schemas.ts`)

## Review Checklist

Before approving code:

**Auth & Access Control:**
- [ ] Auth guard on all protected routes
- [ ] Resource ownership verified in route handler
- [ ] Visibility logic in API routes, not components
- [ ] Public routes documented

**Data & Queries:**
- [ ] Supabase queries use server-side client
- [ ] No service role key exposed to client
- [ ] No RLS policies created
- [ ] No raw SQL concatenation
- [ ] Aggregate updates triggered on stats writes

**Validation & Errors:**
- [ ] All catch blocks use `safeErrorResponse()`
- [ ] Request body validated
- [ ] No internals leaked in responses
- [ ] No error generalization/suppression/masking

**Code Quality:**
- [ ] No `any` types
- [ ] No hardcoded dex data
- [ ] Typed API responses
- [ ] No `eval()`, `Function()`, or dynamic code execution
- [ ] No `dangerouslySetInnerHTML` with user content
