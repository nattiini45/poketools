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
async function findLeague(): Promise<{ id: string } | null> {
  const found = await supabase.from('seasons').select('id').eq('name', DEV_SEED_LEAGUE_NAME).limit(1);
  if (found.error) throw found.error;
  return found.data?.[0] ?? null;
}

async function createLeague(playerIds: string[]): Promise<{ leagueId: string; tournamentId: string }> {
  const definition = await supabase.from('ruleset_definitions').select('id').eq('name_text', SEED_RULESET_NAME).limit(1);
  if (definition.error) throw definition.error;
  const version = definition.data?.[0] ? await getLatestPublishedRulesetVersion(definition.data[0].id) : null;
  if (!version) throw new Error(`the standard "${SEED_RULESET_NAME}" ruleset is missing; seed the rulesets first`);

  const season = await createSeason({
    name: DEV_SEED_LEAGUE_NAME,
    description: 'Created by npm run dev:seed. Local development data only.',
    format_type: 'singles',
    ruleset_id: version.id,
    language: 'en',
  });
  for (const playerId of playerIds) await addSeasonParticipant(season.id, playerId);

  const tournament = await createTournament({
    name: DEV_SEED_TOURNAMENT_NAME,
    season_id: season.id,
    bracket_type: 'round_robin',
    ruleset_id: version.id,
    best_of_default: 1,
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    stage_order: 0,
  });
  for (const playerId of playerIds) await addParticipant(tournament.id, playerId);

  const round = await createRound({ tournament_id: tournament.id, name: 'Round 1', round_number: 1, best_of: 1 });
  const matches = await createMatchBatch(
    [0, 1, 2, 3].map((i) => ({
      round_id: round.id,
      tournament_id: tournament.id,
      player_1_id: playerIds[i * 2],
      player_2_id: playerIds[i * 2 + 1],
    })),
  );
  // Two finished matches and two still to play.
  for (const match of matches.slice(0, 2)) await updateMatchStatus(match.id, 'completed', match.player_1_id);

  await updateTournament(tournament.id, { status: 'active', current_round: 1 });
  await updateSeason(season.id, { status: 'active' });
  return { leagueId: season.id, tournamentId: tournament.id };
}

export async function runDevSeed(): Promise<DevSeedReport> {
  const authUserId = await ensureAuthUser(DEV_SEED_ADMIN.email);
  const adminPlayerId = await ensureAdminPlayer(authUserId);
  const { count: rulesetsCreated } = await seedStandardRulesets();
  const playerIds = await ensureSeedPlayers();

  const existing = await findLeague();
  if (existing) {
    const stage = await findCompleteStage(existing.id, playerIds.length);
    if (stage) {
      return {
        adminEmail: DEV_SEED_ADMIN.email,
        adminPlayerId,
        rulesetsCreated,
        leagueCreated: false,
        leagueId: existing.id,
        tournamentId: stage,
      };
    }
    // A run that stopped half way left a league that is missing part of what createLeague writes: start it over.
    await dropLeague(existing.id);
  }

  return finishFresh(adminPlayerId, rulesetsCreated, playerIds);
}

/** The id of the seed tournament when the league holds everything `createLeague` writes, otherwise null. */
async function findCompleteStage(leagueId: string, playerCount: number): Promise<string | null> {
  const [season, stages, seasonPlayers] = await Promise.all([
    supabase.from('seasons').select('status').eq('id', leagueId).single(),
    supabase.from('tournaments').select('id, status, current_round').eq('season_id', leagueId),
    supabase.from('season_participants').select('player_id', { count: 'exact', head: true }).eq('season_id', leagueId),
  ]);
  if (season.error) throw season.error;
  if (stages.error) throw stages.error;
  if (seasonPlayers.error) throw seasonPlayers.error;
  const stage = stages.data?.[0];
  if (stages.data?.length !== 1 || season.data.status !== 'active' || seasonPlayers.count !== playerCount) return null;
  if (stage.status !== 'active' || stage.current_round !== 1) return null;

  const [stagePlayers, rounds, matches] = await Promise.all([
    supabase.from('tournament_participants').select('player_id', { count: 'exact', head: true }).eq('tournament_id', stage.id),
    supabase.from('rounds').select('id', { count: 'exact', head: true }).eq('tournament_id', stage.id),
    supabase.from('matches').select('status').eq('tournament_id', stage.id),
  ]);
  if (stagePlayers.error) throw stagePlayers.error;
  if (rounds.error) throw rounds.error;
  if (matches.error) throw matches.error;
  const statuses = (matches.data ?? []).map((m) => m.status).sort();
  const complete =
    stagePlayers.count === playerCount &&
    rounds.count === 1 &&
    statuses.join(',') === 'completed,completed,scheduled,scheduled';
  return complete ? stage.id : null;
}

/** The tournaments reference their season without a cascade, so they go first (rounds and matches cascade from them). */
async function dropLeague(leagueId: string): Promise<void> {
  const stages = await supabase.from('tournaments').delete().eq('season_id', leagueId);
  if (stages.error) throw stages.error;
  const season = await supabase.from('seasons').delete().eq('id', leagueId);
  if (season.error) throw season.error;
}

async function finishFresh(adminPlayerId: string, rulesetsCreated: number, playerIds: string[]): Promise<DevSeedReport> {
  const { leagueId, tournamentId } = await createLeague(playerIds);
  return { adminEmail: DEV_SEED_ADMIN.email, adminPlayerId, rulesetsCreated, leagueCreated: true, leagueId, tournamentId };
}
