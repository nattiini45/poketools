import 'server-only';

import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { toPublicPhaseReport, type PublicPhaseReport } from '@/lib/league-phase/public-report';
import { loadNativeKitStandingsData } from '@/lib/league-phase/standings-context';
import { getNativeLeagueStandingsPreview } from '@/lib/stats/standings-preview';
import { toPublicPhaseMatch } from '@/lib/match/public-match';
import { toPublicTournamentParticipant } from '@/lib/players/public-player';
import { publicTags } from '@/lib/revalidation';
import { getPhaseParticipants, getPhaseWithDetails, getPhasesBySeasonIds } from '@/lib/supabase/queries/league-phases';
import { getHiddenPlayerIds } from '@/lib/supabase/queries/players';
import { getTotalGamesInMixedScope } from '@/lib/supabase/queries/aggregates';
import { getCompletedPhaseMatchRecordsBatch } from '@/lib/supabase/queries/phase-format-runtime';
import { getGroupsByPhase } from '@/lib/supabase/queries/phase-groups';
import { getPhaseSeasonBattleStats, getPhaseSeasonGameTotal, getPhaseStandingsBattleStats } from '@/lib/supabase/queries/phase-games';
import { getMatchesByPhase, getPhaseHeadToHead, getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { getPhaseReports } from '@/lib/supabase/queries/phase-reports';
import { getRoundsByPhase, getSwissByeRoundsBySeason } from '@/lib/supabase/queries/phase-rounds';
import type { PhaseWithDetails } from '@/types/league-phase';
export { toPublicPhaseMatch, type PublicPhaseMatch } from '@/lib/match/public-match';

const DETAIL_TTL_S = 30;
const SEASON_BATCH_SIZE = 50;

function cachedRead<T>(name: string, ids: string[], tags: string[], read: () => Promise<T>): Promise<T> {
  return unstable_cache(read, ['phase-public-read:v1', name, JSON.stringify(ids)], {
    tags,
    revalidate: DETAIL_TTL_S,
  })();
}

export type PublicPhase = Omit<PhaseWithDetails, 'stage_spec' | 'enrollment_source'>;

function toPublicPhase(phase: PhaseWithDetails): PublicPhase {
  return {
    id: phase.id,
    name: phase.name,
    description: phase.description,
    season_id: phase.season_id,
    season_name: phase.season_name,
    season_format_type: phase.season_format_type ?? null,
    bracket_type: phase.bracket_type,
    ruleset_id: phase.ruleset_id,
    ruleset_name: phase.ruleset_name,
    best_of_default: phase.best_of_default,
    bo_overrides: phase.bo_overrides,
    is_doubles: phase.is_doubles,
    team_visibility: phase.team_visibility,
    status: phase.status,
    current_round: phase.current_round,
    stage_order: phase.stage_order,
    advancement_rule: phase.advancement_rule,
    archived: phase.archived,
    legacy: phase.legacy,
    bracket_reset_enabled: phase.bracket_reset_enabled,
    third_place_enabled: phase.third_place_enabled,
    format_stage_key: phase.format_stage_key,
    format_group: phase.format_group,
    participant_count: phase.participant_count,
    created_at: phase.created_at,
    updated_at: phase.updated_at,
  };
}

const detail = cache((seasonId: string, phaseId: string) =>
  cachedRead('detail', [seasonId, phaseId], [publicTags.phase(phaseId), publicTags.season(seasonId)], async () => {
    const phase = await getPhaseWithDetails(phaseId, seasonId);
    return phase?.season_id === seasonId ? toPublicPhase(phase) : null;
  }),
);

const seasonBatch = cache((...ids: string[]) =>
  cachedRead('season-batch', ids, ids.map(publicTags.season), async (): Promise<Record<string, PublicPhase[]>> => {
    const grouped = await getPhasesBySeasonIds(ids);
    return Object.fromEntries(ids.map(id => [id, (grouped.get(id) ?? []).map(toPublicPhase)]));
  }),
);

async function bySeasonIds(seasonIds: readonly string[]): Promise<Record<string, PublicPhase[]>> {
  const ids = [...new Set(seasonIds)].sort();
  const chunks: Record<string, PublicPhase[]>[] = [];
  for (let offset = 0; offset < ids.length; offset += SEASON_BATCH_SIZE) {
    chunks.push(await seasonBatch(...ids.slice(offset, offset + SEASON_BATCH_SIZE)));
  }
  return Object.fromEntries(chunks.flatMap(chunk => Object.entries(chunk)));
}

const rounds = cache((phaseId: string) =>
  cachedRead('rounds', [phaseId], [publicTags.phase(phaseId)], () => getRoundsByPhase(phaseId)),
);

const matches = cache((phaseId: string) =>
  cachedRead('matches', [phaseId], [publicTags.phase(phaseId), publicTags.players], async () =>
    (await getMatchesByPhase(phaseId)).map(toPublicPhaseMatch),
  ),
);

const match = cache((phaseId: string, matchId: string) =>
  cachedRead('match', [phaseId, matchId], [publicTags.phase(phaseId), publicTags.players], async () => {
    const row = await getPhaseMatchById(matchId);
    return row?.phase_id === phaseId ? toPublicPhaseMatch(row) : null;
  }),
);

const headToHeadPair = cache((phaseId: string, low: string, high: string) =>
  cachedRead('head-to-head', [phaseId, low, high], [publicTags.phase(phaseId)], async () =>
    (await getPhaseHeadToHead(phaseId, low, high)).map(row => ({
      id: row.id,
      phase_id: row.phase_id,
      winner_id: row.winner_id,
      games: row.games.map(game => ({ winner_id: game.winner_id })),
    })),
  ),
);

function headToHead(phaseId: string, playerA: string, playerB: string) {
  const [low, high] = [playerA.toLowerCase(), playerB.toLowerCase()].sort();
  return headToHeadPair(phaseId.toLowerCase(), low, high);
}

const participants = cache((phaseId: string) =>
  cachedRead('participants', [phaseId], [publicTags.phase(phaseId), publicTags.players], async () => {
    const [rows, hidden] = await Promise.all([getPhaseParticipants(phaseId), getHiddenPlayerIds()]);
    const participants = rows.map(toPublicTournamentParticipant);
    if (hidden.length === 0) return participants;
    const hide = new Set(hidden);
    return participants.filter((participant) => !hide.has(participant.id));
  }),
);

const groups = cache((phaseId: string) =>
  cachedRead('groups', [phaseId], [publicTags.phase(phaseId), publicTags.players], async () =>
    (await getGroupsByPhase(phaseId)).map(group => ({
      id: group.id,
      phase_id: group.phase_id,
      season_id: group.season_id,
      name: group.name,
      group_number: group.group_number,
      season_group_id: group.season_group_id,
      created_at: group.created_at,
      updated_at: group.updated_at,
      members: group.members.map(member => ({
        player_id: member.player_id,
        player_name: member.player_name,
        seed: member.seed,
        gym_type: member.gym_type,
      })),
    })),
  ),
);

const reports = cache((phaseId: string) =>
  cachedRead('reports', [phaseId], [publicTags.phase(phaseId)], async (): Promise<PublicPhaseReport[]> =>
    (await getPhaseReports(phaseId)).filter(report => report.status === 'completed').map(toPublicPhaseReport),
  ),
);

const battleStats = cache((phaseId: string) =>
  cachedRead('battle-stats', [phaseId], [publicTags.phase(phaseId)], () => getPhaseStandingsBattleStats(phaseId)),
);

const seasonKitStandings = cache((seasonId: string) =>
  cachedRead('season-kit-standings', [seasonId], [publicTags.season(seasonId), publicTags.ratings], async () =>
    (await loadNativeKitStandingsData(seasonId)) ?? null,
  ),
);

const seasonGameTotal = cache((seasonId: string) =>
  cachedRead('season-game-total', [seasonId], [publicTags.season(seasonId), publicTags.aggregates('league', seasonId)], () =>
    getPhaseSeasonGameTotal(seasonId),
  ),
);

const seasonBattleStats = cache((seasonId: string) =>
  cachedRead('season-battle-stats', [seasonId], [publicTags.season(seasonId)], () => getPhaseSeasonBattleStats(seasonId)),
);

const allTimeGameTotal = cache(() =>
  unstable_cache(() => getTotalGamesInMixedScope('all_time', null), ['phase-public-read:v1', 'all-time-game-total'], {
    tags: [publicTags.aggregates('all_time', null)],
    revalidate: 60,
  })(),
);

const seasonByeRounds = cache((seasonId: string) =>
  cachedRead('season-bye-rounds', [seasonId], [publicTags.season(seasonId)], () => getSwissByeRoundsBySeason(seasonId)),
);

function seasonMatchRecords(seasonId: string, tablePhaseIds: string[]) {
  return cachedRead('season-match-records', [seasonId, ...tablePhaseIds], [publicTags.season(seasonId)], async () =>
    [...(await getCompletedPhaseMatchRecordsBatch(tablePhaseIds)).values()].flat(),
  );
}

const seasonStandingsPreview = cache((seasonId: string, limit: number) =>
  cachedRead('season-standings-preview', [seasonId, String(limit)], [publicTags.season(seasonId), publicTags.players, publicTags.ratings], () =>
    getNativeLeagueStandingsPreview(seasonId, limit),
  ),
);

export const phasePublicReads = {
  detail, bySeasonIds, rounds, matches, match, headToHead, participants, groups, reports, battleStats,
  seasonGameTotal, seasonBattleStats, allTimeGameTotal, seasonByeRounds, seasonMatchRecords, seasonKitStandings, seasonStandingsPreview,
} as const;
