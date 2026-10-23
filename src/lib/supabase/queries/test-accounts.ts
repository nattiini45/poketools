import 'server-only';

import { randomInt } from 'node:crypto';
import { supabase } from '../client';
import { toPlayer } from './players';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Player } from '@/types/player';

/**
 * Reusable dummy/test players for development and admin testing (spec §1).
 *
 * Test players are identified by `players.is_test_account = true` — NEVER by a
 * username prefix. A synthetic, stable `discord_id` (`__test__EvoTestNN`) acts as
 * the idempotency key, because `players.discord_id` is NOT NULL + unique.
 *
 * Test data isolation rule: a match counts as test data when its season is a test
 * season (`seasons.is_test_season`) OR either participant is a test account. Test
 * data is excluded from every public/global surface and from all_time aggregates.
 */

export const STANDARD_TEST_PLAYER_COUNT = 14;

export interface StandardTestPlayerSpec {
  name: string;
  psUsername: string;
  /** Synthetic stable key used as the upsert conflict target. */
  discordId: string;
}

function specFor(index: number): StandardTestPlayerSpec {
  const suffix = String(index + 1).padStart(2, '0');
  const name = `EvoTest${suffix}`;
  return { name, psUsername: name, discordId: `__test__${name}` };
}

/** The 14 canonical dummy players (EvoTest01–EvoTest14). */
export const STANDARD_TEST_PLAYERS: StandardTestPlayerSpec[] = Array.from(
  { length: STANDARD_TEST_PLAYER_COUNT },
  (_, i) => specFor(i),
);

const TEST_EMAIL_DOMAIN = 'poketools-test.local';

function testEmail(name: string): string {
  return `${name.toLowerCase()}@${TEST_EMAIL_DOMAIN}`;
}

const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%^&*-';

function generatePassword(length = 20): string {
  // randomInt draws uniformly; `byte % alphabet.length` would favour the
  // first 256 % 65 characters.
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}

/**
 * Ensure the 14 standard test players exist, creating any that are missing and
 * repairing flag drift. Idempotent: running twice never creates duplicates and
 * never clobbers an already-linked `auth_user_id` (only the upsert payload
 * columns are written on conflict).
 */
export async function ensureStandardTestPlayers(): Promise<Player[]> {
  const rows = STANDARD_TEST_PLAYERS.map((spec) => ({
    discord_id: spec.discordId,
    name: spec.name,
    ps_username: spec.psUsername,
    champions_username: '',
    is_test_account: true,
    status: 'active',
  }));

  const { data, error } = await supabase
    .from('players')
    .upsert(rows, { onConflict: 'discord_id' })
    .select('*')
    .order('name');

  if (error) throw error;
  return data.map(toPlayer);
}

/** All test accounts (is_test_account = true), ordered by name. */
export async function listTestAccounts(): Promise<Player[]> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('is_test_account', true)
    .order('name');

  if (error) throw error;
  return data.map(toPlayer);
}

/** IDs of all test accounts — used by global/public queries to exclude test data. */
export async function getTestAccountIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('players')
    .select('id')
    .eq('is_test_account', true);

  if (error) throw error;
  return data.map((row) => row.id);
}

/**
 * Whether a game's data must be excluded from the all_time (global) aggregate
 * scope. True when the season is a test season OR any participating player is a
 * test account, so global stats stay uncontaminated while test leagues still
 * work locally.
 *
 * Evaluated ONCE, when a game is created (`recordGameResult` in
 * src/lib/pkmn/game-pipeline.ts), and frozen on the row as
 * `games.exclude_all_time`. Every later path passes that stored value as
 * `excludeAllTime` to `buildGameAggregateDeltas` (the queue's
 * `apply_aggregate_job`, the admin edit re-apply and `rollback_game_aggregates`),
 * so flipping `is_test_season` / `is_test_account` after matches exist cannot
 * make an apply and its rollback disagree about the all_time scope.
 */
export async function shouldExcludeFromAllTime(
  seasonId: string | null,
  playerIds: string[]
): Promise<boolean> {
  if (seasonId) {
    const { data, error } = await supabase
      .from('seasons')
      .select('is_test_season')
      .eq('id', seasonId)
      .maybeSingle();
    if (error) throw error;
    if (data?.is_test_season) return true;
  }
  if (playerIds.length > 0) {
    const testIds = await getTestAccountIds();
    if (testIds.length > 0 && playerIds.some((id) => testIds.includes(id))) {
      return true;
    }
  }
  return false;
}

export async function getTestAccount(playerId: string): Promise<Player | null> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .eq('is_test_account', true)
    .maybeSingle();

  if (error) throw error;
  return data ? toPlayer(data) : null;
}

/**
 * Fetch a player and assert it is a test account. Throws a 400 UserFacingError
 * otherwise — guards every destructive test-account operation from touching real
 * users.
 */
export async function assertTestAccount(playerId: string): Promise<Player> {
  const player = await getTestAccount(playerId);
  if (!player) {
    throw new UserFacingError('Player is not a test account.', {
      code: 'not_a_test_account',
      status: 400,
    });
  }
  return player;
}

/**
 * Remove a test player from a season: deletes their participation and their
 * season-scoped EPB progression (evolution tracker rows + one-shot token grants).
 * Historical match snapshots are intentionally preserved (immutable per spec §13).
 * Matches themselves are not deleted here — use deleteTestOnlyMatches for that.
 */
