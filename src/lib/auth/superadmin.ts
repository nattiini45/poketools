/**
 * The superadmin identity (`SUPERADMIN_DISCORD_ID`, `SUPERADMIN_EMAIL`).
 *
 * A Discord session is the superadmin when its snowflake equals
 * `SUPERADMIN_DISCORD_ID`. An email/password session is the superadmin only
 * when BOTH hold: its sign-in email is `SUPERADMIN_EMAIL` and the player it
 * resolves to carries `SUPERADMIN_DISCORD_ID` (`players.discord_id`), which is
 * the case once the operator linked that email from their Discord account
 * (`POST /api/account/link-email`). The email alone proves nothing: GoTrue
 * accepts a signup for any address with the public anon key, so the address
 * can be registered by anyone before the operator does. With
 * `SUPERADMIN_DISCORD_ID` unset no email session is the superadmin.
 *
 * This module imports neither `@/auth` nor the auth helpers, so both can use it.
 */
import { isAuthUserLinkedToDiscordId } from '@/lib/supabase/queries/players';

/** The configured `SUPERADMIN_EMAIL`, trimmed and lower-cased; null when unset or blank. */
function reservedSuperadminEmail(): string | null {
  return process.env.SUPERADMIN_EMAIL?.trim().toLowerCase() || null;
}

/** The configured `SUPERADMIN_DISCORD_ID`, as set (the Discord check compares it verbatim); null when unset or empty. */
export function superadminDiscordId(): string | null {
  return process.env.SUPERADMIN_DISCORD_ID || null;
}

/**
 * True when `email` is the configured SUPERADMIN_EMAIL (trimmed,
 * case-insensitive). False when SUPERADMIN_EMAIL is unset or blank. Used to
 * stop anyone but the Discord superadmin from linking that address.
 */
export function isReservedSuperadminEmail(email: string | null | undefined): boolean {
  const reserved = reservedSuperadminEmail();
  if (!reserved || typeof email !== 'string') return false;
  return email.trim().toLowerCase() === reserved;
}

/**
 * Whether the credentials identity `authUserId` signed in with `email` is the
 * superadmin: the reserved email AND a player linked to `SUPERADMIN_DISCORD_ID`.
 * One narrow read, and only for the reserved address; every other identity
 * answers without touching the database. The Discord id itself never leaves
 * the query: only the boolean does. Query errors rethrow (callers fail closed).
 */
export async function resolveCredentialsSuperadminLink(
  authUserId: string,
  email: string | null | undefined
): Promise<boolean> {
  if (!isReservedSuperadminEmail(email)) return false;
  const discordId = superadminDiscordId();
  if (!discordId) return false;
  return isAuthUserLinkedToDiscordId(authUserId, discordId);
}
