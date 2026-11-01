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

## Discord is optional

The Discord provider is registered only when `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are both set
(`discordOAuthEnabled()` in [src/lib/env.ts](../src/lib/env.ts)). With neither set, the app runs on email/password
alone: `/auth/signin` renders no Discord button, Settings offers no "Link Discord" action and
`POST /api/account/link-discord` answers 409 `discord_not_configured`. Exactly one of the two is a configuration
error and the server names the missing key at startup. The `discord` provider is decided on the server; the client id
is never sent to the browser.

For local development, `npm run dev:seed` creates a confirmed admin
(`local-admin@poketools.test`) so no Discord application is needed ([CONTRIBUTING.md](../CONTRIBUTING.md#local-development-without-discord)).
The local stack (`supabase/config.toml`) mirrors the hosted settings: confirmation required, site URL
`http://localhost:3000`, redirect allowlist `http://localhost:3000/**`. Confirmation mails land in Mailpit
(`http://127.0.0.1:54324`). A running stack picks the file up on `npx supabase stop && npx supabase start`.

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
| Login | `/auth/signin` (email form; Discord button when Discord is configured) | NextAuth Credentials provider |
| Forgot/reset password | `/auth/forgot-password`, `/auth/reset-password` | `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` (`verifyOtp type: 'recovery'` + admin `updateUserById`) |
| Link email to Discord account | Dashboard → Settings → Login methods | `POST /api/account/link-email` |
| Link Discord to email account | Dashboard → Settings → Login methods | `POST /api/account/link-discord` (signed intent cookie) → Discord OAuth → `signIn` callback in [src/auth.ts](../src/auth.ts) |

## Invariants

- `players` CHECK constraint: at least one of `discord_id` / `auth_user_id`
  is set; both are UNIQUE (migration `20260611120000_email_password_auth.sql`).
- Signup/resend/forgot responses are enumeration-safe (generic success even
  for already-registered/unknown emails). The authenticated link-email route
  may return explicit duplicate errors (`email_already_registered`; the
  dashboard's login-methods section offers a resend link for it): every
  attempt counts against 5 per hour per player before the body is read, and
  every attempt with a valid address against 3 per hour per inbox, so it
  cannot be used to test addresses in bulk.
- The sign-in page's `callbackUrl` is only ever a path on this site
  (`sanitizeCallbackUrl` in `src/lib/auth/safe-callback-url.ts`): `//host`,
  `/\host`, whitespace, control characters and schemes fall back to `/`.
- `auth_user_id` is redacted from public DTOs alongside `discord_id`
  (`PublicPlayer`, participant endpoints, broadcast standings).
- Deleting a player cascades to `auth.users` via `admin.deleteUser`
  (no DB-level FK — an `ON DELETE SET NULL` could violate the CHECK).
- GoTrue is directly reachable: the anon key is public, so anyone can call
  `/auth/v1/signup` and `/auth/v1/token` on the project and create an auth
  user for any address, including `SUPERADMIN_EMAIL`, without going through
  `POST /api/auth/signup`. The application must therefore never treat an
  email as an identity on its own.
- Superadmin: `SUPERADMIN_DISCORD_ID` matches Discord sessions only. An email
  session is the superadmin only when BOTH hold: its sign-in email is the
  optional `SUPERADMIN_EMAIL` (trimmed and lowercased on both sides,
  `isReservedSuperadminEmail` in `src/lib/auth/superadmin.ts`) AND the
  `players` row it resolves to carries `discord_id === SUPERADMIN_DISCORD_ID`
  (`resolveCredentialsSuperadminLink`, a separate narrow read; the id never
  enters the token or the session, only the derived `superadminLinked`
  boolean). The link is re-read on every token refresh and on every guarded
  call (`requireAuth`, `requireSuperadmin`, `getLiveAccess`). With
  `SUPERADMIN_DISCORD_ID` unset, an email superadmin is impossible. A player
  row created by the very sign-in is never the superadmin. The account is
  linked to Discord only by the operator signing in with Discord and linking
  the address (see below), so an attacker's own GoTrue user on the reserved
  address, whose player row has no such `discord_id`, gets a plain player
  session.
- GoTrue `display_name` metadata is attacker-controlled too (user metadata
  is set at signup): `authorizeCredentials` re-runs it through the name rules
  (control characters stripped, whitespace collapsed, `FIELD_LIMITS.NAME`
  code points) before it becomes a player name.
- `SUPERADMIN_EMAIL` can be linked only from the `SUPERADMIN_DISCORD_ID`
  account: `POST /api/account/link-email` refuses it for any other player (or
  for everyone when `SUPERADMIN_DISCORD_ID` is unset) with the same generic
  `email_login_create_failed` 400 a GoTrue client error returns, so the route
  is not an oracle for the reserved address.
- `SUPERADMIN_EMAIL` cannot be signed up: `POST /api/auth/signup` never calls
  GoTrue `signUp` for it and answers with the same generic success as any
  signup, after the same rate limit and the same constant delay (no
  enumeration of the reserved address). The operator creates the
  superadmin's email/password login by signing in with Discord as the
  `SUPERADMIN_DISCORD_ID` account and linking the address there (Dashboard →
  Settings → Login methods, `POST /api/account/link-email`). An auth user
  created on that address before this check (or from the Supabase dashboard)
  is not removed by it: check `auth.users` for the address once after
  deploying.
- The Discord link intent cookie is single-use and binds only a player id
  (HMAC of `playerId.exp`, 10-minute TTL). The `signIn` callback honours it
  only while the player who minted it still has a live session on that
  browser. `auth()` alone is not enough: inside the 5-minute refresh TTL it
  answers its cached player, which a password reset or "sign out everywhere"
  does not touch. So the callback re-reads the session identity's player
  (one uncached narrow read) and requires the same `playerId`, a token that
  `sessions_valid_after` has not revoked, and (unless a site admin) a player
  that is not banned or suspended. Otherwise it answers `LinkExpired` and
  links nothing (a failed read answers `Default`). Without that, a revoked
  session could attach an attacker's Discord identity, and the following
  Discord sign-in would mint a fresh `authAt`. Signing out clears a pending
  intent (`events.signOut`). In production the cookie is
  `__Host-poketools_link_discord` (Secure, host-only, path `/`); dev on
  http://localhost uses the unprefixed `poketools_link_discord`.
- Unlink and change-email flows are not implemented (link-only v1).
