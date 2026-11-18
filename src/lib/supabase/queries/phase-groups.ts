import { supabase } from '../client';
import { readBoundedPages } from '../read-bounded-pages';
import { UserFacingError } from '@/lib/api/user-facing-error';
import seasonErrors from '@/i18n/messages/errors/seasons/en';
import type { PhaseGroup, PhaseGroupWithMembers } from '@/types/league-phase';
import type { Json } from '@/types/database';

export async function getGroupsByPhase(phaseId: string): Promise<PhaseGroupWithMembers[]> {
  const { rows: groups } = await readBoundedPages((from, to) => supabase.from('phase_groups').select('*')
    .eq('phase_id', phaseId).order('group_number').order('id').range(from, to), { label: 'getGroupsByPhase' });
  if (groups.length === 0) return [];
  const { rows: members } = await readBoundedPages((from, to) => supabase.from('phase_group_members')
    .select('group_id, player_id, seed, players ( name )').eq('phase_id', phaseId)
    .order('group_id').order('player_id').range(from, to), { label: 'getPhaseGroupMembers' });
  const grouped = new Map<string, PhaseGroupWithMembers>(groups.map(group => [group.id, { ...group, members: [] }]));
  for (const member of members) grouped.get(member.group_id)?.members.push({
    player_id: member.player_id, player_name: (member.players as { name: string }).name, seed: member.seed, gym_type: null,
  });
  return [...grouped.values()].map(group => ({ ...group, members: group.members.sort((a, b) => a.seed - b.seed || a.player_id.localeCompare(b.player_id)) }));
}

export type PhaseGroupInput = Pick<PhaseGroup, 'phase_id' | 'season_id' | 'name' | 'group_number'> & { season_group_id?: string | null };

export async function replaceAdminPhaseGroups(
  seasonId: string,
  phaseId: string,
  groups: { name: string; members: string[] }[],
  expectedSeeds: { player_id: string; seed: number }[],
): Promise<void> {
  const { error } = await supabase.rpc('phase_admin_replace_groups', {
    p_season_id: seasonId, p_phase_id: phaseId, p_groups: groups, p_expected_seeds: expectedSeeds,
  });
  if (error) {
    if (error.code === 'P0001') {
      const code = error.message;
      if (code === 'PHASE_NOT_FOUND' || code === 'PHASE_GROUPS_LEAGUE_MANAGED'
        || code === 'GROUP_SLOT_CHANGED' || code === 'PHASE_GROUPS_INSUFFICIENT_SEEDS' || code === 'PHASE_GROUPS_ROUNDS_EXIST') {
        const status = code === 'PHASE_NOT_FOUND' ? 404 : code === 'PHASE_GROUPS_INSUFFICIENT_SEEDS' ? 400 : 409;
        throw new UserFacingError(seasonErrors[code], { code, status });
      }
    }
    throw error;
  }
}

async function writeGroups(phaseId: string, operation: string, rows: Json): Promise<PhaseGroup[]> {
  const { data, error } = await supabase.rpc('phase_group_write', { p_phase_id: phaseId, p_operation: operation, p_rows: rows });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('phase_group_write returned an unexpected result');
  return data as unknown as PhaseGroup[];
}

export async function createPhaseGroup(input: PhaseGroupInput): Promise<PhaseGroup> {
  const [group] = await createPhaseGroupBatch([input]);
  if (!group) throw new Error('phase_group_write did not return the created group');
  return group;
}

export async function createPhaseGroupBatch(groups: PhaseGroupInput[]): Promise<PhaseGroup[]> {
  if (groups.length === 0) return [];
  const phaseId = groups[0].phase_id;
  if (groups.some(group => group.phase_id !== phaseId)) throw new Error('A group batch must belong to one phase');
  return writeGroups(phaseId, 'create', groups as unknown as Json);
}

export async function updatePhaseGroup(phaseId: string, groupId: string, input: { name: string }): Promise<PhaseGroup> {
  const [group] = await writeGroups(phaseId, 'update', [{ id: groupId, name: input.name }]);
  if (!group) throw new Error('phase_group_write did not find the group');
  return group;
}

export async function deletePhaseGroup(phaseId: string, groupId: string): Promise<void> {
  await writeGroups(phaseId, 'delete', [{ id: groupId }]);
}

export async function deleteGroupsByPhase(phaseId: string): Promise<void> {
  await writeGroups(phaseId, 'delete_all', []);
}