export async function removeTestPlayerFromSeason(
  seasonId: string,
  playerId: string,
): Promise<void> {
  await assertTestAccount(playerId);

  const [participants, trackers, grants] = await Promise.all([
    supabase
      .from('season_participants')
      .delete()
      .eq('season_id', seasonId)
      .eq('player_id', playerId),
    supabase
      .from('evolution_tracker')
      .delete()
      .eq('season_id', seasonId)
      .eq('player_id', playerId),
    supabase
      .from('epb_token_grants')
      .delete()
      .eq('season_id', seasonId)
      .eq('player_id', playerId),
  ]);

  const firstError = participants.error ?? trackers.error ?? grants.error;
  if (firstError) throw firstError;
}

/**
 * Wipe a test account's progression across all seasons (evolution tracker,
 * one-shot token grants, match evolution snapshots). Returns the account to a
 * fresh slate. Gamification (ratings/streaks/achievements) is reconciled by the
 * season reconciliation service (Phase 2), not here.
 */
export async function resetTestAccountData(playerId: string): Promise<void> {
  await assertTestAccount(playerId);

  const [trackers, grants, snapshots] = await Promise.all([
    supabase.from('evolution_tracker').delete().eq('player_id', playerId),
    supabase.from('epb_token_grants').delete().eq('player_id', playerId),
    supabase.from('match_evolution_snapshots').delete().eq('player_id', playerId),
  ]);

  const firstError = trackers.error ?? grants.error ?? snapshots.error;
  if (firstError) throw firstError;
}

/**
 * Mint (or reset) loginable Supabase Auth credentials for a test account so a
 * tester can sign in and exercise normal player-facing flows. Returns the
 * generated password once — it is not stored in plaintext.
 */
export async function mintLoginCredentials(
  playerId: string,
): Promise<{ email: string; password: string }> {
  const player = await assertTestAccount(playerId);
  const email = testEmail(player.name);
  const password = generatePassword();

  if (player.auth_user_id) {
    const { error } = await supabase.auth.admin.updateUserById(player.auth_user_id, {
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    return { email, password };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const authUserId = data.user.id;

  // Guarded link: only succeeds while auth_user_id is still null. If the link
  // fails, or a concurrent mint already linked another user (count === 0),
  // delete the auth user we just created so it cannot become an orphan.
  const { error: linkError, count } = await supabase
    .from('players')
    .update({ auth_user_id: authUserId }, { count: 'exact' })
    .eq('id', playerId)
    .is('auth_user_id', null);

  if (linkError) {
    await supabase.auth.admin.deleteUser(authUserId).catch(() => undefined);
    throw linkError;
  }
  if (count === 0) {
    await supabase.auth.admin.deleteUser(authUserId).catch(() => undefined);
    throw new UserFacingError(
      'Login credentials are already being minted for this test account; refresh and try again.',
      { code: 'login_already_minted', status: 409 },
    );
  }

  return { email, password };
}

/** Remove loginable credentials from a test account (reverts to admin-only). */
export async function clearLoginCredentials(playerId: string): Promise<void> {
  const player = await assertTestAccount(playerId);
  const authUserId = player.auth_user_id;
  if (!authUserId) return;

  // Clear the link first so the player never points at a deleted auth user.
  // Guard by BOTH id and the auth_user_id we read — if a concurrent mint linked
  // a different user in the meantime (count === 0), abort so we neither delete
  // the wrong user nor clobber the new link.
  const { error: unlinkError, count } = await supabase
    .from('players')
    .update({ auth_user_id: null }, { count: 'exact' })
    .eq('id', playerId)
    .eq('auth_user_id', authUserId);
  if (unlinkError) throw unlinkError;
  if (count === 0) return; // link changed concurrently — nothing to clear

  // Best-effort delete of the auth user. If deletion fails, restore the link so
  // a retry can attempt it again (the user is still live).
  const { error: deleteError } = await supabase.auth.admin.deleteUser(authUserId);
  if (deleteError) {
    try {
      await supabase
        .from('players')
        .update({ auth_user_id: authUserId })
        .eq('id', playerId)
        .is('auth_user_id', null);
    } catch {
      // best-effort restore; the player link stays null if this also fails
    }
    throw deleteError;
  }
}

/**
 * Delete every match in a season whose BOTH participants are test accounts.
 * Safe by construction: no real user is ever a participant. Match deletion
 * cascades to games, battle_stats, match analyses, and match evolution
 * snapshots. EPB progression for the affected test players should afterwards be
 * reconciled via the season reconciliation service (Phase 2); stale progression
 * only ever affects test accounts here.
 */
export async function deleteTestOnlyMatches(
  seasonId: string,
): Promise<{ deleted: number }> {
  // Resolve the set of test-account IDs up front.
  const testIds = new Set((await listTestAccounts()).map((p) => p.id));
  if (testIds.size === 0) return { deleted: 0 };

  const { data: tournaments, error: tErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('season_id', seasonId);
  if (tErr) throw tErr;

  const tournamentIds = tournaments.map((t) => t.id);
  if (tournamentIds.length === 0) return { deleted: 0 };

  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, player_1_id, player_2_id')
    .in('tournament_id', tournamentIds);
  if (mErr) throw mErr;

  const testOnlyMatchIds = matches
    .filter(
      (m) => testIds.has(m.player_1_id) && testIds.has(m.player_2_id),
    )
    .map((m) => m.id);

  if (testOnlyMatchIds.length === 0) return { deleted: 0 };

  const { error: delErr } = await supabase
    .from('matches')
    .delete()
    .in('id', testOnlyMatchIds);
  if (delErr) throw delErr;

  return { deleted: testOnlyMatchIds.length };
}
