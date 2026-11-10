/**
 * Local-development seed: a sign-in-able admin, the standard rulesets, and one small league, so a fresh local stack has
 * something to look at without Discord. Server only; `scripts/dev-seed.ts` owns the loopback guard and the env, and
 * this module never reads one: it works through the service-role client it is given by the import graph.
 *
 * Idempotent: every step looks for what it would create first, so a second run changes nothing. The league is the one
 * named `DEV_SEED_LEAGUE_NAME`; the example pack's rules apply (nothing here reads a pack), and the ruleset is the
 * standard Gen 9 OU one.
 */
import 'server-only';

import { supabase } from '@/lib/supabase/client';
import { FORMAT_DEFAULTS } from '@/lib/pkmn/formats';
import {
  DEV_SEED_ADMIN,
  DEV_SEED_LEAGUE_NAME,
  DEV_SEED_PASSWORD,
  DEV_SEED_PLAYER_COUNT,
  DEV_SEED_TOURNAMENT_NAME,
  devSeedPlayerEmail,
} from './constants';
import { seedStandardRulesets } from '@/lib/ruleset-studio/seed-standard';
import { getLatestPublishedRulesetVersion } from '@/lib/supabase/queries/ruleset-definitions';
import { createSeason, updateSeason, addSeasonParticipant } from '@/lib/supabase/queries/seasons';
import { addParticipant, createTournament, updateTournament } from '@/lib/supabase/queries/tournaments';
import { createRound } from '@/lib/supabase/queries/rounds';
import { createMatchBatch, updateMatchStatus } from '@/lib/supabase/queries/matches';

const SEED_RULESET_NAME = FORMAT_DEFAULTS.gen9ou.name;
/** `players.discord_id` an earlier version of the seed gave its players; such a row is adopted, never duplicated. */
const legacySeedDiscordId = (n: number) => `dev-seed-player-${n}`;

export interface DevSeedReport {
  adminEmail: string;
  adminPlayerId: string;
  rulesetsCreated: number;
  leagueCreated: boolean;
  leagueId: string;
  tournamentId: string;
}

/** The auth user of `email`, created confirmed or (when it exists) reset to the documented password. */
async function ensureAuthUser(email: string): Promise<string> {
  const created = await supabase.auth.admin.createUser({ email, password: DEV_SEED_PASSWORD, email_confirm: true });
  if (created.data.user) return created.data.user.id;
  if (created.error?.code !== 'email_exists') throw created.error ?? new Error('createUser returned no user');

  const listed = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listed.error) throw listed.error;
  const existing = listed.data.users.find((u) => u.email?.toLowerCase() === email);
  if (!existing) throw new Error(`${email} exists but was not found in the first 1000 auth users`);
  const updated = await supabase.auth.admin.updateUserById(existing.id, { password: DEV_SEED_PASSWORD, email_confirm: true });
  if (updated.error) throw updated.error;
  return existing.id;
}

/** The seed admin's player row, linked to its auth user and flagged admin. */
async function ensureAdminPlayer(authUserId: string): Promise<string> {
  const found = await supabase.from('players').select('id, is_admin').eq('auth_user_id', authUserId).maybeSingle();
  if (found.error) throw found.error;
  if (found.data) {
    if (!found.data.is_admin) {
      const promoted = await supabase.from('players').update({ is_admin: true }).eq('id', found.data.id);
      if (promoted.error) throw promoted.error;
    }
    return found.data.id;
  }
  const inserted = await supabase
    .from('players')
    .insert({ name: DEV_SEED_ADMIN.name, auth_user_id: authUserId, is_admin: true })
    .select('id')
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data.id;
}

/** The player of seeded account `n`: found by its login, adopted from the legacy Discord-id row, or created. */
async function ensureSeedPlayer(n: number): Promise<string> {
  const authUserId = await ensureAuthUser(devSeedPlayerEmail(n));
  const linked = await supabase.from('players').select('id').eq('auth_user_id', authUserId).maybeSingle();
  if (linked.error) throw linked.error;
  if (linked.data) return linked.data.id;

  const legacy = await supabase.from('players').select('id').eq('discord_id', legacySeedDiscordId(n)).maybeSingle();
  if (legacy.error) throw legacy.error;
  if (legacy.data) {
    const adopted = await supabase.from('players').update({ auth_user_id: authUserId }).eq('id', legacy.data.id);
    if (adopted.error) throw adopted.error;
    return legacy.data.id;
  }
  const inserted = await supabase.from('players').insert({ name: `Seed Player ${n}`, auth_user_id: authUserId }).select('id').single();
  if (inserted.error) throw inserted.error;
  return inserted.data.id;
}

async function ensureSeedPlayers(): Promise<string[]> {
  const ids: string[] = [];
  for (let n = 1; n <= DEV_SEED_PLAYER_COUNT; n += 1) ids.push(await ensureSeedPlayer(n));
  return ids;
}

async function findLeague(): Promise<{ id: string; status: string } | null> {
  const found = await supabase.from('seasons').select('id, status').eq('name', DEV_SEED_LEAGUE_NAME).limit(1);
  if (found.error) throw found.error;
  return found.data?.[0] ?? null;
}

