import { supabase } from '@/lib/supabase/client';
import { readAllPages } from '@/lib/supabase/read-all-pages';
import { postgrestQuoted } from '@/lib/supabase/postgrest-filter';
import { assertValidUuid } from '@/lib/utils/uuid';
import {
  applyMatchRatingResult,
  getPlayerRating,
  RatingCurveStaleError,
} from '@/lib/supabase/queries/ratings';
import { getPlayerStreaks, StreaksStaleError } from '@/lib/supabase/queries/streaks';
import { compareReplayOrder } from '@/lib/rating/replay-order';
import type { RatingScope } from '@/lib/rating/rating-scope';
import type { RatingStoragePort, RatingStreamMatch } from '@/lib/rating/storage';
import type { StreakStoragePort } from '@/lib/gamification/streaks';
import type { RatingHistoryEntry } from '@/types/rating';
import type { Json, Tables } from '@/types/database';

export function mergeRatingStreams(
  tournaments: readonly RatingStreamMatch[],
  phases: readonly RatingStreamMatch[]
): RatingStreamMatch[] {
  return [...new Map([...tournaments, ...phases].map((match) => [match.id, match])).values()].sort(compareReplayOrder);
}

async function loadScope(): Promise<RatingScope> {
  const [tournaments, phases] = await Promise.all([
    readAllPages<{ id: string; seasons: { is_test_season: boolean } | null }>((from, to) =>
      supabase.from('tournaments').select('id, seasons(is_test_season)').order('id').range(from, to)),
    readAllPages<{ id: string; seasons: { is_test_season: boolean } }>((from, to) =>
      supabase.from('league_phases').select('id, seasons!inner(is_test_season)').order('id').range(from, to)),
  ]);
  return {
    testSeasonTournamentIds: new Set(tournaments.filter((row) => row.seasons?.is_test_season).map((row) => row.id)),
    testSeasonPhaseIds: new Set(phases.filter((row) => row.seasons.is_test_season).map((row) => row.id)),
  };
}

async function readStream(playerId: string, kind: 'tournament' | 'phase'): Promise<RatingStreamMatch[]> {
  assertValidUuid(playerId, 'playerId');
  const rows: RatingStreamMatch[] = [];
  for (const dated of [true, false]) {
    let cursor: RatingStreamMatch | undefined;
    for (;;) {
      const createdId = cursor
        ? `or(created_at.lt.${postgrestQuoted(cursor.created_at)},and(created_at.eq.${postgrestQuoted(cursor.created_at)},id.lt.${postgrestQuoted(cursor.id)}))`
        : '';
      const after = cursor
        ? dated
          ? `,or(date_played.lt.${postgrestQuoted(cursor.date_played ?? '')},and(date_played.eq.${postgrestQuoted(cursor.date_played ?? '')},${createdId}))`
          : `,${createdId}`
        : '';
      const query = kind === 'phase'
        ? supabase.from('phase_matches').select('id, phase_id, player_1_id, player_2_id, winner_id, confirmed_at, date_played, created_at')
        : supabase.from('matches').select('id, tournament_id, player_1_id, player_2_id, winner_id, confirmed_at, date_played, created_at, tournaments!inner(season_id)').is('tournaments.season_id', null);
      const filtered = query.eq('status', 'completed').or(`and(or(player_1_id.eq.${playerId},player_2_id.eq.${playerId})${after})`);
      const ordered = dated
        ? filtered.not('date_played', 'is', null).order('date_played', { ascending: false })
        : filtered.is('date_played', null);
      const { data, error } = await ordered.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1000);
      if (error) throw error;
      const page: RatingStreamMatch[] = data;
      rows.push(...page);
      if (page.length < 1000) break;
      cursor = page[page.length - 1];
    }
  }
  return rows;
}

async function getCompletedMatches(playerId: string): Promise<RatingStreamMatch[]> {
  const [tournaments, phases] = await Promise.all([readStream(playerId, 'tournament'), readStream(playerId, 'phase')]);
  return mergeRatingStreams(tournaments, phases);
}

async function getHistoryByMatches(
  ids: string[],
  tables: readonly ('rating_history' | 'phase_rating_history')[] = ['rating_history', 'phase_rating_history']
): Promise<RatingHistoryEntry[]> {
  const rows = new Map<string, RatingHistoryEntry>();
  for (let offset = 0; offset < ids.length; offset += 150) {
    const chunk = ids.slice(offset, offset + 150);
    for (const table of tables) {
      const page = await readAllPages<Tables<'rating_history'>>((from, to) =>
        (table === 'rating_history'
          ? supabase.from('rating_history').select('*, matches!inner(tournaments!inner(season_id))').is('matches.tournaments.season_id', null)
          : supabase.from('phase_rating_history').select('*'))
          .in('match_id', chunk).order('id').range(from, to));
      for (const row of page) {
        rows.set(`${row.match_id}:${row.player_id}`, {
          ...row,
          result: row.result as RatingHistoryEntry['result'],
          rating_change: row.rating_change ?? row.rating_after - row.rating_before,
        });
      }
    }
  }
  return [...rows.values()];
}

export function getPhaseRatingHistoryByMatches(ids: string[]): Promise<RatingHistoryEntry[]> {
  return getHistoryByMatches([...new Set(ids)], ['phase_rating_history']);
}

