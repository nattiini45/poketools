import NextAuth from 'next-auth';
import Discord from 'next-auth/providers/discord';
import Credentials from 'next-auth/providers/credentials';
import { cookies } from 'next/headers';
import { cache } from 'react';
import {
  getPlayerByDiscordId,
  getSessionPlayerRowByIdentity,
  createPlayer,
  updatePlayer,
  linkDiscordToPlayer,
  toSessionPlayer,
} from '@/lib/supabase/queries/players';
import type { SessionPlayerRow } from '@/lib/supabase/queries/players';
import { authorizeCredentials } from '@/lib/auth/credentials';
import { verifyLinkToken } from '@/lib/utils/crypto';
import { discordOAuthEnvSchema, readEnv, requireEnv } from '@/lib/env';
import { syncSpriteStyleCookieAtSignIn } from '@/lib/pkmn/sprite-style-signin.server';
import type { AuthProvider, SessionPlayer } from '@/types/auth';
import type { Player } from '@/types/player';

/** Cookie carrying a signed "link Discord to this player" intent (see /api/account/link-discord). */
export const LINK_DISCORD_COOKIE = '__poketools_link_discord';

/**
 * How long the player copy inside the session JWT is trusted before the jwt
 * callback re-reads it (design decision D37). A `trigger === 'update'` call
 * (client `useSession().update()`) re-reads at once.
 *
 * Only read paths use the token copy: layout, pages, `getSession()` and
 * `getSessionPlayer()`, so a name or avatar can be up to this stale there.
 * The guards in `src/lib/auth/helpers.ts` never trust it. They re-read status
 * and roles live on every call.
 *
 * `auth()` called from a server component or route handler does not persist
 * the refreshed token (next-auth drops the Set-Cookie there). Only requests to
 * `/api/auth/session` rewrite the cookie. So `SessionProvider` forces a
 * refresh (`update({})`, a POST with trigger 'update') every 4 minutes from a
 * visible, signed-in tab, one minute inside this TTL, and the token never
 * falls due while the site is in use. Note that a bare `update()` is a GET:
 * it re-reads nothing inside the TTL.
 */
export const SESSION_PLAYER_TTL_MS = 5 * 60 * 1000;

/** Token field holding the epoch ms of the last player read. Never copied to the session. */
const REFRESHED_AT = 'refreshedAt';

/**
 * True when the token's player copy must be re-read: no valid timestamp
 * (legacy token, or a sign-in whose lookup failed), older than the TTL, or
 * implausibly far in the future.
 */
export function isSessionRefreshDue(refreshedAt: unknown, now: number): boolean {
  if (typeof refreshedAt !== 'number' || !Number.isFinite(refreshedAt)) return true;
  const age = now - refreshedAt;
  return age >= SESSION_PLAYER_TTL_MS || age < -SESSION_PLAYER_TTL_MS;
}

/**
 * The one narrow read of the player behind a signed-in identity (explicit
 * columns plus an embedded `resource_admins` count; see
 * `SESSION_PLAYER_COLUMNS`). It is memoised per server render with React
 * `cache()`, so a render that both refreshes the token and runs a guard reads
 * once. Route handlers have no render scope, so there every call reads.
 */
const readSessionPlayerRow = cache(
  (provider: AuthProvider, identityId: string): Promise<SessionPlayerRow | null> =>
    getSessionPlayerRowByIdentity(provider, identityId)
);

/**
 * Live `SessionPlayer` for an identity, or null when no player is linked to
 * it. Returns a fresh object on every call; the DB is read at most once per
 * server render. Errors rethrow (callers decide whether to fail closed).
 * It does not apply the superadmin override; callers do that.
 */
export async function loadSessionPlayer(
  provider: AuthProvider,
  identityId: string
): Promise<SessionPlayer | null> {
  const row = await readSessionPlayerRow(provider, identityId);
  return row ? toSessionPlayer(row) : null;
}

