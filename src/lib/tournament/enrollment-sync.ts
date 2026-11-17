import type { AdvancementRule, EnrollmentContribution, EnrollmentSource } from '@/types/season';
import type { BracketType, ParticipantWithSeed } from '@/types/tournament';
import type { RoundByeSource } from './byes';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import {
  getStagesBySeasonId,
  getParticipants,
  getTournamentById,
  replacePhaseEnrollment,
} from '@/lib/supabase/queries/tournaments';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { splitGroupTables } from '@/lib/tournament/group-standings';
import { scoringByeRecords } from '@/lib/tournament/byes';
import type { ByeRecord, MatchRecord } from '@/lib/tournament/types';
import { kitAdvancingPlayers } from '@/lib/format-engine/advance';

export interface EnrollmentPhase {
  id: string;
  season_id: string | null;
  name: string;
  status: 'upcoming' | 'active' | 'completed';
  bracket_type: BracketType;
  stage_order: number;
  advancement_rule: AdvancementRule | null;
  enrollment_source: EnrollmentSource | null;
}

export interface EnrollmentGroup {
  id: string;
  name: string;
  group_number: number;
  season_group_id?: string | null;
  members: { player_id: string }[];
}

export interface EnrollmentPersistence {
  getPhase(id: string): Promise<EnrollmentPhase | null>;
  listPhases(seasonId: string): Promise<EnrollmentPhase[]>;
  getParticipants(id: string): Promise<Pick<ParticipantWithSeed, 'id' | 'name'>[]>;
  getCompletedMatches(id: string): Promise<MatchRecord[]>;
  getGroups(id: string): Promise<EnrollmentGroup[]>;
  getRounds(id: string): Promise<RoundByeSource[]>;
  replaceEnrollment: typeof replacePhaseEnrollment;
  computeStandings: typeof computeStandingsForSeason;
  kitAdvancingPlayers: typeof kitAdvancingPlayers;
}

export const legacyEnrollmentPersistence: EnrollmentPersistence = {
  getPhase: (...args) => getTournamentById(...args),
  listPhases: (...args) => getStagesBySeasonId(...args),
  getParticipants: (...args) => getParticipants(...args),
  getCompletedMatches: (...args) => getCompletedMatchRecords(...args),
  getGroups: (...args) => getGroupsByTournament(...args),
  getRounds: (...args) => getRoundsByTournament(...args),
  replaceEnrollment: (...args) => replacePhaseEnrollment(...args),
  computeStandings: (...args) => computeStandingsForSeason(...args),
  kitAdvancingPlayers: (...args) => kitAdvancingPlayers(...args),
};

export interface SyncStandingsOptions {
  source_phase_id?: string;
  top_n?: number;
  per_group?: boolean;
  force?: boolean;
  /** A kit edge with a `manual_list` selection: the players an admin moves on, in order. */
  manual_list?: string[];
}

export interface SyncStandingsResult {
  enrolled_count: number;
  enrollment_source: EnrollmentSource;
  source_phase_name: string | null;
}

