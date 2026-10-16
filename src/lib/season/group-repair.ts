/**
 * Planner for the group rows that substitutions made before the group
 * handover (2026-10) left behind. Such a substitution swapped the phase
 * enrollment and the scheduled fixtures but kept the `tournament_group_members`
 * row with the departed player: that row's holder is no longer enrolled in the
 * phase, and the substitute is enrolled with no group row at all. Per-group
 * advancement and round pairing read the raw rows, so the substitute's matches
 * count nowhere there.
 *
 * Pure: the caller loads the phase's groups, enrollment, the season's
 * substitution history (audit log) and the phase's matches
 * (`repairPhaseGroups` in `./repair-phase-groups.ts`). The plan pairs each
 * orphaned row (holder not enrolled) with the enrolled player who should hold
 * it (enrolled, no group row in the phase):
 * 1. From the substitution history: the departed holder's chain of
 *    substitutions (A -> B, later B -> C) resolves forward in time, up to
 *    the first player in it who is enrolled in the phase (a later step of
 *    the chain cannot have touched this phase's slot: a league-scope
 *    substitution skips completed phases). Only substitutions that touched
 *    this phase count: a record naming its phases (`phase_ids`) counts for
 *    those; an older record without them counts when it was scoped to the
 *    whole league or to this phase. Two rows whose chains end at the same
 *    player both fall through to step 2.
 * 2. From the fixtures, for what the history leaves open (an audit write is
 *    fire-and-forget, so a record can be missing): a substitute's matches are
 *    against the departed player's group-mates, so the group most of their
 *    opponents hold a row in is theirs (a tie decides nothing). Within that
 *    group, a substitute never met the player whose slot they took, so a
 *    match between the two rules the pair out. A pair moves only when each
 *    side is the other's only remaining option. A player the history already
 *    ties to a departed player whose row is not a source (it holds rows in
 *    several groups, or none) is not offered here: their slot is known, and
 *    it is not one of these rows. A departed player with no row counts only
 *    when the substitution that took them out names this phase; an older
 *    league-scope record may come from a phase they never played in.
 *
 * Nothing else moves: an enrolled holder's row is never touched, a target
 * never gets two rows, a row never moves twice, and a departed player holding
 * rows in several groups is left alone (the handover would delete the extra
 * rows). What stays open is reported, not guessed.
 */

export type GroupRepairBasis = 'audit' | 'fixtures';

/**
 * Why an item was left as it is:
 * - `no_counterpart`: nothing traces it to a row or a player.
 * - `ambiguous`: more than one counterpart fits (or the votes tie).
 * - `several_rows`: the departed player holds rows in more than one group.
 */
export type GroupRepairUnresolvedReason = 'no_counterpart' | 'ambiguous' | 'several_rows';

/** One recorded substitution (`season.participant.substitute` audit entry). */
export interface GroupRepairSubstitution {
  out_player_id: string;
  in_player_id: string;
  /** `'league'` or the id of the phase the substitution was scoped to. */
  scope: string;
  /**
   * The phases the substitution handed over (recorded since 2026-10); when
   * present it decides which phases the record counts for, not `scope`.
   */
  phase_ids?: readonly string[];
  /** When it was recorded; the history is walked oldest first. */
  created_at: string;
}

/** A phase group with its member rows (`TournamentGroupWithMembers` fits). */
export interface GroupRepairGroup {
  id: string;
  name: string;
  group_number: number;
  members: readonly { player_id: string; player_name: string }[];
}

export interface GroupRepairInput {
  phaseId: string;
  groups: readonly GroupRepairGroup[];
  /** The phase enrollment (seed order), names for the report. */
  enrolled: readonly { id: string; name: string }[];
  /** The season's recorded substitutions, in any order. */
  substitutions: readonly GroupRepairSubstitution[];
  /** The phase's matches, any status. */
  matches: readonly { player_1_id: string; player_2_id: string }[];
}

/** How complete the fixtures the plan was made from are. */
export interface GroupRepairFixturesSummary {
  /** Matches read. */
  matches: number;
  /** True when the read stopped at its bound: the newest matches were not read. */
  truncated: boolean;
}

