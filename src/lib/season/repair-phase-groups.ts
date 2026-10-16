import { z } from 'zod';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { listAuditLogEntries } from '@/lib/audit/queries';
import type { AuditAction } from '@/lib/audit/log';
import { getParticipants } from '@/lib/supabase/queries/tournaments';
import { getTournamentPairings } from '@/lib/supabase/queries/matches';
import {
  getGroupsByTournament,
  handOverGroupRow,
} from '@/lib/supabase/queries/tournament-groups';
import {
  planGroupRepair,
  type GroupRepairFixturesSummary,
  type GroupRepairHistorySummary,
  type GroupRepairMove,
  type GroupRepairMoveRef,
  type GroupRepairPlan,
  type GroupRepairResult,
  type GroupRepairSubstitution,
} from './group-repair';

const SUBSTITUTE_ACTION: AuditAction = 'season.participant.substitute';

/** Audit entries per page (the audit query schema's own maximum). */
const AUDIT_PAGE_SIZE = 100;

/**
 * Pages read at most: 2000 substitutions in one league. Past that the oldest
 * records are not read, and the result says so (`history.truncated`).
 */
const AUDIT_MAX_PAGES = 20;

/** The payload `POST /api/seasons/[id]/participants/substitute` records. */
const substituteEntrySchema = z.object({
  changes: z.object({
    out_player_id: z.object({ before: z.string().min(1), after: z.string().min(1) }),
  }),
  metadata: z.object({
    scope: z.string().min(1),
    // Recorded since 2026-10: the phases the substitution handed over.
    phase_ids: z.array(z.string().min(1)).optional(),
  }),
  created_at: z.string().min(1),
});

interface SubstitutionHistory {
  substitutions: GroupRepairSubstitution[];
  summary: GroupRepairHistorySummary;
}

/**
 * The season's recorded substitutions. The audit read returns newest first
 * (`created_at` descending) in offset pages; the planner orders them itself.
 * An entry recorded while paging shifts the pages by one, so a later page can
 * repeat an entry: entries are deduplicated by id.
 */
async function loadSubstitutionHistory(seasonId: string): Promise<SubstitutionHistory> {
  const seen = new Set<string>();
  const substitutions: GroupRepairSubstitution[] = [];
  let unreadable = 0;
  let exhausted = false;

  for (let page = 0; page < AUDIT_MAX_PAGES && !exhausted; page++) {
    const offset = page * AUDIT_PAGE_SIZE;
    const result = await listAuditLogEntries({
      action: SUBSTITUTE_ACTION,
      resource_type: 'season',
      resource_id: seasonId,
      limit: AUDIT_PAGE_SIZE,
      offset,
    });
    for (const entry of result.entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const parsed = substituteEntrySchema.safeParse(entry);
      if (!parsed.success) {
        unreadable += 1;
        continue;
      }
      substitutions.push({
        out_player_id: parsed.data.changes.out_player_id.before,
        in_player_id: parsed.data.changes.out_player_id.after,
        scope: parsed.data.metadata.scope,
        ...(parsed.data.metadata.phase_ids ? { phase_ids: parsed.data.metadata.phase_ids } : {}),
        created_at: parsed.data.created_at,
      });
    }
    exhausted = result.entries.length < AUDIT_PAGE_SIZE || offset + AUDIT_PAGE_SIZE >= result.total;
  }

  return {
    substitutions,
    summary: { substitutions: substitutions.length, unreadable, truncated: !exhausted },
  };
}

/**
 * What an apply wrote, filled as it runs so the caller can record it after a
 * failure: each move is its own write, the moves before a failure have
 * landed, and a re-run no longer plans them.
 */
export interface GroupRepairApplyLog {
  /** Moves handed over as planned, in order. */
  written: GroupRepairMove[];
  /**
   * The move whose handover was running when the apply stopped; null when
   * none failed. `written` is true when its row did move (the target had
   * been placed in another group meanwhile, so it now holds two rows);
   * false when the handover wrote nothing or threw. `held_group_ids` are the
   * groups the target held a row in when it stopped (empty when it threw).
   */
  stopped_at: { move: GroupRepairMove; written: boolean; held_group_ids: string[] } | null;
}

interface RepairPhaseGroupsTarget {
  seasonId: string;
  phaseId: string;
}

export type RepairPhaseGroupsInput =
  | (RepairPhaseGroupsTarget & { dryRun: true })
  | (RepairPhaseGroupsTarget & {
      dryRun: false;
      /** The plan the admin reviewed: the fresh plan must hand over exactly these rows. */
      reviewed: readonly GroupRepairMoveRef[];
      log?: GroupRepairApplyLog;
    });

