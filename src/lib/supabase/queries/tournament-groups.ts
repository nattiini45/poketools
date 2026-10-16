import { supabase } from '../client';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Tables } from '@/types/database';
import type { TournamentGroup, TournamentGroupWithMembers } from '@/types/season';

type GroupRow = Tables<'tournament_groups'>;

function toGroup(row: GroupRow): TournamentGroup {
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    name: row.name,
    group_number: row.group_number,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getGroupsByTournament(
  tournamentId: string
): Promise<TournamentGroupWithMembers[]> {
  const { data, error } = await supabase
    .from('tournament_groups')
    .select(`
      *,
      tournament_group_members (
        player_id,
        seed,
        players:players ( name )
      )
    `)
    .eq('tournament_id', tournamentId)
    .order('group_number');

  if (error) throw error;

  return data.map((row) => {
    type MemberJoin = { player_id: string; seed: number; players: { name: string } };
    const members = (row.tournament_group_members as MemberJoin[]) ?? [];
    return {
      ...toGroup(row),
      members: members
        .sort((a, b) => a.seed - b.seed)
        .map((m) => ({
          player_id: m.player_id,
          player_name: m.players.name,
          seed: m.seed,
          gym_type: null,
        })),
    };
  });
}

export async function createGroup(input: {
  tournament_id: string;
  name: string;
  group_number: number;
}): Promise<TournamentGroup> {
  const { data, error } = await supabase
    .from('tournament_groups')
    .insert(input)
    .select()
    .single();

  if (error) throw error;
  return toGroup(data);
}

export async function createGroupBatch(
  groups: { tournament_id: string; name: string; group_number: number }[]
): Promise<TournamentGroup[]> {
  const { data, error } = await supabase
    .from('tournament_groups')
    .insert(groups)
    .select();

  if (error) throw error;
  return data.map(toGroup);
}

export async function deleteGroup(groupId: string): Promise<void> {
  const { error } = await supabase
    .from('tournament_groups')
    .delete()
    .eq('id', groupId);
  if (error) throw error;
}

export async function deleteGroupsByTournament(tournamentId: string): Promise<void> {
  const { error } = await supabase
    .from('tournament_groups')
    .delete()
    .eq('tournament_id', tournamentId);
  if (error) throw error;
}

export async function addGroupMember(
  groupId: string,
  playerId: string,
  seed: number = 0
): Promise<void> {
  const { error } = await supabase
    .from('tournament_group_members')
    .insert({ group_id: groupId, player_id: playerId, seed });
  if (error) throw error;
}

export async function removeGroupMember(
  groupId: string,
  playerId: string
): Promise<void> {
  const { error } = await supabase
    .from('tournament_group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('player_id', playerId);
  if (error) throw error;
}

export async function addGroupMembersBatch(
  members: { group_id: string; player_id: string; seed: number }[]
): Promise<void> {
  if (members.length === 0) return;
  const { error } = await supabase
    .from('tournament_group_members')
    .insert(members);
  if (error) throw error;
}

export async function moveGroupMember(
  fromGroupId: string,
  toGroupId: string,
  playerId: string,
  seed: number
): Promise<void> {
  await removeGroupMember(fromGroupId, playerId);
  await addGroupMember(toGroupId, playerId, seed);
}

export async function getGroupMemberIds(groupId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('tournament_group_members')
    .select('player_id')
    .eq('group_id', groupId)
    .order('seed');

  if (error) throw error;
  return data.map((row) => row.player_id);
}

/** One player's group row in a phase, with the group's name and order. */
export interface GroupMembership {
  group_id: string;
  group_name: string;
  group_number: number;
  player_id: string;
  seed: number;
}

/**
 * The group rows the given players hold in one phase (tournament), ordered by
 * group number. Two reads: the phase's groups, then their member rows for
 * these players (none when the phase has no groups). Bounded: a phase has a
 * handful of groups and each player one row per group.
 */
export async function getGroupMembershipsInTournament(
  tournamentId: string,
  playerIds: readonly string[],
): Promise<GroupMembership[]> {
  if (playerIds.length === 0) return [];
  const { data: groups, error: groupsError } = await supabase
    .from('tournament_groups')
    .select('id, name, group_number')
    .eq('tournament_id', tournamentId)
    .order('group_number');
  if (groupsError) throw groupsError;
  if (groups.length === 0) return [];

  const { data: members, error: membersError } = await supabase
    .from('tournament_group_members')
    .select('group_id, player_id, seed')
    .in('group_id', groups.map((group) => group.id))
    .in('player_id', [...playerIds]);
  if (membersError) throw membersError;

  const groupById = new Map(groups.map((group) => [group.id, group]));
  return members
    .flatMap((member) => {
      const group = groupById.get(member.group_id);
      return group
        ? [
            {
              group_id: group.id,
              group_name: group.name,
              group_number: group.group_number,
              player_id: member.player_id,
              seed: member.seed,
            },
          ]
        : [];
    })
    .sort((a, b) => a.group_number - b.group_number);
}

/**
 * What `swapGroupMemberInTournament` did: `written` when it deleted a row or
 * moved the slot (a delete or UPDATE that matched no row is not a write), and
 * `held`, the group row the incoming player holds afterwards (null: none).
 */
export interface GroupMemberSwap {
  written: boolean;
  held: GroupMembership | null;
}

/** Errors `swapGroupMemberInTournament` threw after it had already written. */
const failedAfterWrite = new WeakSet<object>();

/**
 * Whether `err`, thrown by `swapGroupMemberInTournament`, came after the call
 * had already written (deleted a stale row), so its caller can record that
 * write although no result came back. The error itself is unchanged.
 */
export function groupSwapWroteBeforeFailure(err: unknown): boolean {
  return typeof err === 'object' && err !== null && failedAfterWrite.has(err);
}

/**
 * Hand a player's group slot in one phase to their substitute: the incoming
 * player takes the outgoing player's group and seed, in one UPDATE of the
 * member row. A substitution swaps the phase enrollment and the scheduled
 * fixtures; without this the group row stayed with the departed player, and
 * per-group standings and advancement ignored every match the substitute
 * played.
 *
 * The caller guarantees the incoming player is not enrolled in the phase
 * (`substituteParticipant` rejects that before any write). The group repair
 * does not use this (it may delete rows): it writes with `handOverGroupRow`.
 * Every case ends with the incoming player in at most one group:
 * - Outgoing player holding a slot: any row the incoming player holds in the
 *   phase is stale (left from an earlier enrollment) and is deleted before
 *   the slot moves.
 * - Outgoing player in several groups of the phase (stale data): the slot in
 *   the lowest group number moves; the other rows are deleted.
 * - Outgoing player in no group: no slot moves. A row the incoming player
 *   already holds is kept, since it is the slot an interrupted run of this
 *   substitution already moved (its enrollment swap runs after this step);
 *   only rows past their lowest group are deleted. Returns that row, or null
 *   in an ungrouped phase.
 * - The slot row vanished between the read and the UPDATE (a concurrent
 *   group edit): throws `GROUP_SLOT_CHANGED` (409); re-running the
 *   substitution reads the new state.
 *
 * Returns whether it wrote and the group the incoming player now holds
 * (`GroupMemberSwap`). An error thrown after a write (stale rows deleted,
 * then the UPDATE failed) is marked: see `groupSwapWroteBeforeFailure`.
 */
export async function swapGroupMemberInTournament(
  tournamentId: string,
  outPlayerId: string,
  inPlayerId: string,
): Promise<GroupMemberSwap> {
  const memberships = await getGroupMembershipsInTournament(tournamentId, [outPlayerId, inPlayerId]);
  const outRows = memberships.filter((row) => row.player_id === outPlayerId);
  const inRows = memberships.filter((row) => row.player_id === inPlayerId);
  const slot = outRows[0];

  let written = false;
  try {
    const staleRows = slot ? [...inRows, ...outRows.slice(1)] : inRows.slice(1);
    for (const stale of staleRows) {
      const { data: deleted, error: deleteError } = await supabase
        .from('tournament_group_members')
        .delete()
        .eq('group_id', stale.group_id)
        .eq('player_id', stale.player_id)
        .select('group_id');
      if (deleteError) throw deleteError;
      if (deleted.length > 0) written = true;
    }
    if (!slot) return { written, held: inRows[0] ?? null };

    const { data, error } = await supabase
      .from('tournament_group_members')
      .update({ player_id: inPlayerId })
      .eq('group_id', slot.group_id)
      .eq('player_id', outPlayerId)
      .select('group_id');
    if (error) throw error;
    if (data.length === 0) {
      throw new UserFacingError('The group changed during the substitution; run it again', {
        code: 'GROUP_SLOT_CHANGED',
        status: 409,
      });
    }

    return { written: true, held: { ...slot, player_id: inPlayerId } };
  } catch (err) {
    if (written && typeof err === 'object' && err !== null) failedAfterWrite.add(err);
    throw err;
  }
}

/**
 * What `handOverGroupRow` did:
 * - `written: true`: the row moved; `held_group_ids` are the groups the target
 *   holds a row in afterwards (only the planned one, unless the target was
 *   placed in another group between the check and the write). When the read
 *   after the write fails, they are the rows the UPDATE moved.
 * - `row_gone`: nothing written; the departed player no longer holds that
 *   row (moved, removed, or already handed over by another apply).
 * - `target_grouped`: nothing written; the target already holds a row in the
 *   phase (`held_group_ids`).
 */
export type GroupRowHandover =
  | { written: true; held_group_ids: string[] }
  | { written: false; reason: 'row_gone' }
  | { written: false; reason: 'target_grouped'; held_group_ids: string[] };

/**
 * Hand one planned group row (`groupId`, held by `fromPlayerId`) to
 * `toPlayerId`, for the group repair (`repairPhaseGroups`). Unlike
 * `swapGroupMemberInTournament` it deletes nothing and writes only the row
 * that was planned: the target must hold no row in the phase, and the UPDATE
 * names the expected holder, so a row moved or handed over since the plan
 * writes nothing. The primary key catches a target placed in that group
 * meanwhile; a target placed in another group between the check and the
 * UPDATE is seen in the read after it (`held_group_ids`).
 */
export async function handOverGroupRow(
  tournamentId: string,
  groupId: string,
  fromPlayerId: string,
  toPlayerId: string,
): Promise<GroupRowHandover> {
  const before = await getGroupMembershipsInTournament(tournamentId, [toPlayerId]);
  if (before.length > 0) {
    return { written: false, reason: 'target_grouped', held_group_ids: before.map((row) => row.group_id) };
  }

  const { data, error } = await supabase
    .from('tournament_group_members')
    .update({ player_id: toPlayerId })
    .eq('group_id', groupId)
    .eq('player_id', fromPlayerId)
    .select('group_id');
  if (error) {
    // 23505: the target was placed in this group meanwhile.
    if (error.code === '23505') {
      return { written: false, reason: 'target_grouped', held_group_ids: [groupId] };
    }
    throw error;
  }
  if (data.length === 0) return { written: false, reason: 'row_gone' };

  // The row has moved: from here on this reports `written: true` whatever the
  // read does, or the caller's audit would miss a handover that landed (a
  // re-run no longer plans it). A failed read falls back to the rows the
  // UPDATE returned; only a target placed in another group meanwhile goes
  // unseen then.
  try {
    const after = await getGroupMembershipsInTournament(tournamentId, [toPlayerId]);
    return { written: true, held_group_ids: after.map((row) => row.group_id) };
  } catch (readError) {
    console.error('[handOverGroupRow] Read after the handover failed:', readError);
    return { written: true, held_group_ids: data.map((row) => row.group_id) };
  }
}