interface AuthIdentity {
  provider: AuthProvider;
  /** Discord snowflake or Supabase auth user UUID */
  id: string;
  /** Verified email (credentials provider only) */
  email?: string | null;
}

function isSuperadminIdentity(identity: AuthIdentity): boolean {
  if (identity.provider === 'credentials') {
    const superadminEmail = process.env.SUPERADMIN_EMAIL;
    return (
      !!superadminEmail &&
      !!identity.email &&
      identity.email.toLowerCase() === superadminEmail.toLowerCase()
    );
  }
  const superadminId = process.env.SUPERADMIN_DISCORD_ID;
  return !!superadminId && identity.id === superadminId;
}

async function applySuperadminOverride(identity: AuthIdentity, player: SessionPlayer): Promise<void> {
  if (isSuperadminIdentity(identity)) {
    if (!player.isAdmin) {
      try {
        await updatePlayer(player.playerId, { is_admin: true });
      } catch (err) {
        // DB write failed — still override the session
        console.warn('[auth] superadmin override write failed:', err instanceof Error ? err.message : String(err));
      }
    }
    player.isAdmin = true;
  }
}

/**
 * Initial sign-in: one narrow read of the identity's player, creating the
 * player when none exists. A brand-new player cannot hold `resource_admins`
 * rows yet, so it needs no count query.
 */
async function resolveSignInPlayer(
  identity: AuthIdentity,
  create: () => Promise<Player>
): Promise<SessionPlayer> {
  const row = await getSessionPlayerRowByIdentity(identity.provider, identity.id);
  const player = row
    ? toSessionPlayer(row)
    : toSessionPlayer({ ...(await create()), resource_admin_count: 0 });
  await applySuperadminOverride(identity, player);
  return player;
}

/**
 * Initial sign-in only: brings the sprite-style cookie (the server-render
 * source of truth) in line with the account (docs/pkmn.md, "Sprite styles").
 * Runs after the player lookup, outside its catch, so a failure is never
 * masked as a missing player: the error is logged in full and rethrown, and
 * Auth.js refuses the sign-in (AGENTS.md rule 5, no log-and-continue).
 */
async function syncSignInSpriteStyle(player: SessionPlayer | null | undefined, created: boolean): Promise<void> {
  if (!player) return;
  try {
    await syncSpriteStyleCookieAtSignIn(player.playerId, { created });
  } catch (err) {
    console.error('[auth] sprite style cookie sync at sign-in failed; the sign-in is refused:', err);
    throw err;
  }
}