/** A row handover by ids: how an apply names the moves the admin reviewed. */
export interface GroupRepairMoveRef {
  group_id: string;
  from_player_id: string;
  to_player_id: string;
}

/** One row handed from a departed player to the enrolled player who replaced them. */
export interface GroupRepairMove extends GroupRepairMoveRef {
  group_name: string;
  from_player_name: string;
  to_player_name: string;
  basis: GroupRepairBasis;
}

/** A row whose holder is not enrolled in the phase and that no move takes. */
export interface GroupRepairOrphanedRow {
  group_id: string;
  group_name: string;
  player_id: string;
  player_name: string;
  reason: GroupRepairUnresolvedReason;
}

/** An enrolled player with no group row in the phase that no move fills. */
export interface GroupRepairUngroupedPlayer {
  player_id: string;
  player_name: string;
  reason: Exclude<GroupRepairUnresolvedReason, 'several_rows'>;
}

export interface GroupRepairPlan {
  /** False when the phase has no groups: nothing to repair. */
  grouped: boolean;
  moves: GroupRepairMove[];
  unresolved: {
    orphaned_rows: GroupRepairOrphanedRow[];
    ungrouped_players: GroupRepairUngroupedPlayer[];
  };
}

/** How much substitution history the plan was made from. */
export interface GroupRepairHistorySummary {
  /** Substitution records read and used. */
  substitutions: number;
  /** Records whose payload did not parse (skipped). */
  unreadable: number;
  /** True when the read stopped at its bound: the oldest records were not read. */
  truncated: boolean;
}

/** What `POST /api/seasons/[id]/phases/[phaseId]/groups/repair` returns. */
export interface GroupRepairResult extends GroupRepairPlan {
  /** True when this request wrote the moves (not a dry run, at least one move). */
  applied: boolean;
  history: GroupRepairHistorySummary;
  fixtures: GroupRepairFixturesSummary;
}

interface Row {
  group: GroupRepairGroup;
  player_id: string;
  player_name: string;
  /** Position in group order, then member order: the report order. */
  order: number;
}

function emptyPlan(grouped: boolean): GroupRepairPlan {
  return { grouped, moves: [], unresolved: { orphaned_rows: [], ungrouped_players: [] } };
}

function timeOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Whether a recorded substitution touched this phase. */
function touchedPhase(sub: GroupRepairSubstitution, phaseId: string): boolean {
  if (sub.phase_ids) return sub.phase_ids.includes(phaseId);
  return sub.scope === 'league' || sub.scope === phaseId;
}

/**
 * Whether a recorded substitution names this phase itself: its `phase_ids`
 * include it, or (an older record) it was scoped to it. A league-scope record
 * without `phase_ids` touches every phase but names none.
 */
function namesPhase(sub: GroupRepairSubstitution, phaseId: string): boolean {
  if (sub.phase_ids) return sub.phase_ids.includes(phaseId);
  return sub.scope === phaseId;
}

/** The substitutions that touched this phase, oldest first (ties keep input order). */
function phaseHistory(
  substitutions: readonly GroupRepairSubstitution[],
  phaseId: string,
): GroupRepairSubstitution[] {
  return substitutions
    .filter((sub) => touchedPhase(sub, phaseId))
    .map((sub, index) => ({ sub, index }))
    .sort((a, b) => {
      const byTime = timeOf(a.sub.created_at) - timeOf(b.sub.created_at);
      if (byTime !== 0) return byTime;
      if (a.sub.created_at !== b.sub.created_at) return a.sub.created_at < b.sub.created_at ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ sub }) => sub);
}

/**
 * The player a departed holder's slot passed to: one pass over the history,
 * following each later substitution of whoever holds the slot at that point.
 * The slot is with the first player in the chain who is enrolled in the
 * phase (a later step cannot have touched it), else with the last one. Null
 * when the chain ends where it started (never substituted, or back again).
 */
function finalSuccessor(
  holderId: string,
  history: readonly GroupRepairSubstitution[],
  enrolledIds: ReadonlySet<string>,
): string | null {
  const chain: string[] = [];
  let current = holderId;
  for (const sub of history) {
    if (sub.out_player_id !== current) continue;
    current = sub.in_player_id;
    chain.push(current);
  }
  if (current === holderId) return null;
  return chain.find((playerId) => enrolledIds.has(playerId)) ?? current;
}

