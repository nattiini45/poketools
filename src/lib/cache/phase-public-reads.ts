import 'server-only';

import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import type { PublicMatch } from '@/lib/match/public-match';
import { toPublicTournamentParticipant } from '@/lib/players/public-player';
import { publicTags } from '@/lib/revalidation';
import { getPhaseParticipants, getPhaseWithDetails, getPhasesBySeasonIds } from '@/lib/supabase/queries/league-phases';
import { getGroupsByPhase } from '@/lib/supabase/queries/phase-groups';
import { getMatchesByPhase, getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { getPhaseReports } from '@/lib/supabase/queries/phase-reports';
import { getRoundsByPhase } from '@/lib/supabase/queries/phase-rounds';
import type { PhaseWithDetails } from '@/types/league-phase';
import type { PhaseMatchWithRoundNumber } from '@/types/league-phase-match';
import type { PhaseReport } from '@/types/phase-report';

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

export interface PublicPhaseMatch extends Omit<PublicMatch, 'tournament_id'> {
  phase_id: string;
  round_number?: number;
}

function toPublicPhaseMatch(match: PhaseMatchWithRoundNumber): PublicPhaseMatch {
  return {
    id: match.id,
    phase_id: match.phase_id,
    round_id: match.round_id,
    player_1_id: match.player_1_id,
    player_2_id: match.player_2_id,
    winner_id: match.winner_id,
    status: match.status,
    date_played: match.date_played,
    scheduled_at: match.scheduled_at,
    social_image_url: match.social_image_url,
    bracket_side: match.bracket_side,
    bracket_pos: match.bracket_pos,
    created_at: match.created_at,
    updated_at: match.updated_at,
    player_1_name: match.player_1_name,
    player_2_name: match.player_2_name,
    player_1_avatar_url: match.player_1_avatar_url,
    player_2_avatar_url: match.player_2_avatar_url,
    winner_name: match.winner_name,
    round_status: match.round_status,
    ...(match.round_number === undefined ? {} : { round_number: match.round_number }),
    games: match.games.map(game => ({
      id: game.id,
      game_number: game.game_number,
      winner_id: game.winner_id,
      replay_url: game.replay_url,
      source: game.source,
      stats_locked: game.stats_locked,
    })),
  };
}

export type PublicPhaseReport = Pick<
  PhaseReport, 'id' | 'phase_id' | 'round_id' | 'report_type' | 'content' | 'created_at' | 'updated_at'
> & { status: 'completed' };

const detail = cache((seasonId: string, phaseId: string) =>
  cachedRead('detail', [seasonId, phaseId], [publicTags.phase(phaseId), publicTags.season(seasonId)], async () => {
    const phase = await getPhaseWithDetails(phaseId);
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

const participants = cache((phaseId: string) =>
  cachedRead('participants', [phaseId], [publicTags.phase(phaseId), publicTags.players], async () =>
    (await getPhaseParticipants(phaseId)).map(toPublicTournamentParticipant),
  ),
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
    (await getPhaseReports(phaseId)).flatMap(report => report.status === 'completed' ? [{
      id: report.id,
      phase_id: report.phase_id,
      round_id: report.round_id,
      report_type: report.report_type,
      content: report.content,
      status: report.status,
      created_at: report.created_at,
      updated_at: report.updated_at,
    }] : []),
  ),
);

export const phasePublicReads = { detail, bySeasonIds, rounds, matches, match, participants, groups, reports } as const;
