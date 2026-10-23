import type { AdvancementRule, EnrollmentSource } from '@/types/season';
import type { TournamentGroupWithMembers } from '@/types/season';
import type { Tournament } from '@/types/tournament';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import {
  getStagesBySeasonId,
  getParticipants,
  getTournamentById,
  replacePhaseParticipants,
  setEnrollmentSource,
} from '@/lib/supabase/queries/tournaments';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { splitGroupTables } from '@/lib/tournament/group-standings';
import { scoringByeRecords } from '@/lib/tournament/byes';
import type { ByeRecord, MatchRecord } from '@/lib/tournament/types';

export interface SyncStandingsOptions {
  source_phase_id?: string;
  top_n?: number;
  per_group?: boolean;
  force?: boolean;
}

export interface SyncStandingsResult {
  enrolled_count: number;
  enrollment_source: EnrollmentSource;
  source_phase_name: string | null;
}

function resolveSourcePhase(
  stages: Tournament[],
  phaseId: string,
  sourcePhaseId?: string
): Tournament | null {
  if (sourcePhaseId) {
    return stages.find((s) => s.id === sourcePhaseId) ?? null;
  }
  const target = stages.find((s) => s.id === phaseId);
  if (!target) return null;
  const prior = stages
    .filter((s) => s.stage_order < target.stage_order)
    .sort((a, b) => b.stage_order - a.stage_order);
  return prior[0] ?? null;
}

/**
 * Refuse enrollment sync when frozen or rounds exist unless force is set.
 * Mirrors maybeAutoSyncEnrollment guard logic.
 */
export async function assertEnrollmentSyncAllowed(
  phaseId: string,
  force = false
): Promise<void> {
  if (force) return;

  const phase = await getTournamentById(phaseId);
  if (!phase) {
    throw new Error('Phase not found');
  }

  if (phase.enrollment_source?.frozen) {
    throw new UserFacingError(
      'Enrollment is frozen. Confirm to overwrite imported standings.',
      { code: 'ENROLLMENT_FROZEN' }
    );
  }

  const rounds = await getRoundsByTournament(phaseId);
  if (rounds.length > 0) {
    throw new UserFacingError(
      'Enrollment cannot be re-synced while rounds exist. Confirm to overwrite.',
      { code: 'ENROLLMENT_ROUNDS_EXIST' }
    );
  }
}

async function advanceTopNFromStandings(
  seasonId: string,
  rule: AdvancementRule,
  participantIds: string[],
  participantNames: Record<string, string>,
  matchRecords: MatchRecord[],
  groups?: TournamentGroupWithMembers[],
  byes: ByeRecord[] = []
): Promise<string[]> {
  if (rule.type !== 'top_n') {
    throw new Error(`Unsupported advancement type: ${rule.type}`);
  }

  const advancing: string[] = [];

  // Groups that mirror league groups: a group table counts every match of its members, cross-group matches
  // included (group-standings.ts), so one table over the whole phase is split per group.
  if (rule.per_group && groups && groups.length > 0 && groups.every((group) => Boolean(group.season_group_id))) {
    const ordered = [...groups].sort((a, b) => a.group_number - b.group_number);
    const memberIds = ordered.flatMap((group) => group.members.map((m) => m.player_id));
    // A Swiss bye scores for its player only, so the one table over every member stays group-scoped after the split.
    const table = await computeStandingsForSeason(seasonId, memberIds, participantNames, matchRecords, {}, { byes });
    for (const { standings } of splitGroupTables(
      table,
      ordered.map((group) => ({ id: group.id, name: group.name, playerIds: group.members.map((m) => m.player_id) })),
    )) {
      advancing.push(...standings.slice(0, rule.count).map((s) => s.player_id));
    }
    return advancing;
  }

  if (rule.per_group && groups && groups.length > 0) {
    for (const group of groups) {
      const groupPlayerIds = group.members.map((m) => m.player_id);
      const groupMatches = matchRecords.filter(
        (m) =>
          groupPlayerIds.includes(m.player_1_id) &&
          groupPlayerIds.includes(m.player_2_id)
      );
      const standings = await computeStandingsForSeason(
        seasonId,
        groupPlayerIds,
        participantNames,
        groupMatches,
        {},
        { byes }
      );
      advancing.push(...standings.slice(0, rule.count).map((s) => s.player_id));
    }
    return advancing;
  }

  const standings = await computeStandingsForSeason(
    seasonId,
    participantIds,
    participantNames,
    matchRecords,
    {},
    { byes }
  );
  return standings.slice(0, rule.count).map((s) => s.player_id);
}

