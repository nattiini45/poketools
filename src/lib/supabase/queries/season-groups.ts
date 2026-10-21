/**
 * League groups (`season_groups`, `season_group_members`; 20261018180000_league_groups.sql). Server only.
 *
 * Reads are plain PostgREST queries. Writes that touch several rows go through the atomic RPC
 * `season_groups_replace` (create N groups, rename, set members in one transaction under the season's draft lock);
 * single-row writes (rename one group, move one trainer) are single statements. The database guards every write:
 * memberships are frozen while a group has a live pool (SEASON_GROUP_LOCKED) and for good once a phase of the league
 * has a round (SEASON_GROUPS_SCHEDULED, 20261018202000), every group keeps two trainers (SEASON_GROUP_TOO_SMALL), a
 * league that drafted without groups cannot add any (SEASON_GROUPS_AFTER_DRAFT). Those refusals arrive as
 * `DraftRuleError` (catalog `errors/draft`); constraint refusals of the single-row writes get their own codes.
 */
import 'server-only';

import { supabase } from '../client';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { DraftRuleError } from '@/lib/draft/errors';
import { callDraftRpc, toDraftRuleError } from '@/lib/draft/rpc-errors';
import type { SeasonGroup, SeasonGroupInput, SeasonGroupWithMembers } from '@/types/season-group';

interface GroupRowWithMembers {
  id: string;
  season_id: string;
  name: string;
  sort_order: number;
  season_group_members: { player_id: string; created_at: string }[] | null;
}

function toGroupWithMembers(row: GroupRowWithMembers): SeasonGroupWithMembers {
  const members = [...(row.season_group_members ?? [])].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.player_id.localeCompare(b.player_id),
  );
  return {
    id: row.id,
    season_id: row.season_id,
    name: row.name,
    sort_order: row.sort_order,
    player_ids: members.map((m) => m.player_id),
  };
}

/** A league's groups in display order, each with its members' player ids. Empty for a league without groups. */
export async function getSeasonGroups(seasonId: string): Promise<SeasonGroupWithMembers[]> {
  const { data, error } = await supabase
    .from('season_groups')
    .select('id, season_id, name, sort_order, season_group_members ( player_id, created_at )')
    .eq('season_id', seasonId)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(toGroupWithMembers);
}

