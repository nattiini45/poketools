/**
 * League groups (20261018180000_league_groups.sql): a league (season) may split its trainers into groups that persist
 * across its phases and draft their own pools. Client-safe: plain data shapes, no players rows.
 */
import type { DraftEngine, DraftKind, DraftMode, DraftPhase, PoolStatus } from '@/types/draft-queue';

/** One league group (`season_groups`). `sort_order` is its display position, 1..26. */
export interface SeasonGroup {
  id: string;
  season_id: string;
  name: string;
  sort_order: number;
}

/** A league group with its members' player ids (`season_group_members`), in join order. */
export interface SeasonGroupWithMembers extends SeasonGroup {
  player_ids: string[];
}

/** The editor's input for one group (`season_groups_replace`): display order = array order. */
export interface SeasonGroupInput {
  name: string;
  player_ids: string[];
}

/**
 * A league's pool for the draft pages and the admin Draft tab, with its group. `season_group_id` / `season_group_name`
 * are null in a league without groups.
 */
export interface GroupedPoolSummary {
  id: string;
  engine: DraftEngine;
  kind: DraftKind;
  phase: DraftPhase;
  mode: DraftMode;
  status: PoolStatus;
  season_group_id: string | null;
  season_group_name: string | null;
  /** The group's display position; null without a group. */
  season_group_sort_order: number | null;
  /** Redraft pools: the group's initial pool. */
  parent_pool_id: string | null;
  created_at: string;
}
