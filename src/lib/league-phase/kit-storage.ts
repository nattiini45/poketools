import 'server-only';

import {
  getKitPhases,
  getOutcomesByPhases,
  getPhaseGameCounts,
  getPhaseMatchIds,
  getPhaseMembers,
  getSeasonKitHead,
  getStandingAdjustments,
  type KitPhaseRow,
  type PhaseOutcomeRow,
} from '@/lib/supabase/queries/format-engine';
import { getPhaseKillTallies } from '@/lib/supabase/queries/games';
import { getParticipantsBatch, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getSeasonFormat } from '@/lib/supabase/queries/season-formats';
import { getFormatRuntime } from '@/lib/supabase/queries/format-runtime';
import { getPlayerRatingsBatch } from '@/lib/supabase/queries/ratings';
import type { EnrollmentSource } from '@/types/season';

export interface KitStoragePort {
  head: typeof getSeasonKitHead;
  format: typeof getSeasonFormat;
  runtime: typeof getFormatRuntime;
  phases(seasonId: string): Promise<KitPhaseRow[]>;
  outcomes(phaseIds: readonly string[]): Promise<Omit<PhaseOutcomeRow, 'tournament_id'>[]>;
  matchIds(phaseIds: readonly string[]): Promise<{ id: string; phase_id: string }[]>;
  members(phaseIds: readonly string[]): Promise<{ phase_id: string; player_id: string }[]>;
  seeds(phaseIds: readonly string[]): Promise<Map<string, { id: string; seed: number | null }[]>>;
  gameCounts: typeof getPhaseGameCounts;
  kills: typeof getPhaseKillTallies;
  adjustments: typeof getStandingAdjustments;
  ratings: typeof getPlayerRatingsBatch;
  phase(id: string): Promise<{ id: string; status: string; enrollment_source?: EnrollmentSource | null } | null>;
  enroll(seasonId: string, targetId: string, sourceId: string): Promise<{ enrolled_count: number }>;
}

export const legacyKitStorage: KitStoragePort = {
  head: (input) => getSeasonKitHead(input),
  format: (input) => getSeasonFormat(input),
  runtime: (input) => getFormatRuntime(input),
  phases: (input) => getKitPhases(input),
  outcomes: (input) => getOutcomesByPhases(input),
  matchIds: async (ids) => (await getPhaseMatchIds(ids)).map((row) => ({ id: row.id, phase_id: row.tournament_id })),
  members: async (ids) => (await getPhaseMembers(ids)).map((row) => ({ phase_id: row.tournament_id, player_id: row.player_id })),
  seeds: (input) => getParticipantsBatch([...input]),
  gameCounts: (input) => getPhaseGameCounts(input),
  kills: (input) => getPhaseKillTallies(input),
  adjustments: (input) => getStandingAdjustments(input),
  ratings: (input) => getPlayerRatingsBatch(input),
  phase: (input) => getTournamentById(input),
  enroll: async (seasonId, targetId, sourceId) => {
    const { syncStandingsEnrollment } = await import('@/lib/tournament/enrollment-sync');
    return syncStandingsEnrollment(seasonId, targetId, { source_phase_id: sourceId });
  },
};

export type NativeKitConsumers = Pick<KitStoragePort, 'outcomes' | 'matchIds' | 'gameCounts' | 'kills' | 'enroll'>;

export function nativeKitStorage(consumers: NativeKitConsumers): KitStoragePort {
  return {
    ...consumers,
    head: (input) => getSeasonKitHead(input),
    format: (input) => getSeasonFormat(input),
    runtime: (input) => getFormatRuntime(input),
    adjustments: (input) => getStandingAdjustments(input),
    ratings: (input) => getPlayerRatingsBatch(input),
    phases: async (id) => {
      const { getPhasesBySeasonId } = await import('@/lib/supabase/queries/league-phases');
      return (await getPhasesBySeasonId(id)).flatMap((phase) => phase.format_stage_key === null ? [] : [{
        id: phase.id,
        format_stage_key: phase.format_stage_key,
        format_group: phase.format_group,
        stage_order: phase.stage_order,
        stage_spec: phase.stage_spec,
      }]);
    },
    members: async (ids) => {
      const { getPhaseParticipantsBatch } = await import('@/lib/supabase/queries/league-phases');
      return [...await getPhaseParticipantsBatch([...ids])].flatMap(([id, players]) => players.map((player) => ({ phase_id: id, player_id: player.id })));
    },
    seeds: async (ids) => {
      const { getPhaseParticipantsBatch } = await import('@/lib/supabase/queries/league-phases');
      return getPhaseParticipantsBatch([...ids]);
    },
    phase: async (id) => {
      const { getPhaseById } = await import('@/lib/supabase/queries/league-phases');
      return getPhaseById(id);
    },
  };
}