async function seedRulesetVersionId(): Promise<string> {
  const definition = await supabase.from('ruleset_definitions').select('id').eq('name_text', SEED_RULESET_NAME).limit(1);
  if (definition.error) throw definition.error;
  const version = definition.data?.[0] ? await getLatestPublishedRulesetVersion(definition.data[0].id) : null;
  if (!version) throw new Error(`the standard "${SEED_RULESET_NAME}" ruleset is missing; seed the rulesets first`);
  return version.id;
}

/** The players that are not yet in the league or tournament `id`, in the order given. */
async function missingPlayers(
  table: 'season_participants' | 'tournament_participants',
  column: 'season_id' | 'tournament_id',
  id: string,
  playerIds: string[],
): Promise<string[]> {
  const present = await supabase.from(table).select('player_id').eq(column, id);
  if (present.error) throw present.error;
  const have = new Set((present.data ?? []).map((row) => row.player_id));
  return playerIds.filter((playerId) => !have.has(playerId));
}

/**
 * Brings the seed tournament to the shape `runDevSeed` promises. The final step moves the tournament out of
 * `upcoming`, so a tournament that is still `upcoming` is a run that stopped half way and is completed in place; one
 * that has left `upcoming` belongs to whoever has been using the league and is never touched.
 */
async function ensureStage(leagueId: string, versionId: string, playerIds: string[]): Promise<string> {
  const stages = await supabase.from('tournaments').select('id, status').eq('season_id', leagueId).order('stage_order').limit(1);
  if (stages.error) throw stages.error;
  const existing = stages.data?.[0];
  if (existing && existing.status !== 'upcoming') return existing.id;

  const tournamentId =
    existing?.id ??
    (
      await createTournament({
        name: DEV_SEED_TOURNAMENT_NAME,
        season_id: leagueId,
        bracket_type: 'round_robin',
        ruleset_id: versionId,
        best_of_default: 1,
        is_doubles: false,
        team_visibility: 'hidden_until_match',
        stage_order: 0,
      })
    ).id;
  for (const playerId of await missingPlayers('tournament_participants', 'tournament_id', tournamentId, playerIds)) {
    await addParticipant(tournamentId, playerId);
  }

  const rounds = await supabase.from('rounds').select('id').eq('tournament_id', tournamentId).eq('round_number', 1).limit(1);
  if (rounds.error) throw rounds.error;
  const roundId =
    rounds.data?.[0]?.id ?? (await createRound({ tournament_id: tournamentId, name: 'Round 1', round_number: 1, best_of: 1 })).id;

  const written = await supabase
    .from('matches')
    .select('id, player_1_id, status')
    .eq('tournament_id', tournamentId)
    .order('created_at')
    .order('id');
  if (written.error) throw written.error;
  const matches = written.data?.length
    ? written.data
    : await createMatchBatch(
        [0, 1, 2, 3].map((i) => ({
          round_id: roundId,
          tournament_id: tournamentId,
          player_1_id: playerIds[i * 2],
          player_2_id: playerIds[i * 2 + 1],
        })),
      );
  // Two finished matches and two still to play.
  if (matches.every((match) => match.status === 'scheduled')) {
    for (const match of matches.slice(0, 2)) await updateMatchStatus(match.id, 'completed', match.player_1_id, undefined, undefined, 'scheduled');
  }

  await updateTournament(tournamentId, { status: 'active', current_round: 1 });
  return tournamentId;
}

/** Creates the league when it is missing and completes what an interrupted run left; never deletes or resets data. */
async function ensureLeague(playerIds: string[]): Promise<{ leagueId: string; tournamentId: string; created: boolean }> {
  const versionId = await seedRulesetVersionId();
  const existing = await findLeague();
  const season =
    existing ??
    (await createSeason({
      name: DEV_SEED_LEAGUE_NAME,
      description: 'Created by npm run dev:seed. Local development data only.',
      format_type: 'singles',
      ruleset_id: versionId,
      language: 'en',
    }));
  for (const playerId of await missingPlayers('season_participants', 'season_id', season.id, playerIds)) {
    await addSeasonParticipant(season.id, playerId);
  }

  const tournamentId = await ensureStage(season.id, versionId, playerIds);
  if (!existing || existing.status === 'upcoming') await updateSeason(season.id, { status: 'active' });
  return { leagueId: season.id, tournamentId, created: !existing };
}

export async function runDevSeed(): Promise<DevSeedReport> {
  const authUserId = await ensureAuthUser(DEV_SEED_ADMIN.email);
  const adminPlayerId = await ensureAdminPlayer(authUserId);
  const { count: rulesetsCreated } = await seedStandardRulesets();
  const playerIds = await ensureSeedPlayers();

  const { leagueId, tournamentId, created } = await ensureLeague(playerIds);
  return { adminEmail: DEV_SEED_ADMIN.email, adminPlayerId, rulesetsCreated, leagueCreated: created, leagueId, tournamentId };
}