function resolveSourcePhase(
  stages: EnrollmentPhase[],
  phaseId: string,
  sourcePhaseId?: string
): EnrollmentPhase | null {
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
 * The blocks a kit phase is enrolled from after `sourcePhase` moved `incoming` into it. A phase fed by several edges is
 * the sum of its sources: the blocks recorded by earlier syncs stay (in the order the sources contributed), the block of
 * `sourcePhase` replaces its own earlier one in place or comes last, so a later source never drops the entrants of an
 * earlier one. A recorded block counts only while its source phase still exists and is completed: the enrollment a
 * phase got when it was created (from the phase before it, still running) and the block of a deleted phase are not
 * entrants of an edge.
 */
export function mergeKitContributions(
  previous: readonly EnrollmentContribution[] | undefined,
  sourcePhaseId: string,
  incoming: readonly string[],
  stages: readonly Pick<EnrollmentPhase, 'id' | 'status'>[],
): EnrollmentContribution[] {
  const completed = new Set(stages.filter((s) => s.status === 'completed').map((s) => s.id));
  const block: EnrollmentContribution = { source_phase_id: sourcePhaseId, player_ids: [...incoming] };
  const out: EnrollmentContribution[] = [];
  let placed = false;
  for (const c of previous ?? []) {
    if (c.source_phase_id === sourcePhaseId) {
      if (!placed) out.push(block);
      placed = true;
    } else if (completed.has(c.source_phase_id)) {
      out.push(c);
    }
  }
  if (!placed) out.push(block);
  return out;
}

/** The roster of merged blocks: each player once, at the place of the first block that holds him. */
function playersOfContributions(blocks: readonly EnrollmentContribution[]): string[] {
  return [...new Set(blocks.flatMap((b) => b.player_ids))];
}

/**
 * Refuse enrollment sync when frozen or rounds exist unless force is set.
 * Mirrors maybeAutoSyncEnrollment guard logic.
 */
export async function assertEnrollmentSyncAllowed(
  phaseId: string,
  force = false,
  storage: EnrollmentPersistence = legacyEnrollmentPersistence,
): Promise<void> {
  if (force) return;

  const phase = await storage.getPhase(phaseId);
  if (!phase) {
    throw new Error('Phase not found');
  }

  if (phase.enrollment_source?.frozen) {
    throw new UserFacingError(
      'Enrollment is frozen. Confirm to overwrite imported standings.',
      { code: 'ENROLLMENT_FROZEN' }
    );
  }

  const rounds = await storage.getRounds(phaseId);
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
  groups: EnrollmentGroup[] | undefined,
  byes: ByeRecord[],
  storage: EnrollmentPersistence
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
    const table = await storage.computeStandings(seasonId, memberIds, participantNames, matchRecords, {}, { byes });
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
      const standings = await storage.computeStandings(
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

  const standings = await storage.computeStandings(
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
  targetPhase: EnrollmentPhase,
  participantIds: string[],
  participantNames: Record<string, string>,
  matchRecords: MatchRecord[],
  groups: EnrollmentGroup[],
  options: SyncStandingsOptions,
  byes: ByeRecord[],
  storage: EnrollmentPersistence,
): Promise<string[]> {
  if (targetPhase.advancement_rule && !options.top_n) {
    return advanceTopNFromStandings(
      seasonId,
      targetPhase.advancement_rule,
      participantIds,
      participantNames,
      matchRecords,
      groups.length > 0 ? groups : undefined,
      byes,
      storage,
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
      byes,
      storage,
    );
  }

  const standings = await storage.computeStandings(
    seasonId,
    participantIds,
    participantNames,
    matchRecords,
    {},
    { byes }
  );
  return standings.map((s) => s.player_id);
}

/** How often a sync reads and merges again after another sync of the same phase won the write. */
export const ENROLLMENT_SYNC_MAX_ATTEMPTS = 4;

/**
 * Enroll phase participants from league roster or prior phase standings.
 * Placement in standings becomes seed (1 = best).
 *
 * The write is a compare-and-set on the phase's `enrollment_source.synced_at` (`replacePhaseEnrollment`): two sources of
 * one phase that complete together each merge into the blocks they read, and the loser reads and merges again, so neither
 * drops the other's entrants. After `ENROLLMENT_SYNC_MAX_ATTEMPTS` lost races the call refuses with 409
 * `ENROLLMENT_SYNC_CONFLICT` and the caller repeats it.
 */
export async function syncStandingsEnrollment(
  seasonId: string,
  phaseId: string,
  options: SyncStandingsOptions = {},
  storage: EnrollmentPersistence = legacyEnrollmentPersistence,
): Promise<SyncStandingsResult> {
  for (let attempt = 0; attempt < ENROLLMENT_SYNC_MAX_ATTEMPTS; attempt += 1) {
    const result = await syncStandingsEnrollmentOnce(seasonId, phaseId, options, storage);
    if (result !== null) return result;
  }
  throw new UserFacingError(
    'Another enrollment sync of this phase was running at the same time. Try again.',
    { code: 'ENROLLMENT_SYNC_CONFLICT', status: 409 }
  );
}

/** One read-merge-write pass; null when another sync of the phase committed first (nothing was written). */
async function syncStandingsEnrollmentOnce(
  seasonId: string,
  phaseId: string,
  options: SyncStandingsOptions,
  storage: EnrollmentPersistence,
): Promise<SyncStandingsResult | null> {
  const phase = await storage.getPhase(phaseId);
  if (!phase || phase.season_id !== seasonId) {
    throw new Error('Phase not found in this league');
  }

  await assertEnrollmentSyncAllowed(phaseId, options.force ?? false, storage);

  const season = await getSeasonById(seasonId);
  if (!season) throw new Error('League not found');

  const stages = await storage.listPhases(seasonId);
  const sourcePhase = resolveSourcePhase(stages, phaseId, options.source_phase_id);

  let playerIds: string[] = [];
  // The blocks a kit phase is enrolled from; the seed of a player is his place in them.
  let contributions: EnrollmentContribution[] | null = null;
  let sourceType: EnrollmentSource['type'] = 'roster';
  let sourcePhaseId: string | null = null;
  let sourcePhaseName: string | null = null;

  if (sourcePhase) {
    sourceType = 'standings';
    sourcePhaseId = sourcePhase.id;
    sourcePhaseName = sourcePhase.name;

    const participants = await storage.getParticipants(sourcePhase.id);
    const participantIds = participants.map((p) => p.id);
    const participantNames: Record<string, string> = {};
    for (const p of participants) {
      participantNames[p.id] = p.name;
    }
    const matchRecords = await storage.getCompletedMatches(sourcePhase.id);
    const groups = await storage.getGroups(sourcePhase.id);
    // A Swiss source phase scores its stored byes as wins, as its own standings do.
    const byes = scoringByeRecords(
      sourcePhase.bracket_type,
      await storage.getRounds(sourcePhase.id)
    );

    // A kit league moves players along the edge of its attached format that joins the two stages; any other
    // league, or a kit league without such an edge, keeps the phase's advancement rule.
    const kitPlayers =
      season.format_type === 'custom'
        ? await storage.kitAdvancingPlayers({
            seasonId,
            sourcePhaseId: sourcePhase.id,
            targetPhaseId: phaseId,
            participantIds,
            participantNames,
            matches: matchRecords,
            byes,
            groupOf: Object.fromEntries(
              groups.flatMap((group) => group.members.map((m) => [m.player_id, group.group_number] as const))
            ),
            manualList: options.manual_list,
          })
        : null;
    if (kitPlayers) {
      // `kitPlayers` is in the edge's seed order (seeding `rank`, `cross_group`, `random`, `manual`). Other edges into the
      // same phase keep their earlier entrants (see mergeKitContributions).
      contributions = mergeKitContributions(
        phase.enrollment_source?.type === 'standings' ? phase.enrollment_source.contributions : undefined,
        sourcePhase.id,
        kitPlayers.map((p) => p.player_id),
        stages,
      );
      playerIds = playersOfContributions(contributions);
    } else {
      playerIds = await resolveAdvancingPlayerIds(
        seasonId,
        phase,
        participantIds,
        participantNames,
        matchRecords,
        groups,
        options,
        byes,
        storage,
      );
    }
  } else {
    const roster = await getSeasonParticipants(seasonId);
    playerIds = roster.map((p) => p.id);
    sourcePhaseName = season.name;
  }

  const entries = playerIds.map((player_id, index) => ({
    player_id,
    seed: index + 1,
  }));

  const enrollmentSource: EnrollmentSource = {
    type: sourceType,
    source_phase_id: sourcePhaseId,
    synced_at: new Date().toISOString(),
    frozen: phase.enrollment_source?.frozen ?? false,
    ...(contributions ? { contributions } : {}),
  };

  const written = await storage.replaceEnrollment(
    phaseId,
    entries,
    enrollmentSource,
    phase.enrollment_source?.synced_at ?? null,
    options.force ?? false,
  );
  if (!written) return null;

  return {
    enrolled_count: entries.length,
    enrollment_source: enrollmentSource,
    source_phase_name: sourcePhaseName,
  };
}

/**
 * Silent re-sync when enrollment is not frozen and phase has no rounds yet.
 */
export async function maybeAutoSyncEnrollment(phaseId: string, storage: EnrollmentPersistence = legacyEnrollmentPersistence): Promise<SyncStandingsResult | null> {
  const phase = await storage.getPhase(phaseId);
  if (!phase?.season_id) return null;
  if (phase.enrollment_source?.frozen) return null;

  const rounds = await storage.getRounds(phaseId);
  if (rounds.length > 0) return null;

  return syncStandingsEnrollment(phase.season_id, phaseId, {}, storage);
}
