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
import { seedStandardRulesets } from '@/lib/ruleset-studio/seed-standard';
import { getLatestPublishedRulesetVersion } from '@/lib/supabase/queries/ruleset-definitions';
import { createSeason, updateSeason, addSeasonParticipant } from '@/lib/supabase/queries/seasons';
import { addParticipant, createTournament, updateTournament } from '@/lib/supabase/queries/tournaments';
import { createRound } from '@/lib/supabase/queries/rounds';
import { createMatchBatch, updateMatchStatus } from '@/lib/supabase/queries/matches';
import { createPlayersBatch } from '@/lib/supabase/queries/players';

/** The local-only admin. The values are public on purpose: they open nothing but a local stack. */
export const DEV_SEED_ADMIN = {
  email: 'local-admin@poketools.test',
  password: 'poketools-local-admin',
  name: 'Local Admin',
} as const;

export const DEV_SEED_LEAGUE_NAME = 'Dev Seed League';
export const DEV_SEED_TOURNAMENT_NAME = 'Dev Seed Regular Season';
const SEED_RULESET_NAME = FORMAT_DEFAULTS.gen9ou.name;
const SEED_PLAYER_COUNT = 8;
/** `players.discord_id` of a seeded player: not a Discord snowflake, so it can never match a real account. */
const seedDiscordId = (n: number) => `dev-seed-player-${n}`;

export interface DevSeedReport {
  adminEmail: string;
  adminPlayerId: string;
  rulesetsCreated: number;
  leagueCreated: boolean;
  leagueId: string;
  tournamentId: string;
}

/** The auth user of the seed admin, created confirmed or (when it exists) reset to the documented password. */
async function ensureAdminAuthUser(): Promise<string> {
  const created = await supabase.auth.admin.createUser({
    email: DEV_SEED_ADMIN.email,
    password: DEV_SEED_ADMIN.password,
    email_confirm: true,
  });
  if (created.data.user) return created.data.user.id;
  if (created.error?.code !== 'email_exists') throw created.error ?? new Error('createUser returned no user');

  const listed = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listed.error) throw listed.error;
  const existing = listed.data.users.find((u) => u.email?.toLowerCase() === DEV_SEED_ADMIN.email);
  if (!existing) throw new Error(`${DEV_SEED_ADMIN.email} exists but was not found in the first 1000 auth users`);
  const updated = await supabase.auth.admin.updateUserById(existing.id, {
    password: DEV_SEED_ADMIN.password,
    email_confirm: true,
  });
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

async function ensureSeedPlayers(): Promise<string[]> {
  const ids = Array.from({ length: SEED_PLAYER_COUNT }, (_, i) => seedDiscordId(i + 1));
  const existing = await supabase.from('players').select('id, discord_id').in('discord_id', ids);
  if (existing.error) throw existing.error;
  const have = new Map((existing.data ?? []).map((p) => [p.discord_id, p.id]));
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length > 0) {
    const created = await createPlayersBatch(
      missing.map((discordId) => ({ name: `Seed Player ${discordId.split('-').pop()}`, discord_id: discordId })),
    );
    for (const player of created) have.set(player.discord_id, player.id);
  }
  return ids.map((id) => {
    const playerId = have.get(id);
    if (!playerId) throw new Error(`seed player ${id} was not created`);
    return playerId;
  });
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
  const authUserId = await ensureAdminAuthUser();
  const adminPlayerId = await ensureAdminPlayer(authUserId);
  const { count: rulesetsCreated } = await seedStandardRulesets();

  const existing = await findLeague();
  if (existing) {
    const stage = await supabase.from('tournaments').select('id').eq('season_id', existing.id).limit(1);
    if (stage.error) throw stage.error;
    if (!stage.data?.[0]) {
      // A run that stopped half way left a league without its tournament: start that league over.
      const dropped = await supabase.from('seasons').delete().eq('id', existing.id);
      if (dropped.error) throw dropped.error;
      return finishFresh(adminPlayerId, rulesetsCreated);
    }
    return {
      adminEmail: DEV_SEED_ADMIN.email,
      adminPlayerId,
      rulesetsCreated,
      leagueCreated: false,
      leagueId: existing.id,
      tournamentId: stage.data[0].id,
    };
  }

  return finishFresh(adminPlayerId, rulesetsCreated);
}

async function finishFresh(adminPlayerId: string, rulesetsCreated: number): Promise<DevSeedReport> {
  const playerIds = await ensureSeedPlayers();
  const { leagueId, tournamentId } = await createLeague(playerIds);
  return { adminEmail: DEV_SEED_ADMIN.email, adminPlayerId, rulesetsCreated, leagueCreated: true, leagueId, tournamentId };
}
