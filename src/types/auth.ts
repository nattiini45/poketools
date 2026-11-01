import type { DefaultSession } from 'next-auth';

/**
 * How the user signed in. 'discord' = Discord OAuth (session.user.id is the
 * Discord snowflake); 'credentials' = Supabase Auth email/password
 * (session.user.id is the Supabase auth user UUID). Pre-existing JWTs minted
 * before this field existed are treated as 'discord'.
 */
export type AuthProvider = 'discord' | 'credentials';

declare module 'next-auth' {
  interface User {
    /**
     * Credentials sign-ins only: epoch ms taken BEFORE the password was checked. It becomes the token's `authAt`,
     * so an old-password sign-in that was already in flight when a reset revoked the account cannot be stamped
     * after that revocation.
     */
    authStartedAt?: number;
  }

  interface Session {
    user: DefaultSession['user'] & {
      id: string; // Discord snowflake or Supabase auth user UUID (see provider)
    };
    player: SessionPlayer | null;
    /**
     * Always set by the session callback; optional so existing fixtures and
     * legacy sessions type-check. Absent = 'discord'.
     */
    provider?: AuthProvider;
    /**
     * Credentials sessions only: the sign-in email is `SUPERADMIN_EMAIL` and
     * the player carries `SUPERADMIN_DISCORD_ID` (see `src/lib/auth/superadmin.ts`).
     * A derived boolean, never the Discord id. The guards recompute it live.
     */
    superadminLinked?: boolean;
    /**
     * Epoch ms of the sign-in that minted this session, set only at sign-in.
     * The live guards compare it with `players.sessions_valid_after`
     * (`src/lib/auth/session-epoch.ts`); absent on a session minted before the
     * stamp existed.
     */
    authAt?: number;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id?: string; // Discord snowflake or Supabase auth user UUID (see provider)
    provider?: AuthProvider;
    player?: SessionPlayer | null;
    /** Derived superadmin-link boolean for credentials tokens (see `Session.superadminLinked`). */
    superadminLinked?: boolean;
    /** Epoch ms of the sign-in (see `Session.authAt`). Never refreshed; not `iat`, which moves on every re-encode. */
    authAt?: number;
  }
}

export interface SessionPlayer {
  playerId: string; // Supabase UUID
  name: string;
  isAdmin: boolean;
  isResourceAdmin: boolean; // true if player has any resource_admins assignments
  isCreator: boolean;
  psUsername: string;
  championsUsername: string;
  avatarUrl: string | null;
  status: 'active' | 'suspended' | 'banned';
}