/** Whether a league has groups (one head count). */
export async function seasonHasGroups(seasonId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('season_groups')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', seasonId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Whether any phase of the league has a round (one head count over the given phase ids; no phase = false). Once it
 * does, the league groups are frozen (SEASON_GROUPS_SCHEDULED): the editor shows why and offers renames only.
 */
export async function seasonPhasesHaveRounds(phaseIds: readonly string[]): Promise<boolean> {
  if (phaseIds.length === 0) return false;
  const { count, error } = await supabase
    .from('rounds')
    .select('id', { count: 'exact', head: true })
    .in('tournament_id', [...phaseIds]);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/** A trainer's group in a league; null in a league without groups or for a trainer in none. */
export async function getSeasonGroupOfPlayer(seasonId: string, playerId: string): Promise<SeasonGroup | null> {
  const { data, error } = await supabase
    .from('season_group_members')
    .select('season_groups ( id, season_id, name, sort_order )')
    .eq('season_id', seasonId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) throw error;
  const group = data?.season_groups ?? null;
  return group ? { id: group.id, season_id: group.season_id, name: group.name, sort_order: group.sort_order } : null;
}

/**
 * Whether a league group has a pool in its submissions or drafting phase (one head count). While it does, a trainer
 * of the group cannot be substituted: the pool keeps the outgoing seat, and a Redraft in submissions also keeps the
 * outgoing trainer's drops, which its deadline publishes on its own (SEASON_GROUP_SUBSTITUTION_LOCKED; the membership
 * trigger of 20261018202000_league_groups_locks.sql is the backstop, this read lets the substitution refuse before
 * its first write).
 */
export async function seasonGroupHasDraftingPool(groupId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('draft_pools')
    .select('id', { count: 'exact', head: true })
    .eq('season_group_id', groupId)
    .in('phase', ['submissions', 'drafting']);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/** The player ids of one league group (one query). */
export async function getSeasonGroupMemberIds(groupId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('season_group_members').select('player_id').eq('group_id', groupId);

  if (error) throw error;
  return new Set((data ?? []).map((row) => row.player_id));
}

/** Trainer -> group id for a whole league (one query). Empty for a league without groups. */
export async function getSeasonGroupMembership(seasonId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('season_group_members')
    .select('player_id, group_id')
    .eq('season_id', seasonId);

  if (error) throw error;
  const out: Record<string, string> = {};
  for (const row of data ?? []) out[row.player_id] = row.group_id;
  return out;
}

function isSeasonGroupWithMembers(v: unknown): v is SeasonGroupWithMembers {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.sort_order === 'number' &&
    Array.isArray(r.player_ids) &&
    r.player_ids.every((p) => typeof p === 'string')
  );
}

/**
 * Replace a league's groups and memberships in one transaction (`season_groups_replace`): display order = array
 * order, groups keep their ids by position, `[]` removes every group. Refusals (`DraftRuleError`): INVALID_CONFIG
 * {field}, SEASON_GROUPS_SCHEDULED, SEASON_GROUP_LOCKED, SEASON_GROUP_MEMBERS_INVALID (a non-participant, a trainer
 * twice, or a participant left out), SEASON_GROUP_TOO_SMALL, SEASON_GROUP_IN_USE, SEASON_GROUPS_AFTER_DRAFT.
 */
export async function replaceSeasonGroups(
  seasonId: string,
  groups: readonly SeasonGroupInput[],
): Promise<SeasonGroupWithMembers[]> {
  const raw = await callDraftRpc<unknown>('season_groups_replace', {
    p_season_id: seasonId,
    p_groups: groups.map((g) => ({ name: g.name, player_ids: [...g.player_ids] })),
  });
  if (!Array.isArray(raw) || !raw.every(isSeasonGroupWithMembers)) {
    throw new Error('season_groups_replace returned an unexpected payload');
  }
  return raw.map((g) => ({
    id: g.id,
    season_id: seasonId,
    name: g.name,
    sort_order: g.sort_order,
    player_ids: [...g.player_ids],
  }));
}

/**
 * Postgres unique_violation: the league already has a group with this name, ignoring case and surrounding blanks
 * (`uq_season_groups_name_ci`, 20261018202000).
 */
const UNIQUE_VIOLATION = '23505';
/** Postgres check_violation (`season_groups_name_len`: 1..60 characters after trimming). */
const CHECK_VIOLATION = '23514';
/** Postgres foreign_key_violation (the membership's group or participant key). */
const FOREIGN_KEY_VIOLATION = '23503';

function pgErrorText(error: { message?: string; details?: string | null }): string {
  return `${error.message ?? ''} ${error.details ?? ''}`;
}

export class SeasonGroupNameTakenError extends Error {
  constructor() {
    super('season_groups: a group of this league already has this name');
    this.name = 'SeasonGroupNameTakenError';
  }
}

/**
 * Rename one group (trimmed; 1..60 characters, validated by the caller's schema and the table CHECK). Returns null
 * when no group of this league has this id. A duplicate name throws `SeasonGroupNameTakenError`.
 */
export async function renameSeasonGroup(seasonId: string, groupId: string, name: string): Promise<SeasonGroup | null> {
  const { data, error } = await supabase
    .from('season_groups')
    .update({ name: name.trim() })
    .eq('id', groupId)
    .eq('season_id', seasonId)
    .select('id, season_id, name, sort_order')
    .maybeSingle();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      console.error('[queries/season-groups] renameSeasonGroup duplicate name:', error);
      throw new SeasonGroupNameTakenError();
    }
    if (error.code === CHECK_VIOLATION) {
      // The route's schema bounds the name first; this is the table's own check refusing it (a distinct code).
      console.error('[queries/season-groups] renameSeasonGroup name refused by the table check:', error);
      throw new DraftRuleError('INVALID_CONFIG', { field: 'name' });
    }
    throw error;
  }
  return data ? { id: data.id, season_id: data.season_id, name: data.name, sort_order: data.sort_order } : null;
}