function moveKey(move: GroupRepairMoveRef): string {
  return `${move.group_id}:${move.from_player_id}:${move.to_player_id}`;
}

/** True when both lists name the same handovers (order aside). */
function sameMoves(planned: readonly GroupRepairMoveRef[], reviewed: readonly GroupRepairMoveRef[]): boolean {
  const plannedKeys = planned.map(moveKey).sort();
  const reviewedKeys = reviewed.map(moveKey).sort();
  return (
    plannedKeys.length === reviewedKeys.length &&
    plannedKeys.every((key, index) => key === reviewedKeys[index])
  );
}

/**
 * Plan (and, unless `dryRun`, apply) the repair of a phase's group rows left
 * by substitutions from before the group handover (see `./group-repair.ts`).
 * The caller checks that the phase belongs to the season.
 *
 * A phase without groups reads nothing else. An apply plans afresh from the
 * current rows and writes only when that plan hands over exactly the rows the
 * admin reviewed; otherwise it writes nothing and stops with 409
 * `PLAN_CHANGED` (check again). Applying hands each planned row over with
 * `handOverGroupRow`: one conditional UPDATE of that member row, which
 * writes only while the departed player still holds it and the target holds
 * no row in the phase, and deletes nothing. The plan check and the writes
 * are not one transaction, so each move re-checks its own row: one that
 * changed since the plan (a concurrent group edit, or a second apply of the
 * same plan that got there first) writes nothing and stops the apply with
 * 409 `PLAN_CHANGED`. A target placed in another group between that check
 * and the UPDATE ends with two rows: the apply stops with 409
 * `GROUP_SLOT_CHANGED`. Each move is its own write; after a failure the moves
 * before it have landed (`input.log` lists them), and a re-run plans only
 * what is still open.
 */
export async function repairPhaseGroups(input: RepairPhaseGroupsInput): Promise<GroupRepairResult> {
  const { seasonId, phaseId } = input;

  const groups = await getGroupsByTournament(phaseId);
  let plan: GroupRepairPlan;
  let historySummary: GroupRepairHistorySummary;
  let fixturesSummary: GroupRepairFixturesSummary;
  if (groups.length === 0) {
    plan = planGroupRepair({ phaseId, groups, enrolled: [], substitutions: [], matches: [] });
    historySummary = { substitutions: 0, unreadable: 0, truncated: false };
    fixturesSummary = { matches: 0, truncated: false };
  } else {
    // The fixtures: every pairing in the phase, paged and ordered (a capped,
    // unordered read would vote on an arbitrary subset); a read that stops
    // at its bound is disclosed, like the audit read.
    const [participants, history, fixtures] = await Promise.all([
      getParticipants(phaseId),
      loadSubstitutionHistory(seasonId),
      getTournamentPairings(phaseId),
    ]);
    plan = planGroupRepair({
      phaseId,
      groups,
      enrolled: participants.map((participant) => ({ id: participant.id, name: participant.name })),
      substitutions: history.substitutions,
      matches: fixtures.pairings,
    });
    historySummary = history.summary;
    fixturesSummary = { matches: fixtures.pairings.length, truncated: fixtures.truncated };
  }

  if (!input.dryRun) {
    if (!sameMoves(plan.moves, input.reviewed)) {
      throw new UserFacingError('The group rows changed since they were checked; check them again', {
        code: 'PLAN_CHANGED',
        status: 409,
      });
    }
    const { log } = input;
    for (const move of plan.moves) {
      if (log) log.stopped_at = { move, written: false, held_group_ids: [] };
      const outcome = await handOverGroupRow(phaseId, move.group_id, move.from_player_id, move.to_player_id);
      if (!outcome.written) {
        // The row is not as planned any more: this move wrote nothing.
        if (log) {
          log.stopped_at = {
            move,
            written: false,
            held_group_ids: outcome.reason === 'target_grouped' ? outcome.held_group_ids : [],
          };
        }
        throw new UserFacingError('The group rows changed since they were checked; check them again', {
          code: 'PLAN_CHANGED',
          status: 409,
        });
      }
      if (outcome.held_group_ids.some((groupId) => groupId !== move.group_id)) {
        // The row moved, but the target had been placed in another group
        // meanwhile and now holds two rows.
        if (log) log.stopped_at = { move, written: true, held_group_ids: outcome.held_group_ids };
        throw new UserFacingError('The groups changed during the repair; check them again', {
          code: 'GROUP_SLOT_CHANGED',
          status: 409,
        });
      }
      if (log) {
        log.written.push(move);
        log.stopped_at = null;
      }
    }
  }

  return {
    ...plan,
    applied: !input.dryRun && plan.moves.length > 0,
    history: historySummary,
    fixtures: fixturesSummary,
  };
}
