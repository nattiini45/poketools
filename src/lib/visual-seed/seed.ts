/**
 * The visual-capture seed (`node scripts/visual/seed.mjs`): fixed-id leagues, matches, a draft and a solo Cast Studio
 * session on a LOCAL stack, so every broadcast overlay, the match page and the themed league worlds render real data
 * for the capture harness. Server only; `scripts/visual/seed-run.ts` owns the loopback guard and the env.
 *
 * It runs the dev seed first (admin, standard rulesets, the dev league), then writes its own rows. Root rows a capture
 * URL names are inserted with the fixed ids of `./ids.ts` (the query helpers mint their own ids); everything else goes
 * through the app's own paths: `recordGameResult` for games and battle stats, the confirm path
 * (`updateMatchStatus` + `finalizeMatchCompletion`) for completions, `drainPendingAggregateJobs` for the aggregates,
 * the format-studio fork/publish/attach for the custom league and `trashLeague` for the recycle bin.
 *
 * Idempotent: a fixed-id row is inserted only when missing (upsert, ignore duplicates), and a match is played only
 * while it has no games, so a second run changes nothing. Dates written by the seed are fixed October 2026 values.
 */
import 'server-only';

import { supabase } from '@/lib/supabase/client';
import { runDevSeed } from '@/lib/dev-seed/seed';
import { FORMAT_DEFAULTS } from '@/lib/pkmn/formats';
import { recordGameResult } from '@/lib/pkmn/game-pipeline';
import { finalizeMatchCompletion } from '@/lib/match/finalize';
import { drainPendingAggregateJobs } from '@/lib/match/aggregate-rebuild';
import { computeDraftState, legacySeatOrder } from '@/lib/draft/engine';
import { defaultPickOrder } from '@/lib/draft/pool-format';
import { lineIdOfEntry } from '@/lib/draft/line-identity';
import { draftPoolStatusMachine } from '@/lib/draft/pool-status-state';
import { createInitialState, trackerReducer, type TrackerDispatchAction } from '@/lib/broadcast/tracker-reducer';
import { forkPreset, publish } from '@/lib/format-studio/library';
import { attachFormatToSeason } from '@/lib/format-studio/attach';
import { finishLeagueDeleteRebuild, trashLeague } from '@/lib/league-trash/service';
import { getLatestPublishedRulesetVersion } from '@/lib/supabase/queries/ruleset-definitions';
import { addSeasonParticipant, getSeasonParticipants, updateSeason } from '@/lib/supabase/queries/seasons';
import { addParticipant, archiveTournamentsBySeason, updateTournament } from '@/lib/supabase/queries/tournaments';
import { updateRoundStatus } from '@/lib/supabase/queries/rounds';
import { getMatchById, updateMatchStatus } from '@/lib/supabase/queries/matches';
import { createTeam, getPlayerTeamForTournament } from '@/lib/supabase/queries/teams';
import { createMomentsBatch } from '@/lib/supabase/queries/broadcast-moments';
import { createDraftPick, getDraftPoolById, getPicksByPool, updateDraftPoolStatus } from '@/lib/supabase/queries/drafts';
import { createReplayEvent } from '@/lib/supabase/queries/draft-replay-events';
import { bindSeasonToList, bulkCreateListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { upsertFormatRules } from '@/lib/supabase/queries/format-rules';
import { bulkCreateTiers, createTracker, getAllTiers, getSeasonTrackers, updateTracker } from '@/lib/supabase/queries/evolutions';
import { getFormatDefinitionDraft, getFormatDefinitionMeta } from '@/lib/supabase/queries/format-definitions';
import { getSeasonFormatSummary } from '@/lib/supabase/queries/season-formats';
import { getLeagueTrashBySeason } from '@/lib/supabase/queries/league-trash';
import { VISUAL_SEED_DATES, VISUAL_SEED_FORMAT_SLUG, VISUAL_SEED_IDS as ID, matchPlayedAt } from './ids';
import {
  VISUAL_SEED_DRAFT_PICKS,
  VISUAL_SEED_EPB_BOARD_PROGRESS,
  VISUAL_SEED_EPB_LINES,
  VISUAL_SEED_SOLO_OPPONENT,
  VISUAL_SEED_TEAMS,
} from './fixtures';
import type { SessionPlayer } from '@/types/auth';
import type { BattleStatInsert } from '@/types/game';
import type { GameSummary } from '@/types/match';
import type { BracketType, TeamVisibility } from '@/types/tournament';
import type { RouteThemeId, SeasonFormatType } from '@/types/season';
import type { Json } from '@/types/database';
import type { TrackerState } from '@/types/broadcast';
import type { EvolutionTierFormData, PowerTier } from '@/types/evolution';
import type { PriceGroup } from '@/types/point-buy';

/** Created / skipped count per kind of row: the runner prints it, and a second run shows no created rows. */
export type VisualSeedCounts = Record<string, { created: number; skipped: number }>;

const counts: VisualSeedCounts = {};
function tally(kind: string, created: boolean): void {
  const entry = (counts[kind] ??= { created: 0, skipped: 0 });
  if (created) entry.created += 1;
  else entry.skipped += 1;
}

type PlayerKey = 'playerAria' | 'playerBram' | 'playerCleo' | 'playerDario' | 'playerElin' | 'playerFinn' | 'playerGreta' | 'playerHugo';

const PLAYERS: ReadonlyArray<{ key: PlayerKey; name: string; ps: string }> = [
  { key: 'playerAria', name: 'Aria', ps: 'AriaVisual' },
  { key: 'playerBram', name: 'Bram', ps: 'BramVisual' },
  { key: 'playerCleo', name: 'Cleo', ps: 'CleoVisual' },
  { key: 'playerDario', name: 'Dario', ps: 'DarioVisual' },
  { key: 'playerElin', name: 'Elin', ps: 'ElinVisual' },
  { key: 'playerFinn', name: 'Finn', ps: 'FinnVisual' },
  { key: 'playerGreta', name: 'Greta', ps: 'GretaVisual' },
  { key: 'playerHugo', name: 'Hugo', ps: 'HugoVisual' },
];

const P = (key: PlayerKey): string => ID[key];

// ─── Fixed-id rows ──────────────────────────────────────────────────────────────

async function ensurePlayers(): Promise<void> {
  for (const player of PLAYERS) {
    const { data, error } = await supabase
      .from('players')
      .upsert(
        {
          id: ID[player.key],
          name: player.name,
          ps_username: player.ps,
          // An identity is required (players_identity_check); these trainers never sign in, so a fixed placeholder.
          discord_id: 'visual-seed-' + player.key,
          joined_date: VISUAL_SEED_DATES.leagueStart,
          created_at: VISUAL_SEED_DATES.firstMatch,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      )
      .select('id');
    if (error) throw error;
    tally('players', data.length > 0);
  }
}

async function rulesetVersionId(): Promise<string> {
  const definition = await supabase.from('ruleset_definitions').select('id').eq('name_text', FORMAT_DEFAULTS.gen9ou.name).limit(1);
  if (definition.error) throw definition.error;
  const version = definition.data?.[0] ? await getLatestPublishedRulesetVersion(definition.data[0].id) : null;
  if (!version) throw new Error('the standard Gen 9 OU ruleset is missing: the dev seed did not run');
  return version.id;
}

interface LeagueSpec {
  id: string;
  name: string;
  format: SeasonFormatType;
  theme: RouteThemeId;
  players: readonly PlayerKey[];
}

/** The league row (status `upcoming` until `activateLeague`) and its participants. Returns true when it was created. */
async function ensureLeague(spec: LeagueSpec, versionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('seasons')
    .upsert(
      {
        id: spec.id,
        name: spec.name,
        description: 'Visual-capture seed (scripts/visual/seed.mjs). Local stack only.',
        format_type: spec.format,
        ruleset_id: versionId,
        start_date: VISUAL_SEED_DATES.leagueStart,
        end_date: VISUAL_SEED_DATES.leagueEnd,
        route_theme: spec.theme,
        language: 'en',
        created_at: VISUAL_SEED_DATES.leagueStart + 'T09:00:00.000Z',
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw error;
  tally('leagues', data.length > 0);

  const present = await supabase.from('season_participants').select('player_id').eq('season_id', spec.id);
  if (present.error) throw present.error;
  const have = new Set(present.data.map((row) => row.player_id));
  for (const key of spec.players) {
    if (have.has(P(key))) continue;
    await addSeasonParticipant(spec.id, P(key));
    tally('league participants', true);
  }
  return data.length > 0;
}

async function activateLeague(id: string): Promise<void> {
  const { data, error } = await supabase.from('seasons').select('status').eq('id', id).single();
  if (error) throw error;
  if (data.status === 'upcoming') await updateSeason(id, { status: 'active' });
}

interface StageSpec {
  id: string;
  name: string;
  seasonId: string | null;
  bracket: BracketType;
  bestOf: number;
  visibility: TeamVisibility;
  players: readonly PlayerKey[];
  rounds: ReadonlyArray<{ id: string; number: number; bestOf: number }>;
}

async function ensureStage(spec: StageSpec, versionId: string): Promise<void> {
  const { data, error } = await supabase
    .from('tournaments')
    .upsert(
      {
        id: spec.id,
        name: spec.name,
        description: 'Visual-capture seed.',
        season_id: spec.seasonId,
        bracket_type: spec.bracket,
        ruleset_id: versionId,
        best_of_default: spec.bestOf,
        is_doubles: false,
        team_visibility: spec.visibility,
        stage_order: 0,
        created_at: VISUAL_SEED_DATES.leagueStart + 'T09:00:00.000Z',
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw error;
  tally('tournaments', data.length > 0);

  const present = await supabase.from('tournament_participants').select('player_id').eq('tournament_id', spec.id);
  if (present.error) throw present.error;
  const have = new Set(present.data.map((row) => row.player_id));
  for (const key of spec.players) {
    if (have.has(P(key))) continue;
    await addParticipant(spec.id, P(key));
    tally('tournament participants', true);
  }

  for (const round of spec.rounds) {
    const inserted = await supabase
      .from('rounds')
      .upsert(
        {
          id: round.id,
          tournament_id: spec.id,
          name: 'Round ' + round.number,
          round_number: round.number,
          best_of: round.bestOf,
          pairings_generated: true,
          created_at: VISUAL_SEED_DATES.leagueStart + 'T09:00:00.000Z',
        },
        { onConflict: 'id', ignoreDuplicates: true },
      )
      .select('id');
    if (inserted.error) throw inserted.error;
    tally('rounds', inserted.data.length > 0);
  }

  for (const key of spec.players) {
    if (await getPlayerTeamForTournament(P(key), spec.id)) {
      tally('teams', false);
      continue;
    }
    const player = PLAYERS.find((p) => p.key === key);
    await createTeam(P(key), {
      tournament_id: spec.id,
      season_id: spec.seasonId,
      pokemon: [...VISUAL_SEED_TEAMS[key]],
      import_source: 'manual',
      name: (player?.name ?? 'Seed') + ' OU',
    });
    tally('teams', true);
  }
}

async function activateStage(id: string, currentRound: number): Promise<void> {
  const { data, error } = await supabase.from('tournaments').select('status').eq('id', id).single();
  if (error) throw error;
  if (data.status === 'upcoming') await updateTournament(id, { status: 'active', current_round: currentRound });
}

// ─── Matches ────────────────────────────────────────────────────────────────────

interface MatchSpec {
  id: string;
  stageId: string;
  roundId: string;
  p1: PlayerKey;
  p2: PlayerKey;
  /** Winner side of each game, in order. Empty: the match stays scheduled. */
  games: ReadonlyArray<1 | 2>;
  /** False: the games are recorded but the match is not confirmed (a live, in-progress match). */
  complete: boolean;
  /** Played-at slot (`matchPlayedAt`); the scheduled date of an unplayed match is `VISUAL_SEED_DATES.scheduledMatch`. */
  day: number;
  /** Species per side when the teams are not the trainers' OU teams (EPB lines). */
  rosters?: readonly [readonly string[], readonly string[]];
  moves?: Readonly<Record<string, readonly string[]>>;
}

async function ensureMatchRow(spec: MatchSpec): Promise<void> {
  const { data, error } = await supabase
    .from('matches')
    .upsert(
      {
        id: spec.id,
        round_id: spec.roundId,
        tournament_id: spec.stageId,
        player_1_id: P(spec.p1),
        player_2_id: P(spec.p2),
        scheduled_at: spec.games.length === 0 || !spec.complete ? VISUAL_SEED_DATES.scheduledMatch : matchPlayedAt(spec.day),
        created_at: VISUAL_SEED_DATES.leagueStart + 'T09:00:00.000Z',
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw error;
  tally('matches', data.length > 0);
}

function rosterOf(spec: MatchSpec, side: 1 | 2): { species: readonly string[]; moves: (species: string) => readonly string[] } {
  const key = side === 1 ? spec.p1 : spec.p2;
  if (spec.rosters) {
    const species = spec.rosters[side - 1];
    return { species, moves: (name) => spec.moves?.[name] ?? [] };
  }
  const team = VISUAL_SEED_TEAMS[key];
  return { species: team.map((set) => set.species), moves: (name) => team.find((set) => set.species === name)?.moves ?? [] };
}

/** Spread `total` KOs over `size` Pokémon, deterministically from `seed` (the first in the rotation gets the most). */
function spreadKos(total: number, size: number, seed: number): number[] {
  const kos = Array.from({ length: size }, () => 0);
  const order = [0, 0, 1, 2, 0, 3, 1, 4, 5];
  for (let i = 0; i < total; i += 1) kos[(order[i % order.length] + seed) % size] += 1;
  return kos;
}

/** One game's battle stats: the loser loses every Pokémon, the winner keeps `1 + seed % 3` (at least one). */
function gameStats(spec: MatchSpec, winner: 1 | 2, seed: number): BattleStatInsert[] {
  const sides = ([1, 2] as const).map((side) => ({ side, playerId: P(side === 1 ? spec.p1 : spec.p2), ...rosterOf(spec, side) }));
  const winnerSize = sides[winner - 1].species.length;
  const loserSize = sides[2 - winner].species.length;
  const winnerLosses = Math.max(0, winnerSize - 1 - (seed % 3));
  return sides.flatMap(({ side, playerId, species, moves }) => {
    const won = side === winner;
    const kos = spreadKos(won ? loserSize : winnerLosses, species.length, seed);
    return species.map((name, i) => {
      const allMoves = moves(name);
      return {
        game_id: '',
        player_id: playerId,
        pokemon_name: name,
        was_brought: true,
        was_lead: i === seed % species.length,
        kos_dealt: kos[i],
        was_koed: won ? (i + seed) % species.length < winnerLosses : true,
        moves_used: allMoves.slice(0, 2 + ((i + seed) % 3)),
        turns_active: 3 + ((i * 7 + seed) % 9),
      };
    });
  });
}

/**
 * Plays a match through the app's own write path while it has no games: one `recordGameResult` per game (manual
 * source, entered by the seed admin), then, for a completed match, the confirm route's status write and
 * `finalizeMatchCompletion` (ratings, streaks, signatures, achievements, EPB kills). The played-at dates are then set
 * to the fixed values. Returns the recorded game ids.
 */
async function playMatch(spec: MatchSpec, admin: SessionPlayer): Promise<string[] | null> {
  await ensureMatchRow(spec);
  if (spec.games.length === 0) return null;
  const before = await getMatchById(spec.id);
  if (!before) throw new Error('match ' + spec.id + ' is missing after its insert');
  if (before.games.length > 0 || before.status !== 'scheduled') {
    tally('played matches', false);
    return null;
  }

  const gameIds: string[] = [];
  for (const [index, winnerSide] of spec.games.entries()) {
    const winnerId = P(winnerSide === 1 ? spec.p1 : spec.p2);
    const result = await recordGameResult({
      source: 'manual',
      match_id: spec.id,
      submitter_id: admin.playerId,
      is_admin: true,
      winner_id: winnerId,
      battle_stats: gameStats(spec, winnerSide, spec.day + index),
    });
    gameIds.push(result.game_id);
  }

  if (spec.complete) {
    const pending = await getMatchById(spec.id);
    if (!pending || pending.status !== 'pending_confirmation' || !pending.winner_id) {
      throw new Error('match ' + spec.id + ' did not reach pending_confirmation (status ' + (pending?.status ?? 'missing') + ')');
    }
    const winnerId = pending.winner_id;
    const confirmed = await updateMatchStatus(spec.id, 'completed', winnerId, pending.submitter_id ?? admin.playerId, undefined, 'pending_confirmation');
    if (!confirmed) throw new Error('match ' + spec.id + ' changed while the seed confirmed it');
    const finalized = await finalizeMatchCompletion({
      match: { ...pending, winner_id: winnerId, status: 'completed' },
      winnerId,
      previousStatus: 'pending_confirmation',
    });
    if (!finalized.finalized || (finalized.failed_steps ?? []).length > 0) {
      throw new Error('match ' + spec.id + ' finalize incomplete: ' + (finalized.reason ?? (finalized.failed_steps ?? []).join(', ')));
    }
  }

  const playedAt = matchPlayedAt(spec.day);
  const dates = await supabase
    .from('matches')
    .update(spec.complete ? { scheduled_at: playedAt, date_played: playedAt, confirmed_at: playedAt } : { scheduled_at: playedAt })
    .eq('id', spec.id);
  if (dates.error) throw dates.error;
  for (const [index, gameId] of gameIds.entries()) {
    const at = new Date(Date.parse(playedAt) + (index + 1) * 25 * 60 * 1000).toISOString();
    const game = await supabase.from('games').update({ created_at: at }).eq('id', gameId);
    if (game.error) throw game.error;
  }
  tally('played matches', true);
  return gameIds;
}

async function completeRounds(roundIds: readonly string[]): Promise<void> {
  for (const roundId of roundIds) {
    const { data, error } = await supabase.from('rounds').select('status').eq('id', roundId).single();
    if (error) throw error;
    if (data.status !== 'completed') await updateRoundStatus(roundId, 'completed');
  }
}

// ─── The broadcast (sakura) league ────────────────────────────────────────────────

async function seedSakuraLeague(versionId: string, admin: SessionPlayer): Promise<void> {
  const players: PlayerKey[] = ['playerAria', 'playerBram', 'playerCleo', 'playerDario', 'playerElin', 'playerFinn'];
  await ensureLeague({ id: ID.leagueSakura, name: 'Sakura Cup (visual seed)', format: 'singles', theme: 'sakura', players }, versionId);
  await ensureStage(
    {
      id: ID.stageSakura,
      name: 'Sakura Cup Regular Season',
      seasonId: ID.leagueSakura,
      bracket: 'round_robin',
      bestOf: 3,
      visibility: 'always_public',
      players,
      rounds: [
        { id: ID.roundSakura1, number: 1, bestOf: 3 },
        { id: ID.roundSakura2, number: 2, bestOf: 1 },
        { id: ID.roundSakura3, number: 3, bestOf: 3 },
      ],
    },
    versionId,
  );
  await activateStage(ID.stageSakura, 3);
  await activateLeague(ID.leagueSakura);

  const base = { stageId: ID.stageSakura, complete: true } as const;
  const bo3 = await playMatch({ ...base, id: ID.matchCompletedBo3, roundId: ID.roundSakura1, p1: 'playerAria', p2: 'playerBram', games: [1, 2, 1], day: 0 }, admin);
  await playMatch({ ...base, id: ID.matchSakuraSweep, roundId: ID.roundSakura1, p1: 'playerCleo', p2: 'playerDario', games: [1, 1], day: 1 }, admin);
  await playMatch({ ...base, id: ID.matchSakuraDecider, roundId: ID.roundSakura1, p1: 'playerElin', p2: 'playerFinn', games: [2, 1, 2], day: 2 }, admin);
  await playMatch({ ...base, id: ID.matchCompletedBo1, roundId: ID.roundSakura2, p1: 'playerAria', p2: 'playerCleo', games: [1], day: 7 }, admin);
  await playMatch({ ...base, id: ID.matchSakuraBo1b, roundId: ID.roundSakura2, p1: 'playerBram', p2: 'playerElin', games: [2], day: 8 }, admin);
  await playMatch({ ...base, id: ID.matchSakuraBo1c, roundId: ID.roundSakura2, p1: 'playerDario', p2: 'playerFinn', games: [1], day: 9 }, admin);
  const live = await playMatch({ ...base, id: ID.matchLive, roundId: ID.roundSakura3, p1: 'playerAria', p2: 'playerBram', games: [1], complete: false, day: 14 }, admin);
  await playMatch({ ...base, id: ID.matchScheduled, roundId: ID.roundSakura3, p1: 'playerCleo', p2: 'playerElin', games: [], day: 15 }, admin);
  await completeRounds([ID.roundSakura1, ID.roundSakura2]);

  if (bo3) await seedMoments(ID.matchCompletedBo3, bo3, matchPlayedAt(0), admin.playerId);
  if (live) await seedMoments(ID.matchLive, live, matchPlayedAt(14), admin.playerId);
}

/** Caster moments (the moment reel and the match story read them), written only together with the match's games. */
async function seedMoments(matchId: string, gameIds: readonly string[], playedAt: string, createdBy: string): Promise<void> {
  const at = (minutes: number) => new Date(Date.parse(playedAt) + minutes * 60 * 1000).toISOString();
  const first = gameIds[0];
  const last = gameIds[gameIds.length - 1];
  await createMomentsBatch([
    { match_id: matchId, game_id: first, turn_number: 3, moment_type: 'big_ko', description: 'Great Tusk clears the lead with Headlong Rush', pokemon_name: 'Great Tusk', timestamp: at(8), created_by: createdBy },
    { match_id: matchId, game_id: first, turn_number: 11, moment_type: 'turning_point', description: 'Kingambit sets up behind a Sucker Punch read', pokemon_name: 'Kingambit', timestamp: at(17), created_by: createdBy },
    { match_id: matchId, game_id: last, turn_number: 19, moment_type: 'clutch', description: 'Dragonite survives at 4% thanks to Multiscale', pokemon_name: 'Dragonite', timestamp: at(26), created_by: createdBy },
    { match_id: matchId, game_id: last, turn_number: 24, moment_type: 'highlight', description: 'Extreme Speed closes the game', pokemon_name: 'Dragonite', timestamp: at(31), created_by: createdBy },
  ]);
  tally('broadcast moments', true);
}

// ─── Small themed leagues, the archived league, the standalone tournament ─────────

interface SmallLeagueSpec {
  leagueId: string;
  stageId: string;
  roundId: string;
  name: string;
  theme: RouteThemeId;
  players: readonly [PlayerKey, PlayerKey, PlayerKey, PlayerKey];
  matchIds: readonly string[];
  day: number;
}

async function seedSmallStage(spec: SmallLeagueSpec, seasonId: string | null, versionId: string, admin: SessionPlayer): Promise<void> {
  const [a, b, c, d] = spec.players;
  await ensureStage(
    {
      id: spec.stageId,
      name: spec.name + (seasonId ? ' Regular Season' : ''),
      seasonId,
      bracket: 'round_robin',
      bestOf: 1,
      visibility: 'hidden_until_match',
      players: spec.players,
      rounds: [{ id: spec.roundId, number: 1, bestOf: 1 }],
    },
    versionId,
  );
  await activateStage(spec.stageId, 1);
  const base = { stageId: spec.stageId, roundId: spec.roundId, complete: true } as const;
  const pairs: ReadonlyArray<readonly [PlayerKey, PlayerKey, ReadonlyArray<1 | 2>]> = [[a, b, [1]], [c, d, [2]], [a, c, []]];
  for (const [index, matchId] of spec.matchIds.entries()) {
    const [p1, p2, games] = pairs[index];
    await playMatch({ ...base, id: matchId, p1, p2, games, day: spec.day + index }, admin);
  }
}

async function seedSmallLeague(spec: SmallLeagueSpec, versionId: string, admin: SessionPlayer): Promise<void> {
  await ensureLeague({ id: spec.leagueId, name: spec.name, format: 'singles', theme: spec.theme, players: spec.players }, versionId);
  await seedSmallStage(spec, spec.leagueId, versionId, admin);
  await activateLeague(spec.leagueId);
}

async function seedArchivedLeague(versionId: string, admin: SessionPlayer): Promise<void> {
  const players = ['playerElin', 'playerFinn', 'playerGreta', 'playerHugo'] as const;
  await ensureLeague({ id: ID.leagueArchived, name: 'Autumn Classic 2025 (archived, visual seed)', format: 'singles', theme: 'auto', players }, versionId);
  await seedSmallStage(
    { leagueId: ID.leagueArchived, stageId: ID.stageArchived, roundId: ID.roundArchived1, name: 'Autumn Classic 2025', theme: 'auto', players, matchIds: [ID.matchArchived1, ID.matchArchived2], day: 3 },
    ID.leagueArchived,
    versionId,
    admin,
  );
  const { data, error } = await supabase.from('seasons').select('status, archived').eq('id', ID.leagueArchived).single();
  if (error) throw error;
  if (data.archived) return;
  await updateSeason(ID.leagueArchived, { status: 'completed', archived: true });
  await archiveTournamentsBySeason(ID.leagueArchived, true);
}

async function seedTrashedLeague(versionId: string, admin: SessionPlayer): Promise<void> {
  if (await getLeagueTrashBySeason(ID.leagueTrashed)) {
    tally('trashed leagues', false);
    return;
  }
  const players = ['playerAria', 'playerDario', 'playerGreta', 'playerHugo'] as const;
  await ensureLeague({ id: ID.leagueTrashed, name: 'Deleted Test League (visual seed)', format: 'singles', theme: 'auto', players }, versionId);
  await seedSmallStage(
    { leagueId: ID.leagueTrashed, stageId: ID.stageTrashed, roundId: ID.roundTrashed1, name: 'Deleted Test League', theme: 'auto', players, matchIds: [ID.matchTrashed1], day: 4 },
    ID.leagueTrashed,
    versionId,
    admin,
  );
  await activateLeague(ID.leagueTrashed);
  // The DELETE route's path: move to the recycle bin, then rebuild what the league's results fed (ratings, aggregates).
  const trashed = await trashLeague(ID.leagueTrashed, admin.playerId);
  const rebuild = await finishLeagueDeleteRebuild({
    trashId: trashed.trash_id,
    seasonId: ID.leagueTrashed,
    playerIds: trashed.player_ids,
    phaseIds: trashed.phase_ids,
  });
  if (rebuild.warning) console.warn('[visual-seed] trashed league rebuild warning: ' + JSON.stringify(rebuild.warning));
  tally('trashed leagues', true);
}

// ─── Evolution Point Buy (EvoLiga, plaza world) ──────────────────────────────────

async function seedEpbLeague(versionId: string, admin: SessionPlayer): Promise<void> {
  const players = ['playerAria', 'playerBram', 'playerCleo', 'playerDario'] as const;
  await ensureLeague({ id: ID.leagueEpb, name: 'EvoLiga (visual seed)', format: 'evolution_point_buy', theme: 'plaza', players }, versionId);

  const list = await supabase
    .from('point_buy_list_versions')
    .upsert({ id: ID.pointBuyList, name: 'Visual seed list', version: 1, source: 'scripts/visual/seed.mjs', created_at: VISUAL_SEED_DATES.leagueStart + 'T09:00:00.000Z' }, { onConflict: 'id', ignoreDuplicates: true })
    .select('id');
  if (list.error) throw list.error;
  tally('point-buy lists', list.data.length > 0);
  const entries = await supabase.from('point_buy_list_entries').select('id', { count: 'exact', head: true }).eq('list_version_id', ID.pointBuyList);
  if (entries.error) throw entries.error;
  if ((entries.count ?? 0) === 0) {
    await bulkCreateListEntries(
      ID.pointBuyList,
      VISUAL_SEED_EPB_LINES.map(({ moves: _moves, ...line }) => line),
    );
    tally('point-buy entries', true);
  }
  const bound = await supabase.from('seasons').select('point_buy_list_id').eq('id', ID.leagueEpb).single();
  if (bound.error) throw bound.error;
  if (bound.data.point_buy_list_id !== ID.pointBuyList) await bindSeasonToList(ID.leagueEpb, ID.pointBuyList);
  const rules = await supabase.from('format_rules').select('id').eq('season_id', ID.leagueEpb).maybeSingle();
  if (rules.error) throw rules.error;
  if (!rules.data) await upsertFormatRules(ID.leagueEpb, {});

  // Three drafted lines per trainer (what the draft's picks create), each tracker at its base form.
  const trackers = await getSeasonTrackers(ID.leagueEpb);
  const owned = new Set(trackers.map((tracker) => tracker.line_id));
  for (const [index, line] of VISUAL_SEED_EPB_LINES.entries()) {
    const lineId = lineIdOfEntry({ base_pokemon: line.base_pokemon, stage2_pokemon: line.stage2_pokemon, stage3_pokemon: line.stage3_pokemon });
    if (owned.has(lineId)) continue;
    await createTracker({ season_id: ID.leagueEpb, player_id: P(players[Math.floor(index / 3)]), base_pokemon: line.base_pokemon, line_id: lineId });
    tally('evolution trackers', true);
  }

  await ensureStage(
    {
      id: ID.stageEpb,
      name: 'EvoLiga Matchdays',
      seasonId: ID.leagueEpb,
      bracket: 'round_robin',
      bestOf: 1,
      visibility: 'hidden_until_match',
      players: [],
      rounds: [{ id: ID.roundEpb1, number: 1, bestOf: 1 }],
    },
    versionId,
  );
  const enrolled = await supabase.from('tournament_participants').select('player_id').eq('tournament_id', ID.stageEpb);
  if (enrolled.error) throw enrolled.error;
  for (const key of players) {
    if (enrolled.data.some((row) => row.player_id === P(key))) continue;
    await addParticipant(ID.stageEpb, P(key));
    tally('tournament participants', true);
  }
  await activateStage(ID.stageEpb, 1);
  await activateLeague(ID.leagueEpb);

  const linesOf = (slot: number) => VISUAL_SEED_EPB_LINES.slice(slot * 3, slot * 3 + 3).map((line) => line.base_pokemon);
  const moves = Object.fromEntries(VISUAL_SEED_EPB_LINES.map((line) => [line.base_pokemon, line.moves]));
  const base = { stageId: ID.stageEpb, roundId: ID.roundEpb1, complete: true, moves } as const;
  await playMatch({ ...base, id: ID.matchEpbCompleted, p1: 'playerAria', p2: 'playerBram', games: [1], day: 5, rosters: [linesOf(0), linesOf(1)] }, admin);
  await playMatch({ ...base, id: ID.matchEpbCompleted2, p1: 'playerCleo', p2: 'playerDario', games: [2], day: 6, rosters: [linesOf(2), linesOf(3)] }, admin);
  await playMatch({ ...base, id: ID.matchEpbScheduled, p1: 'playerAria', p2: 'playerCleo', games: [], day: 10 }, admin);
}

// ─── Legacy EPB draft board (EvolutionRosterCard) ─────────────────────────────────

/** Point budget and picks per trainer of the legacy board's pool, and the one regular (untiered) pick it holds. */
const EPB_BOARD_BUDGET = 60;
const EPB_BOARD_PICKS = 4;
const EPB_BOARD_REGULAR_PICK = { pokemon: 'Great Tusk', price: 10 } as const;
/** The line drafted as a wildcard (a tier of its own picker) instead of from the tier list. */
const EPB_BOARD_WILDCARD_LINE = 12;

const POWER_TIER_OF: Readonly<Record<PriceGroup, PowerTier>> = { premium: 'S', hoch: 'A', mittel: 'B', guenstig: 'C', budget: 'C' };

/**
 * An Evolution Point Buy league whose draft still runs on the legacy engine, as EvoLiga's initial draft did: the
 * only path to `/leagues/<id>/draft` showing `EvolutionRosterCard`. Evolution tiers (cumulative thresholds, one line
 * as a picker's wildcard), a running snake pool with three lines per trainer plus one regular pick, and one tracker per
 * drafted line at the progress of `VISUAL_SEED_EPB_BOARD_PROGRESS`. Separate from the EvoLiga league so no other
 * frozen surface changes.
 */
async function seedEpbBoardLeague(versionId: string): Promise<void> {
  const players = ['playerElin', 'playerFinn', 'playerGreta', 'playerHugo'] as const;
  const seasonId = ID.leagueEpbBoard;
  await ensureLeague({ id: seasonId, name: 'EvoLiga Legacy Draft (visual seed)', format: 'evolution_point_buy', theme: 'auto', players }, versionId);
  await activateLeague(seasonId);
  const bound = await supabase.from('seasons').select('point_buy_list_id').eq('id', seasonId).single();
  if (bound.error) throw bound.error;
  if (bound.data.point_buy_list_id !== ID.pointBuyList) await bindSeasonToList(seasonId, ID.pointBuyList);
  const rules = await supabase.from('format_rules').select('id').eq('season_id', seasonId).maybeSingle();
  if (rules.error) throw rules.error;
  if (!rules.data) await upsertFormatRules(seasonId, { draft_budget: EPB_BOARD_BUDGET, draft_picks: EPB_BOARD_PICKS });

  // The participants join before the pool runs: a running legacy pool locks the roster (SEASON_DRAFT_LOCKED).
  const inserted = await supabase
    .from('draft_pools')
    .upsert(
      {
        id: ID.draftPoolEpbBoard,
        season_id: seasonId,
        engine: 'legacy',
        draft_type: 'snake',
        pick_order: defaultPickOrder('snake'),
        point_budget: EPB_BOARD_BUDGET,
        created_at: VISUAL_SEED_DATES.draftStart,
        started_at: VISUAL_SEED_DATES.draftStart,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select('id');
  if (inserted.error) throw inserted.error;
  tally('draft pools', inserted.data.length > 0);
  const pool = await getDraftPoolById(ID.draftPoolEpbBoard);
  if (!pool) throw new Error('the legacy EPB pool is missing after its insert');
  if (pool.status === 'pending') {
    draftPoolStatusMachine.assertTransition('pending', 'in_progress', 'admin');
    if (!(await updateDraftPoolStatus(ID.draftPoolEpbBoard, 'pending', 'in_progress'))) {
      throw new Error('the legacy EPB pool moved on before the seed started it');
    }
  }
  const live = { ...pool, status: 'in_progress' as const };

  // Picks in the seat order the state route uses, so each pick is the turn the board computes.
  const participants = await getSeasonParticipants(seasonId);
  const seats = legacySeatOrder(ID.draftPoolEpbBoard, participants.map((participant) => participant.id));
  const draft = [
    ...VISUAL_SEED_EPB_LINES.map((line) => ({ pokemon: line.base_pokemon, price: line.price })),
    EPB_BOARD_REGULAR_PICK,
  ];
  let picks = await getPicksByPool(ID.draftPoolEpbBoard);
  if (picks.length === draft.length) {
    tally('draft picks', false);
  } else {
    // An interrupted seed: start the draft over, with the trackers its picks created.
    if (picks.length > 0) {
      const clearPicks = await supabase.from('draft_picks').delete().eq('draft_pool_id', ID.draftPoolEpbBoard);
      if (clearPicks.error) throw clearPicks.error;
      const clearTrackers = await supabase.from('evolution_tracker').delete().eq('season_id', seasonId);
      if (clearTrackers.error) throw clearTrackers.error;
      picks = [];
    }
    for (const [index, { pokemon, price }] of draft.entries()) {
      const playerId = computeDraftState(live, picks, seats, EPB_BOARD_PICKS).current_picker;
      if (!playerId) throw new Error('the draft engine has no current picker at legacy EPB pick ' + (index + 1));
      await createDraftPick({
        draft_pool_id: ID.draftPoolEpbBoard,
        player_id: playerId,
        pokemon_name: pokemon,
        points_spent: price,
        pick_number: index + 1,
        round: Math.floor(index / seats.length) + 1,
      });
      picks = await getPicksByPool(ID.draftPoolEpbBoard);
      tally('draft picks', true);
    }
  }
  const pickerOf = new Map(picks.map((pick) => [pick.pokemon_name, pick.player_id]));

  // Evolution tiers: stage thresholds are cumulative, as the evolution_tiers table stores them.
  const tiers = await getAllTiers(seasonId);
  const missingTiers: EvolutionTierFormData[] = [];
  for (const line of VISUAL_SEED_EPB_LINES) {
    const playerId = line.line_number === EPB_BOARD_WILDCARD_LINE ? (pickerOf.get(line.base_pokemon) ?? null) : null;
    if (tiers.some((tier) => tier.base_pokemon === line.base_pokemon && tier.player_id === playerId)) {
      tally('evolution tiers', false);
      continue;
    }
    missingTiers.push({
      season_id: seasonId,
      player_id: playerId,
      base_pokemon: line.base_pokemon,
      stage2_pokemon: line.stage2_pokemon,
      stage2_kos: line.kills_to_stage2,
      stage3_pokemon: line.stage3_pokemon,
      stage3_kos: line.additional_kills_to_stage3 === null ? null : line.kills_to_stage2 + line.additional_kills_to_stage3,
      power_tier: POWER_TIER_OF[line.price_group],
    });
    tally('evolution tiers', true);
  }
  if (missingTiers.length > 0) await bulkCreateTiers(missingTiers);

  // One tracker per drafted line (what the legacy picks route creates), then its fixed progress.
  const trackers = await getSeasonTrackers(seasonId);
  for (const line of VISUAL_SEED_EPB_LINES) {
    const playerId = pickerOf.get(line.base_pokemon);
    if (!playerId) throw new Error('no legacy EPB pick holds ' + line.base_pokemon);
    const progress = VISUAL_SEED_EPB_BOARD_PROGRESS[line.line_number];
    const form = progress.stage === 3 ? line.stage3_pokemon : progress.stage === 2 ? line.stage2_pokemon : line.base_pokemon;
    if (!form) throw new Error('line ' + line.line_number + ' has no stage ' + progress.stage);
    const want = {
      current_form: form,
      current_stage: progress.stage,
      total_kos: progress.real_kills + progress.draft_tokens + progress.kill_tokens + progress.cosmo_points,
      real_kills: progress.real_kills,
      draft_tokens: progress.draft_tokens,
      kill_tokens: progress.kill_tokens,
      cosmo_points: progress.cosmo_points,
      evolved_at: progress.stage > 1 ? matchPlayedAt(progress.stage) : null,
    };
    let tracker = trackers.find((row) => row.player_id === playerId && row.base_pokemon === line.base_pokemon);
    tally('evolution trackers', !tracker);
    tracker ??= await createTracker({ season_id: seasonId, player_id: playerId, base_pokemon: line.base_pokemon });
    const current = tracker;
    // Postgres returns the timestamp in its own notation: compare the instant.
    const evolvedAt = current.evolved_at === null ? null : new Date(current.evolved_at).toISOString();
    const stale = evolvedAt !== want.evolved_at || (Object.keys(want) as (keyof typeof want)[]).some((key) => key !== 'evolved_at' && current[key] !== want[key]);
    if (stale) await updateTracker(tracker.id, want);
    tally('evolution tracker progress', stale);
  }
}

// ─── Custom league (format kit) ─────────────────────────────────────────────────

async function seedCustomLeague(versionId: string, admin: SessionPlayer): Promise<void> {
  const players = ['playerElin', 'playerFinn', 'playerGreta', 'playerHugo'] as const;
  await ensureLeague({ id: ID.leagueCustom, name: 'Classic League Kit (visual seed)', format: 'custom', theme: 'auto', players }, versionId);
  if (await getSeasonFormatSummary(ID.leagueCustom)) {
    tally('format attaches', false);
    return;
  }
  const found = await supabase.from('format_definitions').select('id').eq('slug', VISUAL_SEED_FORMAT_SLUG).maybeSingle();
  if (found.error) throw found.error;
  const definitionId = found.data?.id ?? (await forkPreset(admin, 'classic-league', { slug: VISUAL_SEED_FORMAT_SLUG })).definition.id;
  const versions = await supabase.from('format_definition_versions').select('version_no').eq('definition_id', definitionId).limit(1);
  if (versions.error) throw versions.error;
  if (versions.data.length === 0) {
    const [meta, draft] = await Promise.all([getFormatDefinitionMeta(definitionId), getFormatDefinitionDraft(definitionId)]);
    if (!meta || !draft) throw new Error('the forked format definition is missing');
    await publish(admin, meta, { draftRev: draft.draft_rev, changelog: null });
  }
  await attachFormatToSeason({ actor: admin, seasonId: ID.leagueCustom, definitionId });
  tally('format attaches', true);
}

// ─── Standard draft league ───────────────────────────────────────────────────────

async function seedDraftLeague(versionId: string): Promise<void> {
  const players = ['playerElin', 'playerFinn', 'playerGreta', 'playerHugo'] as const;
  await ensureLeague({ id: ID.leagueDraft, name: 'Draft League (visual seed)', format: 'draft', theme: 'auto', players }, versionId);
  await activateLeague(ID.leagueDraft);

  const inserted = await supabase
    .from('draft_pools')
    .upsert(
      {
        id: ID.draftPool,
        season_id: ID.leagueDraft,
        draft_type: 'snake',
        pick_order: defaultPickOrder('snake'),
        pool_mode: 'tier',
        team_size_mode: 'exact',
        team_size_exact: 6,
        created_at: VISUAL_SEED_DATES.draftStart,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select('id');
  if (inserted.error) throw inserted.error;
  tally('draft pools', inserted.data.length > 0);

  const pool = await getDraftPoolById(ID.draftPool);
  if (!pool) throw new Error('the draft pool is missing after its insert');
  if (pool.status === 'pending') {
    draftPoolStatusMachine.assertTransition('pending', 'in_progress', 'admin');
    if (!(await updateDraftPoolStatus(ID.draftPool, 'pending', 'in_progress'))) throw new Error('the draft pool moved on before the seed started it');
  }
  const live = { ...pool, status: 'in_progress' as const };

  const participants = await getSeasonParticipants(ID.leagueDraft);
  const participantIds = participants.map((participant) => participant.id);
  const names = new Map(participants.map((participant) => [participant.id, participant.name]));
  let picks = await getPicksByPool(ID.draftPool);
  const events = await supabase.from('draft_replay_events').select('id', { count: 'exact', head: true }).eq('draft_pool_id', ID.draftPool);
  if (events.error) throw events.error;
  // Every pick has its replay event, plus the opening commentary: anything less is an interrupted seed.
  if (picks.length === VISUAL_SEED_DRAFT_PICKS.length && events.count === VISUAL_SEED_DRAFT_PICKS.length + 1) {
    tally('draft picks', false);
    return;
  }
  if (picks.length > 0 || (events.count ?? 0) > 0) {
    const clearEvents = await supabase.from('draft_replay_events').delete().eq('draft_pool_id', ID.draftPool);
    if (clearEvents.error) throw clearEvents.error;
    const clearPicks = await supabase.from('draft_picks').delete().eq('draft_pool_id', ID.draftPool);
    if (clearPicks.error) throw clearPicks.error;
    picks = [];
  }
  // The legacy engine decides whose turn each pick is (snake order over the league's trainers), as the picks route does.
  for (const [index, pokemon] of VISUAL_SEED_DRAFT_PICKS.entries()) {
    const state = computeDraftState(live, picks, participantIds, 6);
    const playerId = state.current_picker;
    if (!playerId) throw new Error('the draft engine has no current picker at pick ' + (index + 1));
    const pickNumber = index + 1;
    const round = Math.floor(index / participantIds.length) + 1;
    const pick = await createDraftPick({ draft_pool_id: ID.draftPool, player_id: playerId, pokemon_name: pokemon, pick_number: pickNumber, round });
    await createReplayEvent({
      draft_pool_id: ID.draftPool,
      pick_id: pick.id,
      event_type: 'pick',
      event_data: {
        player_id: playerId,
        player_name: names.get(playerId) ?? '',
        pokemon_name: pokemon,
        power_tier: null,
        points_spent: null,
        round,
        pick_number: pickNumber,
        remaining_budget: null,
        tier_usage_after: null,
        evolution_chain: null,
      },
      sequence_number: pickNumber + 1,
      wall_clock_time: new Date(Date.parse(VISUAL_SEED_DATES.draftStart) + pickNumber * 90 * 1000).toISOString(),
    });
    picks = await getPicksByPool(ID.draftPool);
    tally('draft picks', true);
  }
  await createReplayEvent({
    draft_pool_id: ID.draftPool,
    event_type: 'commentary',
    event_data: { text: 'Welcome to the visual seed draft!', author: 'Caster' },
    sequence_number: 1,
    wall_clock_time: VISUAL_SEED_DATES.draftStart,
  });
}

// ─── Solo Cast Studio session ───────────────────────────────────────────────────

/** The tracker after three submitted games (2-1) and a fourth game in progress, built with the studio's reducer. */
function soloTrackerState(adminId: string): TrackerState {
  const own = VISUAL_SEED_TEAMS.playerAria;
  const opponent = VISUAL_SEED_SOLO_OPPONENT;
  const player1Id = P('playerAria');
  let state = createInitialState(
    '',
    { id: player1Id, name: 'Aria', avatar_url: null, pokemon: own.map((set) => set.species) },
    { id: 'solo-opponent', name: 'Ladder Opponent', avatar_url: null, pokemon: opponent.map((set) => set.species) },
  );
  const games: ReadonlyArray<readonly [string, boolean]> = [[ID.soloGame1, true], [ID.soloGame2, false], [ID.soloGame3, true]];
  const markGame = (seed: number): TrackerDispatchAction[] => [
    { type: 'mark_lead', player: 1, slot: seed % 6 },
    { type: 'mark_lead', player: 2, slot: (seed + 2) % 6 },
    ...[0, 1, 2, 3].flatMap((slot): TrackerDispatchAction[] => [
      { type: 'mark_brought', player: 1, slot },
      { type: 'mark_brought', player: 2, slot },
    ]),
    { type: 'increment_ko_dealt', player: 1, slot: seed % 4 },
    { type: 'mark_ko', player: 2, slot: (seed + 1) % 4 },
    { type: 'increment_ko_dealt', player: 2, slot: (seed + 3) % 4 },
    { type: 'mark_ko', player: 1, slot: (seed + 2) % 4 },
    { type: 'log_move', player: 1, slot: seed % 4, move: own[seed % 4].moves[0] },
  ];
  for (const [index, [gameId, won]] of games.entries()) {
    for (const action of markGame(index)) state = trackerReducer(state, action);
    const game: GameSummary = {
      id: gameId,
      game_number: index + 1,
      winner_id: won ? player1Id : 'solo-opponent',
      replay_url: '',
      source: 'manual',
      stats_locked: false,
    };
    state = trackerReducer(state, { type: 'submit_game', game });
  }
  for (const action of markGame(3)) state = trackerReducer(state, action);
  void adminId;
  return state;
}

async function seedSoloSession(adminId: string): Promise<void> {
  const { data, error } = await supabase
    .from('cast_sessions')
    .upsert(
      {
        id: ID.castSessionSolo,
        owner_id: adminId,
        name: 'Ladder Grind (visual seed)',
        mode: 'solo',
        status: 'live',
        format: 'gen9ou',
        generation: 9,
        player1_id: P('playerAria'),
        player1_name: 'Aria',
        player2_name: 'Ladder Opponent',
        player1_team: VISUAL_SEED_TEAMS.playerAria as unknown as Json,
        player2_team: VISUAL_SEED_SOLO_OPPONENT as unknown as Json,
        tracker_state: soloTrackerState(adminId) as unknown as Json,
        created_at: VISUAL_SEED_DATES.soloSession,
        updated_at: VISUAL_SEED_DATES.soloSession,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw error;
  tally('cast sessions', data.length > 0);
}

// ─── Entry ──────────────────────────────────────────────────────────────────────

export interface VisualSeedReport {
  adminEmail: string;
  counts: VisualSeedCounts;
  aggregateJobsProcessed: number;
  aggregateJobsFailed: number;
}

export async function runVisualSeed(): Promise<VisualSeedReport> {
  const dev = await runDevSeed();
  const adminRow = await supabase.from('players').select('id, name').eq('id', dev.adminPlayerId).single();
  if (adminRow.error) throw adminRow.error;
  const admin: SessionPlayer = {
    playerId: adminRow.data.id,
    name: adminRow.data.name,
    isAdmin: true,
    isResourceAdmin: false,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active',
  };

  await ensurePlayers();
  const versionId = await rulesetVersionId();

  await seedSakuraLeague(versionId, admin);
  await seedEpbLeague(versionId, admin);
  await seedSmallLeague(
    { leagueId: ID.leagueMountain, stageId: ID.stageMountain, roundId: ID.roundMountain1, name: 'Mountain Pass League (visual seed)', theme: 'mountain', players: ['playerCleo', 'playerDario', 'playerElin', 'playerFinn'], matchIds: [ID.matchMountain1, ID.matchMountain2, ID.matchMountain3], day: 3 },
    versionId,
    admin,
  );
  await seedSmallLeague(
    { leagueId: ID.leagueClouds, stageId: ID.stageClouds, roundId: ID.roundClouds1, name: 'Skyisle League (visual seed)', theme: 'clouds', players: ['playerGreta', 'playerHugo', 'playerAria', 'playerBram'], matchIds: [ID.matchClouds1, ID.matchClouds2, ID.matchClouds3], day: 4 },
    versionId,
    admin,
  );
  await seedCustomLeague(versionId, admin);
  await seedDraftLeague(versionId);
  await seedEpbBoardLeague(versionId);
  await seedArchivedLeague(versionId, admin);
  await seedSmallStage(
    { leagueId: '', stageId: ID.tournamentStandalone, roundId: ID.roundStandalone1, name: 'Friday Night Open (visual seed)', theme: 'auto', players: ['playerBram', 'playerDario', 'playerFinn', 'playerHugo'], matchIds: [ID.matchStandalone1, ID.matchStandalone2, ID.matchStandalone3], day: 11 },
    null,
    versionId,
    admin,
  );
  await seedSoloSession(admin.playerId);
  await seedTrashedLeague(versionId, admin);

  const drained = await drainPendingAggregateJobs();
  return { adminEmail: dev.adminEmail, counts, aggregateJobsProcessed: drained.processed, aggregateJobsFailed: drained.failed };
}
