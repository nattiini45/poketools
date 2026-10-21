/**
 * The groups a `PUT /api/seasons/[id]/groups` body asks for. Pure (no reads): the route passes the roster in seed
 * order and the current groups.
 */
import { UserFacingError } from '@/lib/api/user-facing-error';
import { DraftRuleError } from '@/lib/draft/errors';
import { assignSerpentine, groupLabel } from '@/lib/tournament/serpentine';
import { MIN_GROUP_MEMBERS, type SeasonGroupsReplaceInput } from './schemas';
import type { LeagueGroupsParticipant } from '@/types/league-groups-editor';
import type { SeasonGroupInput, SeasonGroupWithMembers } from '@/types/season-group';

/** The comparison key of a group name: the database's rule (`uq_season_groups_name_ci`: lower(btrim(name))). */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Names for `count` groups: the groups that stay keep their names by position; a new group gets the first default
 * name `Group A`, `Group B`, … (starting at its own position's letter) that no kept group uses, so a renamed group
 * (say B renamed to "Group C") never collides with a new default name.
 */
export function plannedGroupNames(count: number, existing: readonly Pick<SeasonGroupWithMembers, 'name'>[]): string[] {
  const kept = existing.slice(0, count).map((g) => g.name);
  const used = new Set(kept.map(nameKey));
  return Array.from({ length: count }, (_, index) => {
    if (index < kept.length) return kept[index];
    let label = index;
    while (used.has(nameKey(`Group ${groupLabel(label)}`))) label += 1;
    const name = `Group ${groupLabel(label)}`;
    used.add(nameKey(name));
    return name;
  });
}

/**
 * The groups a replace body asks for, from the roster in seed order (pure). Serpentine keeps the names of the
 * groups that stay (by position) and names new ones `Group A`, `Group B`, … (English engine names, translated at
 * display time; `plannedGroupNames`). Manual groups must place every participant exactly once, at least two per
 * group (the database refuses the same: SEASON_GROUP_MEMBERS_INVALID, SEASON_GROUP_TOO_SMALL).
 */
export function plannedGroups(
  body: SeasonGroupsReplaceInput,
  participants: readonly LeagueGroupsParticipant[],
  existing: readonly Pick<SeasonGroupWithMembers, 'name'>[],
): SeasonGroupInput[] {
  if (body.mode === 'clear') return [];

  if (body.mode === 'serpentine') {
    // Every group needs two trainers to play a round robin and to seat a draft.
    if (participants.length < body.group_count * MIN_GROUP_MEMBERS) {
      throw new UserFacingError(
        `Cannot split ${participants.length} participants into ${body.group_count} groups: every group needs at least two trainers.`,
        {
          code: 'SEASON_GROUPS_TOO_MANY',
          status: 422,
          params: { participants: participants.length, count: body.group_count },
        },
      );
    }
    const buckets = assignSerpentine(
      participants.map((p, index) => ({ player_id: p.id, seed: index + 1 })),
      body.group_count,
    );
    const names = plannedGroupNames(body.group_count, existing);
    return names.map((name, index) => ({ name, player_ids: buckets.get(index) ?? [] }));
  }

  const roster = new Set(participants.map((p) => p.id.toLowerCase()));
  const placed = new Set<string>();
  for (const group of body.groups) {
    for (const playerId of group.player_ids) {
      const key = playerId.toLowerCase();
      if (!roster.has(key)) {
        throw new UserFacingError('This trainer is not a participant of this league', {
          code: 'SEASON_GROUP_PLAYER_NOT_FOUND',
          status: 422,
        });
      }
      placed.add(key);
    }
  }
  const unplaced = participants.filter((p) => !placed.has(p.id.toLowerCase())).length;
  if (unplaced > 0) {
    throw new UserFacingError(
      `${unplaced} participant${unplaced === 1 ? ' is' : 's are'} in no group. Place every participant in exactly one group.`,
      { code: 'SEASON_GROUPS_INCOMPLETE', status: 422, params: { count: unplaced } },
    );
  }
  if (body.groups.some((g) => g.player_ids.length < MIN_GROUP_MEMBERS)) throw new DraftRuleError('SEASON_GROUP_TOO_SMALL');
  return body.groups.map((g) => ({ name: g.name, player_ids: [...g.player_ids] }));
}