/**
 * Place a trainer in a group of the same league: a move when they are in another group, their first placement when
 * they are in none (a participant added after the groups were made). One statement (insert, or update on the
 * membership key), so the membership guard decides either way: refused once a phase of the league has a round
 * (SEASON_GROUPS_SCHEDULED), while the old or the new group has a live pool or the trainer holds lines of the old
 * group (SEASON_GROUP_LOCKED), and when the move leaves the old group with fewer than two trainers
 * (SEASON_GROUP_TOO_SMALL), all `DraftRuleError`. The caller checks that the trainer is a participant and the group
 * belongs to the league first; a race past those checks gets the same codes from the foreign keys
 * (SEASON_GROUP_PLAYER_NOT_FOUND 422, SEASON_GROUP_NOT_FOUND 404).
 */
export async function placeSeasonGroupMember(seasonId: string, playerId: string, groupId: string): Promise<void> {
  const { error } = await supabase
    .from('season_group_members')
    .upsert({ season_id: seasonId, player_id: playerId, group_id: groupId }, { onConflict: 'season_id,player_id' });

  if (error) {
    const rule = toDraftRuleError(error);
    if (rule) throw rule;
    if (error.code === FOREIGN_KEY_VIOLATION) {
      // The caller checked both keys; this is a race with a roster or group change. Each key keeps its own code.
      console.error('[queries/season-groups] placeSeasonGroupMember foreign key refused:', error);
      if (pgErrorText(error).includes('season_group_members_participant_fkey')) {
        throw new UserFacingError('This trainer is not a participant of this league', {
          code: 'SEASON_GROUP_PLAYER_NOT_FOUND',
          status: 422,
        });
      }
      if (pgErrorText(error).includes('season_group_members_group_fkey')) {
        throw new UserFacingError('Group not found in this league', { code: 'SEASON_GROUP_NOT_FOUND', status: 404 });
      }
    }
    throw error;
  }
}

/**
 * Remove a trainer from a league's roster (`season_participant_remove`, 20261018202100): the roster's only removal
 * path, because leaving the league also leaves the league group (the membership's participant key cascades). For a
 * trainer who holds a group the database refuses, under the season's draft lock: once a phase of the league has a
 * round (SEASON_GROUPS_SCHEDULED), while that group has a live pool or the trainer holds lines drafted in it
 * (SEASON_GROUP_LOCKED), and when the group would keep fewer than two trainers (SEASON_GROUP_TOO_SMALL), all
 * `DraftRuleError`. A trainer in no group, or in a league without groups, is removed as before. Returns whether a
 * roster row was removed (false: the trainer was not on the roster).
 */
export async function removeLeagueParticipant(seasonId: string, playerId: string): Promise<boolean> {
  const removed = await callDraftRpc<unknown>('season_participant_remove', {
    p_season_id: seasonId,
    p_player_id: playerId,
  });
  if (typeof removed !== 'boolean') {
    throw new Error('season_participant_remove returned an unexpected payload');
  }
  return removed;
}

/**
 * The refusal of a roster insert into a grouped league that already has rounds (trigger
 * `season_participants__group_guard`, 20261018202100: SEASON_GROUPS_SCHEDULED) as its `DraftRuleError`; any other
 * error unchanged. The caller rethrows the result.
 */
export function toRosterAddError(err: unknown): unknown {
  return toDraftRuleError(err) ?? err;
}

/** Whether a trainer is on a league's roster (one head count). */
export async function isLeagueParticipant(seasonId: string, playerId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('season_participants')
    .select('player_id', { count: 'exact', head: true })
    .eq('season_id', seasonId)
    .eq('player_id', playerId);

  if (error) throw error;
  return (count ?? 0) > 0;
}