export function planGroupRepair(input: GroupRepairInput): GroupRepairPlan {
  if (input.groups.length === 0) return emptyPlan(false);
  // No enrollment rows at all (legacy data): every row would look orphaned,
  // and there is no one to hand them to. The league hub treats such a phase
  // as everyone enrolled; so does this.
  if (input.enrolled.length === 0) return emptyPlan(true);

  const groups = [...input.groups].sort(
    (a, b) => a.group_number - b.group_number || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const enrolledIds = new Set(input.enrolled.map((player) => player.id));

  const rows: Row[] = [];
  const rowsByPlayer = new Map<string, Row[]>();
  for (const group of groups) {
    for (const member of group.members) {
      const row: Row = { group, player_id: member.player_id, player_name: member.player_name, order: rows.length };
      rows.push(row);
      rowsByPlayer.set(member.player_id, [...(rowsByPlayer.get(member.player_id) ?? []), row]);
    }
  }

  const orphaned: { row: Row; reason: GroupRepairUnresolvedReason }[] = [];
  const sources: Row[] = [];
  for (const row of rows) {
    if (enrolledIds.has(row.player_id)) continue;
    if ((rowsByPlayer.get(row.player_id)?.length ?? 0) > 1) {
      orphaned.push({ row, reason: 'several_rows' });
      continue;
    }
    sources.push(row);
  }
  const targets = input.enrolled.filter((player) => !rowsByPlayer.has(player.id));
  const targetIds = new Set(targets.map((player) => player.id));

  const moves: { move: GroupRepairMove; order: number }[] = [];
  const movedSources = new Set<string>();
  const filledTargets = new Set<string>();
  const ambiguousSources = new Set<string>();
  const ambiguousTargets = new Set<string>();
  const nameOf = new Map(input.enrolled.map((player) => [player.id, player.name]));

  const addMove = (source: Row, targetId: string, basis: GroupRepairBasis) => {
    moves.push({
      move: {
        group_id: source.group.id,
        group_name: source.group.name,
        from_player_id: source.player_id,
        from_player_name: source.player_name,
        to_player_id: targetId,
        to_player_name: nameOf.get(targetId) ?? targetId,
        basis,
      },
      order: source.order,
    });
    movedSources.add(source.player_id);
    filledTargets.add(targetId);
  };

  // 1. The substitution history.
  const history = phaseHistory(input.substitutions, input.phaseId);
  const claims = new Map<string, string>();
  const claimsPerTarget = new Map<string, number>();
  for (const source of sources) {
    const successor = finalSuccessor(source.player_id, history, enrolledIds);
    if (!successor || !targetIds.has(successor)) continue;
    claims.set(source.player_id, successor);
    claimsPerTarget.set(successor, (claimsPerTarget.get(successor) ?? 0) + 1);
  }
  for (const source of sources) {
    const target = claims.get(source.player_id);
    if (!target) continue;
    if (claimsPerTarget.get(target) === 1) {
      addMove(source, target, 'audit');
    } else {
      ambiguousSources.add(source.player_id);
      ambiguousTargets.add(target);
    }
  }

  // A target the history ties to a departed player whose row is not a source
  // (rows in several groups, or no row in this phase): their slot is known
  // and is none of the sources, so the fixtures must not hand them one. That
  // holds only when the departed player was in this phase: they hold rows
  // here, or the substitution that took them out names this phase. An older
  // league-scope record counts for every phase, including ones the departed
  // player never played in, so on its own it ties nobody here.
  const sourceIds = new Set(sources.map((source) => source.player_id));
  const tiedElsewhere = new Map<string, Exclude<GroupRepairUnresolvedReason, 'several_rows'>>();
  for (const departedId of new Set(history.map((sub) => sub.out_player_id))) {
    if (enrolledIds.has(departedId) || sourceIds.has(departedId)) continue;
    const severalRows = (rowsByPlayer.get(departedId)?.length ?? 0) > 1;
    // The record the chain starts from: the one that took them out.
    const exit = history.find((sub) => sub.out_player_id === departedId);
    if (!severalRows && !(exit && namesPhase(exit, input.phaseId))) continue;
    const successor = finalSuccessor(departedId, history, enrolledIds);
    if (!successor || !targetIds.has(successor) || filledTargets.has(successor)) continue;
    if (severalRows || !tiedElsewhere.has(successor)) {
      tiedElsewhere.set(successor, severalRows ? 'ambiguous' : 'no_counterpart');
    }
  }

  // 2. The fixtures, for what the history left open.
  const opponents = new Map<string, string[]>();
  for (const match of input.matches) {
    if (match.player_1_id === match.player_2_id) continue;
    opponents.set(match.player_1_id, [...(opponents.get(match.player_1_id) ?? []), match.player_2_id]);
    opponents.set(match.player_2_id, [...(opponents.get(match.player_2_id) ?? []), match.player_1_id]);
  }
  const played = (a: string, b: string) => (opponents.get(a) ?? []).includes(b);
  // Only a player with exactly one row places an opponent in a group.
  const groupOf = new Map<string, string>();
  for (const [playerId, playerRows] of rowsByPlayer) {
    if (playerRows.length === 1) groupOf.set(playerId, playerRows[0].group.id);
  }

  const openTargets = targets.filter(
    (player) => !filledTargets.has(player.id) && !tiedElsewhere.has(player.id),
  );
  const votedGroup = new Map<string, string>();
  for (const target of openTargets) {
    const votes = new Map<string, number>();
    for (const opponent of opponents.get(target.id) ?? []) {
      const groupId = groupOf.get(opponent);
      if (groupId) votes.set(groupId, (votes.get(groupId) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    let tied = false;
    for (const group of groups) {
      const count = votes.get(group.id) ?? 0;
      if (count === 0) continue;
      if (count > bestCount) {
        best = group.id;
        bestCount = count;
        tied = false;
      } else if (count === bestCount) {
        tied = true;
      }
    }
    if (tied) ambiguousTargets.add(target.id);
    else if (best) votedGroup.set(target.id, best);
  }

  for (const group of groups) {
    let groupSources = sources.filter(
      (source) => source.group.id === group.id && !movedSources.has(source.player_id),
    );
    let groupTargets = openTargets.filter((target) => votedGroup.get(target.id) === group.id);
    const fits = (targetId: string, source: Row) => !played(targetId, source.player_id);

    let paired = true;
    while (paired) {
      paired = false;
      for (const target of groupTargets) {
        const options = groupSources.filter((source) => fits(target.id, source));
        if (options.length !== 1) continue;
        const source = options[0];
        if (groupTargets.filter((other) => fits(other.id, source)).length !== 1) continue;
        addMove(source, target.id, 'fixtures');
        groupSources = groupSources.filter((other) => other !== source);
        groupTargets = groupTargets.filter((other) => other !== target);
        paired = true;
        break;
      }
    }

    for (const target of groupTargets) {
      if (groupSources.some((source) => fits(target.id, source))) ambiguousTargets.add(target.id);
    }
    for (const source of groupSources) {
      if (groupTargets.some((target) => fits(target.id, source))) ambiguousSources.add(source.player_id);
    }
  }

  for (const source of sources) {
    if (movedSources.has(source.player_id)) continue;
    orphaned.push({
      row: source,
      reason: ambiguousSources.has(source.player_id) ? 'ambiguous' : 'no_counterpart',
    });
  }

  return {
    grouped: true,
    moves: moves.sort((a, b) => a.order - b.order).map(({ move }) => move),
    unresolved: {
      orphaned_rows: orphaned
        .sort((a, b) => a.row.order - b.row.order)
        .map(({ row, reason }): GroupRepairOrphanedRow => ({
          group_id: row.group.id,
          group_name: row.group.name,
          player_id: row.player_id,
          player_name: row.player_name,
          reason,
        })),
      ungrouped_players: targets
        .filter((player) => !filledTargets.has(player.id))
        .map((player): GroupRepairUngroupedPlayer => ({
          player_id: player.id,
          player_name: player.name,
          reason:
            tiedElsewhere.get(player.id) ??
            (ambiguousTargets.has(player.id) ? 'ambiguous' : 'no_counterpart'),
        })),
    },
  };
}
