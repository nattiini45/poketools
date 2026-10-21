# Email/Password Auth (Supabase Auth + NextAuth)

PokéTools supports two login methods that resolve to the same `players` row:

- **Discord OAuth** (original) — `players.discord_id`
- **Email/password** via Supabase Auth (GoTrue) — `players.auth_user_id`

NextAuth v5 remains the **single session layer**. The Credentials provider
([src/lib/auth/credentials.ts](../src/lib/auth/credentials.ts)) calls
`signInWithPassword` server-side through a stateless anon-key client
([src/lib/supabase/auth-client.ts](../src/lib/supabase/auth-client.ts)); no
Supabase session is ever persisted, and `@supabase/ssr` is not used. Email
round-trips (confirmation, password reset) use the `token_hash` + `verifyOtp`
pattern via customized Supabase email templates.

`session.user.id` is the Discord snowflake for Discord sessions and the
Supabase auth user UUID for email sessions, discriminated by
`session.provider` (`'discord' | 'credentials'`; absent = `'discord'` for
JWTs minted before this feature). All API guards read `session.player`, which
is identical for both providers.

## Required Supabase dashboard configuration (manual, one-time)

Project: your Supabase project (`<project-ref>`)

1. **Authentication → Sign In / Up → Email**: enable the Email provider, and
   turn **Confirm email ON** (login is blocked until the address is
   verified — the app relies on this).
2. **Authentication → URL Configuration**:
   - Site URL: production URL (e.g. `https://<prod-domain>`)
   - Redirect URLs allowlist: `http://localhost:3000/**` and the production
     equivalent.
3. **Authentication → Email Templates** — replace the default
   `{{ .ConfirmationURL }}` links so tokens flow through our pages (the app
   verifies `token_hash` server-side; the default URL flow will not work):
   - **Confirm signup** link:
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   - **Reset password** link:
     `{{ .SiteURL }}/auth/reset-password?token_hash={{ .TokenHash }}&type=recovery`
4. **Password policy**: minimum length 8 (mirrored in `passwordSchema`).
5. **SMTP**: the built-in Supabase sender is limited to ~2–4 emails/hour —
   configure custom SMTP (Authentication → Emails → SMTP settings) before any
   real rollout. The app's own abuse brake is `AUTH_RATE_LIMITS`
   (`src/lib/auth/rate-limits.ts`): per client IP and per normalized email;
   signup, resend-verification and forgot-password fail closed (503
   `rate_limit_unavailable`) when the limiter is down. Supabase's own limits
   see the app's egress address, not the client, so they are no per-client
   control. Details: [Security patterns, A04](./security-patterns.md).

## Flows

| Flow | Pages | API |
|---|---|---|
| Signup | `/auth/signup` → `/auth/verify-email` | `POST /api/auth/signup` (player row is created on first login, not at signup) |
| Confirm email | `/auth/confirm` (button-gated so mail scanners can't burn the token) | `POST /api/auth/confirm-email` (`verifyOtp type: 'email'`) |
| Login | `/auth/signin` (Discord button + email form) | NextAuth Credentials provider |
| Forgot/reset password | `/auth/forgot-password`, `/auth/reset-password` | `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` (`verifyOtp type: 'recovery'` + admin `updateUserById`) |
| Link email to Discord account | Dashboard → Settings → Login methods | `POST /api/account/link-email` |
| Link Discord to email account | Dashboard → Settings → Login methods | `POST /api/account/link-discord` (signed intent cookie) → Discord OAuth → `signIn` callback in [src/auth.ts](../src/auth.ts) |

## Invariants

- `players` CHECK constraint: at least one of `discord_id` / `auth_user_id`
  is set; both are UNIQUE (migration `20260611120000_email_password_auth.sql`).
- Signup/resend/forgot responses are enumeration-safe (generic success even
  for already-registered/unknown emails). The authenticated link-email route
  may return explicit duplicate errors.
- `auth_user_id` is redacted from public DTOs alongside `discord_id`
  (`PublicPlayer`, participant endpoints, broadcast standings).
- Deleting a player cascades to `auth.users` via `admin.deleteUser`
  (no DB-level FK — an `ON DELETE SET NULL` could violate the CHECK).
- Superadmin: `SUPERADMIN_DISCORD_ID` matches Discord sessions only;
  optional `SUPERADMIN_EMAIL` matches email sessions only.
- Unlink and change-email flows are not implemented (link-only v1).