async function resolveAdvancingPlayerIds(
  seasonId: string,
  targetPhase: Tournament,
  participantIds: string[],
  participantNames: Record<string, string>,
  matchRecords: MatchRecord[],
  groups: TournamentGroupWithMembers[],
  options: SyncStandingsOptions,
  byes: ByeRecord[]
): Promise<string[]> {
  if (targetPhase.advancement_rule && !options.top_n) {
    return advanceTopNFromStandings(
      seasonId,
      targetPhase.advancement_rule,
      participantIds,
      participantNames,
      matchRecords,
      groups.length > 0 ? groups : undefined,
      byes
    );
  }

  if (options.top_n) {
    const rule: AdvancementRule = {
      type: 'top_n',
      count: options.top_n,
      per_group: options.per_group ?? false,
    };
    return advanceTopNFromStandings(
      seasonId,
      rule,
      participantIds,
      participantNames,
      matchRecords,
      options.per_group ? groups : undefined,
      byes
    );
  }

  const standings = await computeStandingsForSeason(
    seasonId,
    participantIds,
    participantNames,
    matchRecords,
    {},
    { byes }
  );
  return standings.map((s) => s.player_id);
}

/**
 * Enroll phase participants from league roster or prior phase standings.
 * Placement in standings becomes seed (1 = best).
 */
export async function syncStandingsEnrollment(
  seasonId: string,
  phaseId: string,
  options: SyncStandingsOptions = {}
): Promise<SyncStandingsResult> {
  const phase = await getTournamentById(phaseId);
  if (!phase || phase.season_id !== seasonId) {
    throw new Error('Phase not found in this league');
  }

  await assertEnrollmentSyncAllowed(phaseId, options.force ?? false);

  const season = await getSeasonById(seasonId);
  if (!season) throw new Error('League not found');

  const stages = await getStagesBySeasonId(seasonId);
  const sourcePhase = resolveSourcePhase(stages, phaseId, options.source_phase_id);

  let playerIds: string[] = [];
  let sourceType: EnrollmentSource['type'] = 'roster';
  let sourcePhaseId: string | null = null;
  let sourcePhaseName: string | null = null;

  if (sourcePhase) {
    sourceType = 'standings';
    sourcePhaseId = sourcePhase.id;
    sourcePhaseName = sourcePhase.name;

    const participants = await getParticipants(sourcePhase.id);
    const participantIds = participants.map((p) => p.id);
    const participantNames: Record<string, string> = {};
    for (const p of participants) {
      participantNames[p.id] = p.name;
    }
    const matchRecords = await getCompletedMatchRecords(sourcePhase.id);
    const groups = await getGroupsByTournament(sourcePhase.id);
    // A Swiss source phase scores its stored byes as wins, as its own standings do.
    const byes = scoringByeRecords(
      sourcePhase.bracket_type,
      await getRoundsByTournament(sourcePhase.id)
    );

    playerIds = await resolveAdvancingPlayerIds(
      seasonId,
      phase,
      participantIds,
      participantNames,
      matchRecords,
      groups,
      options,
      byes
    );
  } else {
    const roster = await getSeasonParticipants(seasonId);
    playerIds = roster.map((p) => p.id);
    sourcePhaseName = season.name;
  }

  const entries = playerIds.map((player_id, index) => ({
    player_id,
    seed: index + 1,
  }));

  await replacePhaseParticipants(phaseId, entries);

  const enrollmentSource: EnrollmentSource = {
    type: sourceType,
    source_phase_id: sourcePhaseId,
    synced_at: new Date().toISOString(),
    frozen: phase.enrollment_source?.frozen ?? false,
  };

  await setEnrollmentSource(phaseId, enrollmentSource);

  return {
    enrolled_count: entries.length,
    enrollment_source: enrollmentSource,
    source_phase_name: sourcePhaseName,
  };
}

/**
 * Silent re-sync when enrollment is not frozen and phase has no rounds yet.
 */
export async function maybeAutoSyncEnrollment(phaseId: string): Promise<SyncStandingsResult | null> {
  const phase = await getTournamentById(phaseId);
  if (!phase?.season_id) return null;
  if (phase.enrollment_source?.frozen) return null;

  const rounds = await getRoundsByTournament(phaseId);
  if (rounds.length > 0) return null;

  return syncStandingsEnrollment(phase.season_id, phaseId);
}