export function createMixedRatingStorage(kind: 'tournament' | 'phase'): RatingStoragePort {
  return {
    requiresCompletionFence: kind === 'phase',
    loadScope,
    getCompletedMatches,
    getPlayerRating,
    getHistoryByMatches,
    getHistoryByMatch: async (id) => {
      const table = kind === 'phase' ? 'phase_rating_history' : 'rating_history';
      const { data, error } = await supabase.from(table).select('*').eq('match_id', id).order('id');
      if (error) throw error;
      return data.map((row) => ({ ...row, result: row.result as RatingHistoryEntry['result'], rating_change: row.rating_change ?? row.rating_after - row.rating_before }));
    },
    countsForRatings: async (id) => {
      assertValidUuid(id, 'matchId');
      if (kind === 'phase') {
        const { data, error } = await supabase.from('phase_matches').select('league_phases!inner(seasons!inner(is_test_season))').eq('id', id).maybeSingle();
        if (error) throw error;
        return data === null ? null : !data.league_phases.seasons.is_test_season;
      }
      const { data, error } = await supabase.from('matches').select('tournaments!inner(season_id)').eq('id', id).maybeSingle();
      if (error) throw error;
      if (data === null) return null;
      if (data.tournaments.season_id !== null) throw new Error('Mixed rating storage accepts standalone tournaments only');
      return true;
    },
    applyMatchResult: async (id, entries, completion) => {
      if (kind === 'tournament') return applyMatchRatingResult(id, entries);
      if (!completion) throw new Error('Phase rating apply requires the expected completion identity');
      const payload = {
        p_match_id: id,
        p_players: entries.map((entry) => ({ player_id: entry.playerId, expected: entry.expected, state: entry.state, history: entry.history })) as unknown as Json,
        p_expected_completion: { winner_id: completion.winnerId, confirmed_at: completion.confirmedAt },
      };
      const { data, error } = await supabase.rpc('phase_rating_apply_match_result', payload);
      if (error) throw error;
      switch (data) {
        case 'applied': case 'already_applied': case 'stale': case 'history_incomplete':
        case 'match_missing': case 'match_not_completed': case 'skipped_test_season': case 'match_changed':
          return data;
        default: throw new Error(`Unexpected phase rating outcome: ${data}`);
      }
    },
    replacePlayerCurve: async (id, state, history, expected, expectedMatches) => {
      if (!expectedMatches) throw new Error('Mixed rating replace requires the expected countable match stream');
      const payload = {
        p_player_id: id,
        p_state: state as unknown as Json,
        p_history: [...history] as unknown as Json,
        p_expected_history_match_ids: [...expected],
        p_expected_matches: expectedMatches.map((match) => ({
          kind: match.phase_id === undefined ? 'tournament' : 'phase',
          match_id: match.id,
          player_1_id: match.player_1_id,
          player_2_id: match.player_2_id,
          winner_id: match.winner_id,
          confirmed_at: match.confirmed_at ?? null,
          date_played: match.date_played,
          created_at: match.created_at,
        })) as Json,
      };
      const { data, error } = await supabase.rpc('rating_replace_player_streams', payload);
      if (error) {
        if (error.code === 'PT409' || error.code === '40001') throw new RatingCurveStaleError(id, error);
        throw error;
      }
      if (data !== history.length) throw new Error('Mixed rating replace wrote an incomplete history');
      return data;
    },
  };
}

export const mixedStreakStorage: StreakStoragePort = {
  loadScope,
  getCompletedMatches,
  getPlayerStreaks,
  getStatTotals: async (id, matchIds, history) => {
    const phases = new Set(history.filter((match) => match.phase_id !== undefined).map((match) => match.id));
    const totals = new Map<string, { total_kos_dealt: number; total_kos_lost: number }>();
    for (const table of ['battle_stats', 'phase_battle_stats'] as const) {
      const rows = await readAllPages<{ id: string; kos_dealt: number; was_koed: boolean; games: { match_id: string } }>((from, to) =>
        (table === 'battle_stats'
          ? supabase.from('battle_stats').select('id, kos_dealt, was_koed, games!inner(match_id)')
          : supabase.from('phase_battle_stats').select('id, kos_dealt, was_koed, games:phase_games!inner(match_id)'))
          .eq('player_id', id).order('id').range(from, to));
      const wanted = new Set(matchIds);
      for (const row of rows) {
        if (!wanted.has(row.games.match_id)) continue;
        if ((table === 'phase_battle_stats') !== phases.has(row.games.match_id)) continue;
        const total = totals.get(row.games.match_id) ?? { total_kos_dealt: 0, total_kos_lost: 0 };
        total.total_kos_dealt += row.kos_dealt;
        total.total_kos_lost += Number(row.was_koed);
        totals.set(row.games.match_id, total);
      }
    }
    return totals;
  },
  replacePlayerStreaks: async (id, state, expected, counted) => {
    const { error } = await supabase.rpc('streaks_replace_player_streams', {
      p_player_id: id,
      p_state: { ...state, last_phase_match_id: state.last_phase_match_id ?? null, counted_match_ids: [...counted] } as Json,
      p_expected_match_ids: [...expected],
    });
    if (error) {
      if (error.code === 'PT409') throw new StreaksStaleError(id, error);
      throw error;
    }
  },
};
