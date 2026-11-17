import { z } from 'zod';
import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';
import type { RebuildMatch } from '@/lib/reconcile/evolution-rebuild';
import type { GameKillCredit } from './evolutions';
import type { Json } from '@/types/database';

const registeredTeamSchema = z.array(z.object({ species: z.string().min(1) }));
const bracketSideSchema = z.enum(['winners', 'losers', 'grand_finals']).nullable();
const movesUsedSchema = z.array(z.string());

export async function getPhaseRegisteredSpeciesByMatches(
  matchIds: readonly string[]
): Promise<Map<string, Map<string, string[]>>> {
  const out = new Map<string, Map<string, string[]>>();
  const ids = [...new Set(matchIds)];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const rows = await readAllPages((from, to) => supabase
      .from('phase_match_prep_teams')
      .select('id, match_id, player_id, pokemon')
      .in('match_id', ids.slice(offset, offset + 200))
      .order('id').range(from, to));
    for (const row of rows) {
      const species = registeredTeamSchema.parse(row.pokemon).map((set) => set.species);
      const players = out.get(row.match_id) ?? new Map<string, string[]>();
      players.set(row.player_id, species);
      out.set(row.match_id, players);
    }
  }
  return out;
}

export async function getPhaseRegisteredSpeciesByMatch(matchId: string): Promise<Map<string, string[]>> {
  return (await getPhaseRegisteredSpeciesByMatches([matchId])).get(matchId) ?? new Map();
}

export async function loadPhaseEpbSeasonMatches(seasonId: string): Promise<RebuildMatch[]> {
  const phases = await readAllPages((from, to) => supabase.from('league_phases')
    .select('id').eq('season_id', seasonId).order('id').range(from, to));
  const out: RebuildMatch[] = [];
  for (let offset = 0; offset < phases.length; offset += 200) {
    const matches = await readAllPages((from, to) => supabase.from('phase_matches')
      .select('*, rounds:phase_rounds!phase_matches_phase_round_fkey(round_number)')
      .in('phase_id', phases.slice(offset, offset + 200).map((phase) => phase.id))
      .eq('status', 'completed').not('winner_id', 'is', null).order('id').range(from, to));
    for (let start = 0; start < matches.length; start += 200) {
      const chunk = matches.slice(start, start + 200);
      const ids = chunk.map((match) => match.id);
      const games = await readAllPages((from, to) => supabase.from('phase_games')
        .select('id, match_id').in('match_id', ids).order('id').range(from, to));
      const stats = [];
      for (let gameOffset = 0; gameOffset < games.length; gameOffset += 200) {
        stats.push(...await readAllPages((from, to) => supabase.from('phase_battle_stats')
          .select('*').in('game_id', games.slice(gameOffset, gameOffset + 200).map((game) => game.id))
          .order('id').range(from, to)));
      }
      const registered = await getPhaseRegisteredSpeciesByMatches(ids);
      for (const row of chunk) {
        const { rounds, ...matchRow } = row;
        const match = { ...matchRow, bracket_side: bracketSideSchema.parse(matchRow.bracket_side) };
        const matchday = rounds?.round_number ?? 0;
        if (matchday < 1) continue;
        const gameIds = games.filter((game) => game.match_id === match.id).map((game) => game.id);
        const gameSet = new Set(gameIds);
        const battleStats = stats.filter((stat) => gameSet.has(stat.game_id))
          .map((stat) => ({ ...stat, moves_used: movesUsedSchema.parse(stat.moves_used) }));
        const registeredSpecies = registered.get(match.id) ?? new Map<string, string[]>();
        if (!battleStats.length && ![...registeredSpecies.values()].some((species) => species.length)) continue;
        out.push({ match, source: 'phase', gameIds, matchday, battleStats, registeredSpecies });
      }
    }
  }
  return out;
}

export async function syncMixedEpbGameKillCredit(
  seasonId: string,
  epoch: number,
  legacyMatchIds: readonly string[],
  legacyCredits: Readonly<Record<string, readonly GameKillCredit[]>>,
  phaseMatchIds: readonly string[],
  phaseCredits: Readonly<Record<string, readonly GameKillCredit[]>>
): Promise<{ status: 'synced' } | { status: 'stale'; reason: string }> {
  const { data, error } = await supabase.rpc('epb_sync_mixed_game_kill_credit', {
    p_season_id: seasonId,
    p_expected_epoch: epoch,
    p_legacy_match_ids: [...legacyMatchIds],
    p_legacy_game_credits: legacyCredits as unknown as Json,
    p_phase_match_ids: [...phaseMatchIds],
    p_phase_game_credits: phaseCredits as unknown as Json,
  });
  if (error) throw error;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.status === 'synced') return { status: 'synced' };
    if (data.status === 'stale' && typeof data.reason === 'string') {
      return { status: 'stale', reason: data.reason };
    }
  }
  throw new Error('epb_sync_mixed_game_kill_credit returned an unexpected result');
}
