/**
 * Reads of the league groups routes. Server only.
 *
 * Seeds: a league has no seed column of its own; its first phase (lowest `stage_order`) holds the seeds every later
 * phase starts from (phase 1 enrolls the whole roster, `src/lib/tournament/enrollment-sync.ts`). A participant
 * without a seed there (no phase yet, or added later) follows the seeded ones by name, so the order is always
 * deterministic and auditable.
 */
import 'server-only';

import { toPublicPlayerRef } from '@/lib/players/public-player';
import { getDraftPoolsBySeasonWithGroups } from '@/lib/supabase/queries/drafts';
import { getSeasonGroups, seasonPhasesHaveRounds } from '@/lib/supabase/queries/season-groups';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getParticipants, getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import type { LeagueGroupsEditorDTO, LeagueGroupsParticipant } from '@/types/league-groups-editor';
import type { SeasonGroupWithMembers } from '@/types/season-group';

/**
 * The roster in seed order (pure): seeded participants by seed, then the unseeded ones by name, then id. Only
 * `{ id, name, seed }` leaves (allowlist).
 */
export function seedOrder(
  roster: readonly { id: string; name: string }[],
  seeds: ReadonlyMap<string, number>,
): LeagueGroupsParticipant[] {
  return roster
    .map((p) => ({ ...toPublicPlayerRef(p), seed: seeds.get(p.id) ?? null }))
    .sort((a, b) => {
      if (a.seed !== null && b.seed !== null) return a.seed - b.seed || a.id.localeCompare(b.id);
      if (a.seed !== null) return -1;
      if (b.seed !== null) return 1;
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
}

/**
 * The league's participants in seed order (roster + the first phase's seeds; two or three reads). A caller that
 * already read the league's phases (in `stage_order`) passes them and saves that read.
 */
export async function loadLeagueSeedOrder(
  seasonId: string,
  knownStages?: readonly { id: string }[],
): Promise<LeagueGroupsParticipant[]> {
  const [roster, stages] = await Promise.all([
    getSeasonParticipants(seasonId),
    knownStages ?? getStagesBySeasonId(seasonId),
  ]);
  const first = stages[0];
  const seeds = new Map<string, number>();
  if (first) {
    for (const p of await getParticipants(first.id)) if (p.seed !== null) seeds.set(p.id, p.seed);
  }
  return seedOrder(roster, seeds);
}

/**
 * The editor's DTO from the groups, the pools, the seeded roster and whether a phase of the league has a round
 * (pure). `scheduleLocked` wins over every other lock: once a phase has a round, nothing but a rename changes.
 */
export function toEditorDTO(
  groups: readonly SeasonGroupWithMembers[],
  pools: readonly { season_group_id: string | null; phase: string }[],
  participants: LeagueGroupsParticipant[],
  scheduleLocked = false,
): LeagueGroupsEditorDTO {
  const live = pools.filter((p) => p.phase !== 'cancelled');
  const lockedGroups = new Set(live.map((p) => p.season_group_id).filter((id): id is string => id != null));
  return {
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      sort_order: g.sort_order,
      player_ids: [...g.player_ids],
      locked: scheduleLocked || lockedGroups.has(g.id),
    })),
    participants,
    replaceLocked: scheduleLocked || live.length > 0,
    scheduleLocked,
  };
}

/**
 * Everything the editor shows, in one wave (groups, pools, phases; then the roster with the first phase's seeds and
 * the phases' round count). A write route that already read the phases passes them.
 */
export async function loadEditorDTO(
  seasonId: string,
  knownStages?: readonly { id: string }[],
): Promise<LeagueGroupsEditorDTO> {
  const stagesRead = knownStages ? Promise.resolve(knownStages) : getStagesBySeasonId(seasonId);
  const [groups, pools, [participants, scheduleLocked]] = await Promise.all([
    getSeasonGroups(seasonId),
    getDraftPoolsBySeasonWithGroups(seasonId),
    stagesRead.then((stages) =>
      Promise.all([
        loadLeagueSeedOrder(seasonId, stages),
        seasonPhasesHaveRounds(stages.map((stage) => stage.id)),
      ] as const),
    ),
  ]);
  return toEditorDTO(groups, pools, participants, scheduleLocked);
}