export async function addPhaseGroupMember(phaseId: string, groupId: string, playerId: string, seed = 0): Promise<void> {
  await addPhaseGroupMembersBatch([{ phase_id: phaseId, group_id: groupId, player_id: playerId, seed }]);
}

export async function addPhaseGroupMembersBatch(members: Array<{ phase_id: string; group_id: string; player_id: string; seed: number }>): Promise<void> {
  if (members.length === 0) return;
  const phaseId = members[0].phase_id;
  if (members.some(member => member.phase_id !== phaseId)) throw new Error('A member batch must belong to one phase');
  await writeGroups(phaseId, 'add_members', members);
}

export async function removePhaseGroupMember(phaseId: string, groupId: string, playerId: string): Promise<void> {
  await writeGroups(phaseId, 'remove_member', [{ group_id: groupId, player_id: playerId }]);
}

export async function movePhaseGroupMember(phaseId: string, fromGroupId: string, toGroupId: string, playerId: string, seed: number): Promise<void> {
  const { error } = await supabase.rpc('phase_group_member_move', {
    p_phase_id: phaseId, p_from_group: fromGroupId, p_to_group: toGroupId, p_player_id: playerId, p_seed: seed,
  });
  if (error?.code === 'P0001') {
    const code = error.message;
    if (code === 'GROUP_SLOT_CHANGED' || code === 'PHASE_GROUPS_ROUNDS_EXIST' || code === 'PHASE_GROUPS_LEAGUE_MANAGED') {
      throw new UserFacingError(seasonErrors[code], { code, status: 409 });
    }
  }
  if (error) throw error;
}

export async function getPhaseGroupMemberIds(phaseId: string, groupId: string): Promise<string[]> {
  const { rows } = await readBoundedPages((from, to) => supabase.from('phase_group_members').select('player_id')
    .eq('phase_id', phaseId).eq('group_id', groupId).order('seed').order('player_id').range(from, to), { label: 'getPhaseGroupMemberIds' });
  return rows.map(row => row.player_id);
}

export interface PhaseGroupMembership {
  group_id: string;
  group_name: string;
  group_number: number;
  season_group_id: string | null;
  player_id: string;
  seed: number;
}

export async function getGroupMembershipsInPhase(phaseId: string, playerIds: readonly string[]): Promise<PhaseGroupMembership[]> {
  const unique = [...new Set(playerIds)];
  const result: PhaseGroupMembership[] = [];
  for (let offset = 0; offset < unique.length; offset += 50) {
    const { rows } = await readBoundedPages((from, to) => supabase.from('phase_group_members')
      .select('group_id, player_id, seed, phase_groups ( name, group_number, season_group_id )')
      .eq('phase_id', phaseId).in('player_id', unique.slice(offset, offset + 50)).order('group_id').order('player_id').range(from, to),
    { label: 'getGroupMembershipsInPhase' });
    for (const row of rows) {
      const group = row.phase_groups as { name: string; group_number: number; season_group_id: string | null };
      result.push({ group_id: row.group_id, player_id: row.player_id, seed: row.seed, group_name: group.name, group_number: group.group_number, season_group_id: group.season_group_id });
    }
  }
  return result.sort((a, b) => a.group_number - b.group_number || a.group_id.localeCompare(b.group_id));
}

export interface PhaseGroupMemberSwap { written: boolean; held: PhaseGroupMembership | null }
export type PhaseGroupRowHandover =
  | { written: true; held_group_ids: string[] }
  | { written: false; reason: 'row_gone' }
  | { written: false; reason: 'target_grouped'; held_group_ids: string[] };

export async function swapGroupMemberInPhase(phaseId: string, outPlayerId: string, inPlayerId: string): Promise<PhaseGroupMemberSwap> {
  const { data, error } = await supabase.rpc('phase_group_member_swap', { p_phase_id: phaseId, p_out: outPlayerId, p_in: inPlayerId });
  if (error) throw error;
  return data as unknown as PhaseGroupMemberSwap;
}

export async function handOverPhaseGroupRow(phaseId: string, groupId: string, fromPlayerId: string, toPlayerId: string): Promise<PhaseGroupRowHandover> {
  const { data, error } = await supabase.rpc('phase_group_row_handover', { p_phase_id: phaseId, p_group_id: groupId, p_out: fromPlayerId, p_in: toPlayerId });
  if (error) throw error;
  return data as unknown as PhaseGroupRowHandover;
}
