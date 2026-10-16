import type { DefaultSession } from 'next-auth';

/**
 * How the user signed in. 'discord' = Discord OAuth (session.user.id is the
 * Discord snowflake); 'credentials' = Supabase Auth email/password
 * (session.user.id is the Supabase auth user UUID). Pre-existing JWTs minted
 * before this field existed are treated as 'discord'.
 */
export type AuthProvider = 'discord' | 'credentials';

declare module 'next-auth' {
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
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id?: string; // Discord snowflake or Supabase auth user UUID (see provider)
    provider?: AuthProvider;
    player?: SessionPlayer | null;
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
