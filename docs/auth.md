# Auth Module

## Overview
The Auth module handles authentication and authorization with NextAuth v5 and shared helper guards for API routes.

## File Structure
```
src/
├── auth.ts  # NextAuth config and exported handlers/auth/signIn/signOut
└── lib/auth/
    └── helpers.ts  # Session + role/resource guard helpers
```

## Core Functions/Classes

### NextAuth Config
- **File**: `src/auth.ts`
- **Purpose**: Central NextAuth v5 setup
- **Key Methods**: `handlers`, `auth`, `signIn`, `signOut`

### Session Helpers
- **File**: `helpers.ts`
- **Purpose**: Session access for server code
- **Key Methods**: `getSession()`, `getSessionPlayer()`

### Guard Helpers
- **File**: `helpers.ts`
- **Purpose**: Route authorization gates
- **Key Methods**: `requireAuth()`, `requirePlayer()`, `requireAdmin()`, `requireAnyAdmin()`, `requireResourceAdmin()`, `requireDraftAdmin()`, `requireCreator()`

### Session lifetime and revocation
- **Files**: `src/auth.ts`, `src/lib/auth/session-epoch.ts`, `src/lib/supabase/queries/players.ts`
- **Lifetime**: the session is a JWT cookie with a 14-day `maxAge` (`SESSION_MAX_AGE_SECONDS`). The cookie slides forward on every `/api/auth/session` request, so 14 days is the idle limit.
- **Epoch**: `players.sessions_valid_after` (`timestamptz NOT NULL DEFAULT '-infinity'`) is the account-level session epoch. A token carries `authAt`, the epoch ms of the sign-in that minted it, stamped at sign-in only. A refresh or `update({})` never advances it, and `token.iat` is never used (it moves on every re-encode). A token is revoked when `authAt < sessions_valid_after`; equal is valid. A token without `authAt` (minted before the stamp existed) is valid while the epoch is `-infinity` and revoked by the first bump.
- **Who moves it** (`revokePlayerSessions`, `revokeSessionsOfAuthUser`; written with the application clock, only forward): a password reset (`POST /api/auth/reset-password`, which also ends the account's Discord sessions; the epoch is written and verified BEFORE the password changes, a failed write aborts the reset, and it is written again after the change, so an old-password sign-in that finished in between is revoked too: a credentials token's `authAt` is the time its attempt STARTED, `User.authStartedAt`), banning or suspending a player, claiming a guest account (the route writes an application-clock cutoff on the guest row first and aborts if that fails; the trigger `players_session_epoch_guard` then adds the database clock inside the claim's own transaction when `is_guest` goes true to false, and the epoch keeps the later), and "Sign out everywhere" (`POST /api/account/sessions/revoke`, audited as `player.sessions_revoke`, button in the account security section). Reinstating a player does not move it, so an old token stays dead. The same trigger keeps the epoch monotonic for every writer (`GREATEST` of the old and the written value), so an instance with a slow clock cannot lower it.
- **Where it is enforced**: the `jwt` callback reads the epoch on every refresh and returns `null` for a revoked token, which ends the session (Auth.js clears the cookie, `auth()` answers null). Every guard reads it live through `loadSessionPlayer(provider, id, { authAt })`; a revoked token answers **401 `unauthenticated`**, never 403, and `getLiveAccess()` / `getLiveSessionPlayer()` treat it as signed out. `session.authAt` carries the sign-in time to the guards; the epoch itself never reaches the token or the session.
- **Deploy order**: the migrations (`20261102110000_players_sessions_valid_after.sql`, then `20261102111000_players_session_epoch_guard.sql`) are applied before the code that selects the column.

## Data Flows
- **Input**: Request cookies/session tokens
- **Processing**:
  1. Resolve session via `auth()`
  2. Attach `session.player` metadata
  3. Apply role/resource checks in guards
- **Output**: Session/player context or `AuthError`

## Dependencies
- **External Libraries**: `next-auth`
- **Internal Modules**:
  - [Supabase Module](./supabase.md) - player/resource-admin lookups

## API Routes
- `/api/auth/[...nextauth]`

## Usage Examples

```typescript
import { requireAdmin } from '@/lib/auth/helpers';

export async function GET() {
  await requireAdmin();
  return Response.json({ success: true });
}
```

## Testing
- **Test Files**: No dedicated auth unit test file currently
- **Testing Approach**: Integration tests through guarded API routes

## Related Modules
- [Supabase Module](./supabase.md)
