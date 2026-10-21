/**
 * The league groups editor's data (`GET /api/seasons/[id]/groups`, admin only; the Participants tab's
 * `LeagueGroupsEditor`). Client-safe: ids, names, seeds and flags only, never a `players` row
 * (AGENTS.md: allowlist serialization through `toPublicPlayerRef`).
 */

/** A league participant as the editor lists them. `seed` = the league's first phase seed, null when unseeded. */
export interface LeagueGroupsParticipant {
  id: string;
  name: string;
  seed: number | null;
}

/** One league group with its members (join order) and whether its membership is frozen. */
export interface LeagueGroupsEditorGroup {
  id: string;
  /** Stored (English engine) name; the UI translates `Group A` patterns at display time. */
  name: string;
  sort_order: number;
  player_ids: string[];
  /**
   * Nobody joins or leaves the group: it has a live (not cancelled) draft pool (SEASON_GROUP_LOCKED), or a phase of
   * the league has a round (SEASON_GROUPS_SCHEDULED, then every group is locked).
   */
  locked: boolean;
}

export interface LeagueGroupsEditorDTO {
  groups: LeagueGroupsEditorGroup[];
  /** Every league participant in seed order (seeded first, then by name). */
  participants: LeagueGroupsParticipant[];
  /**
   * The league has a live draft pool: the groups cannot be re-created or cleared (`season_groups_replace` refuses);
   * renames stay possible, and so do moves between two groups that are both unlocked.
   */
  replaceLocked: boolean;
  /**
   * A phase of the league has a round: the schedule, the group tables and the draft order use the groups, so they
   * are frozen for good (SEASON_GROUPS_SCHEDULED). Only renames stay possible; `replaceLocked` and every group's
   * `locked` are true as well.
   */
  scheduleLocked: boolean;
}
