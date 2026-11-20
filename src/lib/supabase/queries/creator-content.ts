import 'server-only';
import type { PublicCompetitionMatch, PublicMatch } from '@/lib/match/public-match';
import type { GameSummary } from '@/types/match';
import { supabase } from '../client';
import type { PhaseStorageMode } from './phase-storage';

const MATCH_LIMIT = 200;
const MATCH_COLUMNS = `
  id, round_id, player_1_id, player_2_id, winner_id, status, date_played, scheduled_at,
  social_image_url, bracket_side, bracket_pos, created_at, updated_at
`;
const GAME_COLUMNS = 'id, game_number, winner_id, replay_url, source, stats_locked';
const LEGACY_SELECT = `
  ${MATCH_COLUMNS}, tournament_id,
  player_1:players!matches_player_1_id_fkey(name, avatar_url),
  player_2:players!matches_player_2_id_fkey(name, avatar_url),
  winner:players!matches_winner_id_fkey(name),
  games(${GAME_COLUMNS}),
  round:rounds!matches_round_id_fkey(status)
`;
const PHASE_OWNER = 'phase:league_phases!phase_matches_phase_id_fkey!inner(season_id)';
const PHASE_SELECT = `
  ${MATCH_COLUMNS}, phase_id, ${PHASE_OWNER},
  player_1:players!phase_matches_player_1_id_fkey(name, avatar_url),
  player_2:players!phase_matches_player_2_id_fkey(name, avatar_url),
  winner:players!phase_matches_winner_id_fkey(name),
  games:phase_games(${GAME_COLUMNS}),
  round:phase_rounds!phase_matches_phase_round_fkey(status)
`;

async function readLegacyMatches(standaloneOnly: boolean, offset = 0) {
  const query = standaloneOnly
    ? supabase.from('matches')
      .select(`${LEGACY_SELECT}, tournament:tournaments!matches_tournament_id_fkey!inner(season_id)`)
      .is('tournament.season_id', null)
      .order('created_at', { ascending: false }).order('id')
      .range(offset, offset + MATCH_LIMIT - 1)
    : supabase.from('matches').select(LEGACY_SELECT)
      .order('created_at', { ascending: false }).limit(MATCH_LIMIT);
  const { data, error } = await query;
  if (error) throw error;
  return data.map((row): PublicMatch => ({ ...matchFields(row), tournament_id: row.tournament_id }));
}

async function readPhaseMatches(): Promise<PublicCompetitionMatch[]> {
  const { data, error } = await supabase.from('phase_matches').select(PHASE_SELECT)
    .order('created_at', { ascending: false }).order('id').limit(MATCH_LIMIT);
  if (error) throw error;
  return data.map((row) => ({
    ...matchFields(row),
    phase_id: row.phase_id,
    season_id: row.phase.season_id,
  }));
}

type MatchFields = Omit<PublicMatch, 'tournament_id' | 'player_1_name' | 'player_2_name'
  | 'player_1_avatar_url' | 'player_2_avatar_url' | 'winner_name' | 'round_status' | 'games'>;
type MatchRow = Omit<MatchFields, 'bracket_side'> & {
  bracket_side: string | null;
  player_1: { name: string; avatar_url: string | null };
  player_2: { name: string; avatar_url: string | null };
  winner: { name: string } | null;
  round: { status: PublicMatch['round_status'] } | null;
  games: (Omit<GameSummary, 'source'> & { source: string })[] | null;
};

function matchFields(row: MatchRow): Omit<PublicMatch, 'tournament_id'> {
  return {
    id: row.id,
    round_id: row.round_id,
    player_1_id: row.player_1_id,
    player_2_id: row.player_2_id,
    winner_id: row.winner_id,
    status: row.status,
    date_played: row.date_played,
    scheduled_at: row.scheduled_at,
    social_image_url: row.social_image_url,
    bracket_side: row.bracket_side as PublicMatch['bracket_side'],
    bracket_pos: row.bracket_pos,
    created_at: row.created_at,
    updated_at: row.updated_at,
    player_1_name: row.player_1.name,
    player_2_name: row.player_2.name,
    player_1_avatar_url: row.player_1.avatar_url ?? null,
    player_2_avatar_url: row.player_2.avatar_url ?? null,
    winner_name: row.winner?.name ?? null,
    round_status: row.round?.status ?? 'pending',
    games: [...(row.games ?? [])].sort((a, b) => a.game_number - b.game_number).map((game) => ({
      id: game.id,
      game_number: game.game_number,
      winner_id: game.winner_id,
      replay_url: game.replay_url,
      source: game.source as GameSummary['source'],
      stats_locked: game.stats_locked ?? false,
    })),
  };
}

function newestFirst(a: PublicCompetitionMatch, b: PublicCompetitionMatch): number {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : Number(a.id > b.id);
}

export async function listContentMatches(mode: PhaseStorageMode): Promise<PublicCompetitionMatch[]> {
  if (mode === 'legacy' || mode === 'frozen_legacy') return readLegacyMatches(false);

  const [phaseMatches, firstPage] = await Promise.all([readPhaseMatches(), readLegacyMatches(true)]);
  const nativeIds = new Set(phaseMatches.map(({ id }) => id));
  let matches = phaseMatches;
  let legacyPage = firstPage;
  let offset = 0;
  while (legacyPage.length > 0) {
    const cutoff = matches[MATCH_LIMIT - 1];
    const candidates = legacyPage.filter((match) =>
      !nativeIds.has(match.id) && (!cutoff || newestFirst(match, cutoff) < 0));

    if (phaseMatches.length === MATCH_LIMIT) {
      for (let start = 0; start < candidates.length; start += 100) {
        const { data, error } = await supabase.from('phase_matches').select(`id, ${PHASE_OWNER}`)
          .in('id', candidates.slice(start, start + 100).map(({ id }) => id));
        if (error) throw error;
        for (const row of data) nativeIds.add(row.id);
      }
    }

    matches = matches.concat(candidates.filter(({ id }) => !nativeIds.has(id)))
      .sort(newestFirst).slice(0, MATCH_LIMIT);
    const last = matches[MATCH_LIMIT - 1];
    if (legacyPage.length < MATCH_LIMIT || (last && newestFirst(legacyPage[legacyPage.length - 1], last) >= 0)) {
      break;
    }
    offset += MATCH_LIMIT;
    legacyPage = await readLegacyMatches(true, offset);
  }
  return matches;
}