// Read when this module evaluates (the build collects page data for the auth
// route, so the build needs them too); reports both keys at once when unset.
const discordEnv = readEnv(discordOAuthEnvSchema);

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,

  providers: [
    Discord({
      clientId: discordEnv.DISCORD_CLIENT_ID,
      clientSecret: discordEnv.DISCORD_CLIENT_SECRET,
      checks: ['state'],
    }),
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        const user = await authorizeCredentials(
          typeof credentials?.email === 'string' ? credentials.email : '',
          typeof credentials?.password === 'string' ? credentials.password : '',
          request
        );
        return { id: user.id, email: user.email, name: user.displayName };
      },
    }),
  ],

  session: {
    strategy: 'jwt',
  },

  callbacks: {
    async signIn({ account, profile }) {
      // Account linking: an email/password player signing in with Discord
      // while carrying a link-intent cookie attaches the Discord identity to
      // their existing player instead of creating a new one.
      if (account?.provider !== 'discord') return true;

      const cookieStore = await cookies();
      const intent = cookieStore.get(LINK_DISCORD_COOKIE);
      if (!intent) return true;

      // Single-use: always consume the intent, even on failure
      cookieStore.delete(LINK_DISCORD_COOKIE);

      const playerId = verifyLinkToken(intent.value, requireEnv('NEXTAUTH_SECRET'));
      if (!playerId) {
        // Expired/forged intent — abort instead of silently creating a second player
        return '/auth/error?error=LinkExpired';
      }

      const discordId = (profile as Record<string, unknown> | undefined)?.id;
      if (typeof discordId !== 'string' || !discordId) {
        return '/auth/error?error=Default';
      }

      try {
        const existing = await getPlayerByDiscordId(discordId);
        if (existing && existing.id !== playerId) {
          return '/auth/error?error=DiscordAlreadyLinked';
        }
        if (!existing) {
          await linkDiscordToPlayer(playerId, discordId);
        }
        return true;
      } catch (err) {
        console.warn('[auth] discord link failed:', err instanceof Error ? err.message : String(err));
        return '/auth/error?error=Default';
      }
    },

    // `session` (client-supplied data on update) is deliberately not read:
    // the token's player only ever comes from the database.
    async jwt({ token, account, profile, user, trigger }) {
      // Initial sign-in: Discord OAuth
      if (account?.provider === 'discord' && profile) {
        const discordId = (profile as Record<string, unknown>).id as string;
        token.id = discordId;
        token.provider = 'discord';
        const identity: AuthIdentity = { provider: 'discord', id: discordId };

        let created = false;
        try {
          token.player = await resolveSignInPlayer(identity, () => {
            created = true;
            const prof = profile as Record<string, unknown>;
            const discordUsername = (prof.username as string)
              ?? (prof.global_name as string)
              ?? `Player ${discordId}`;
            return createPlayer({
              name: discordUsername,
              discord_id: discordId,
            });
          });
          token[REFRESHED_AT] = Date.now();
        } catch (err) {
          console.warn('[auth] jwt callback player lookup failed:', err instanceof Error ? err.message : String(err));
          token.player = null;
          // No timestamp: the next call retries the read.
          delete token[REFRESHED_AT];
        }
        await syncSignInSpriteStyle(token.player, created);
        return token;
      }

      // Initial sign-in: email/password (Supabase Auth)
      if (account?.provider === 'credentials' && user?.id) {
        const authUserId = user.id;
        token.id = authUserId;
        token.provider = 'credentials';
        const identity: AuthIdentity = {
          provider: 'credentials',
          id: authUserId,
          email: user.email,
        };

        let created = false;
        try {
          token.player = await resolveSignInPlayer(identity, () => {
            created = true;
            return createPlayer({
              name: user.name ?? `Player ${authUserId.slice(0, 8)}`,
              auth_user_id: authUserId,
            });
          });
          token[REFRESHED_AT] = Date.now();
        } catch (err) {
          console.warn('[auth] jwt callback player lookup failed:', err instanceof Error ? err.message : String(err));
          token.player = null;
          delete token[REFRESHED_AT];
        }
        await syncSignInSpriteStyle(token.player, created);
        return token;
      }

      // Session refresh (D37): re-read the player only when the copy is older
      // than SESSION_PLAYER_TTL_MS, or at once on trigger === 'update'.
      // Tokens minted before the provider field existed are Discord sessions.
      if (token.id) {
        const now = Date.now();
        if (trigger !== 'update' && !isSessionRefreshDue(token[REFRESHED_AT], now)) {
          return token;
        }

        const identity: AuthIdentity = {
          provider: token.provider ?? 'discord',
          id: token.id,
          email: token.email,
        };
        try {
          const player = await loadSessionPlayer(identity.provider, identity.id);
          if (player) {
            await applySuperadminOverride(identity, player);
          }
          // null: the identity no longer maps to a player (deleted), so the
          // stale copy must not keep its name or roles on read paths.
          token.player = player;
          token[REFRESHED_AT] = now;
        } catch (err) {
          // Keep the stale copy and leave the timestamp alone, so the next
          // call retries. Guards do not depend on this copy.
          console.warn('[auth] jwt callback player refresh failed:', err instanceof Error ? err.message : String(err));
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (token.id) {
        session.user.id = token.id;
      }
      session.player = token.player ?? null;
      session.provider = token.provider ?? 'discord';
      return session;
    },
  },

  pages: {
    signIn: '/auth/signin',
  },
});
