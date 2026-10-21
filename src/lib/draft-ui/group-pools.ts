/**
 * League groups on the draft pages (draft room, redraft page): which group's pools a page shows. Pure and
 * client-safe.
 *
 * A league with groups has one initial (and one live redraft) pool per group. The pages default to the viewer's own
 * group, list the groups that have pools by name, and switch with `?pool=<id>` (a pool of another group selects that
 * group). A league WITHOUT groups (every pool's `season_group_id` is null) is returned unchanged: every pool, no group
 * list, so the pages behave exactly as before.
 *
 * Order of the selected group:
 *  1. the group of a valid `?pool=<uuid>` that names one of these pools;
 *  2. the viewer's group, when it has a pool;
 *  3. the first group (display order) that has a pool.
 */
import { requestedPoolId } from './select-pool';

/** The pool fields this module reads (`GroupedPoolSummary` has them). */
export interface GroupedPoolLike {
  id: string;
  season_group_id: string | null;
  season_group_name: string | null;
  season_group_sort_order: number | null;
}

/** A group that has at least one pool, in display order. `name` is the stored (engine) name. */
export interface PoolGroupOption {
  id: string;
  name: string;
  sortOrder: number;
}

export interface GroupPoolScope<P extends GroupedPoolLike> {
  /** The league drafts per group (some pool names a group). */
  grouped: boolean;
  /** The selected group; null without groups. */
  groupId: string | null;
  /** The selected group's pools (every pool without groups), in the input order. */
  pools: P[];
  /** The groups with pools, in display order; empty without groups. */
  groups: PoolGroupOption[];
}

/** The distinct groups of these pools, in display order (then name). */
export function poolGroupOptions(pools: readonly GroupedPoolLike[]): PoolGroupOption[] {
  const byId = new Map<string, PoolGroupOption>();
  for (const pool of pools) {
    if (pool.season_group_id == null || byId.has(pool.season_group_id)) continue;
    byId.set(pool.season_group_id, {
      id: pool.season_group_id,
      name: pool.season_group_name ?? '',
      sortOrder: pool.season_group_sort_order ?? 0,
    });
  }
  return [...byId.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/**
 * The pools of the group a draft page shows.
 *
 * @param requested the raw `?pool=` value (string, string[] or undefined, as Next passes it).
 * @param viewerGroupId the signed-in viewer's group in this league (null: signed out, or in no group).
 */
export function scopePoolsToGroup<P extends GroupedPoolLike>(
  pools: readonly P[],
  requested: string | string[] | null | undefined,
  viewerGroupId: string | null,
): GroupPoolScope<P> {
  const groups = poolGroupOptions(pools);
  if (groups.length === 0) return { grouped: false, groupId: null, pools: [...pools], groups };

  const wanted = requestedPoolId(requested);
  const requestedPool = wanted ? pools.find((p) => p.id.toLowerCase() === wanted) : undefined;
  const groupId =
    requestedPool?.season_group_id ??
    (viewerGroupId !== null && groups.some((g) => g.id === viewerGroupId) ? viewerGroupId : groups[0].id);
  return { grouped: true, groupId, pools: pools.filter((p) => p.season_group_id === groupId), groups };
}

/**
 * Whether the shown group's draft is read-only for this viewer (the group switch then says so in a `role="note"`
 * line): a trainer of the league (a participant, in another group or in none) who is no pool admin and looks at a
 * group that is not theirs. Spectators (signed out, or not in the league) and pool admins get no note: spectators
 * never pick anywhere, admins act on behalf of anyone. A league without groups (no shown group): false.
 */
export function isOtherGroupReadOnly(viewer: {
  shownGroupId: string | null;
  viewerGroupId: string | null;
  viewerIsParticipant: boolean;
  isPoolAdmin: boolean;
}): boolean {
  if (viewer.shownGroupId === null || viewer.isPoolAdmin || !viewer.viewerIsParticipant) return false;
  return viewer.shownGroupId !== viewer.viewerGroupId;
}
