/**
 * `group.form` of a kit stage: the phase's groups, formed from its enrolled players by the stage's `groups` spec
 * (`formKitGroups`) before its first round. Server only.
 *
 * League groups win: a phase of a league with groups mirrors them (`ensurePhaseGroupsFromLeague`) and this forms
 * nothing. A phase that already has groups (formed earlier, or built by an admin in the phase editor) or rounds
 * keeps them, and a `manual` spec forms nothing: the admin places the players.
 */
import 'server-only';

import type { Stage } from '@/lib/format-kit/types';
import { expireTournamentReads } from '@/lib/revalidation';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import {
  addGroupMembersBatch,
  createGroupBatch,
  getGroupsByTournament,
} from '@/lib/supabase/queries/tournament-groups';
import { getParticipants } from '@/lib/supabase/queries/tournaments';
import { groupLabel } from '@/lib/tournament/serpentine';
import type { TournamentGroupWithMembers } from '@/types/season';
import { formKitGroups } from './pairing';

export interface KitGroupsInput {
  seasonId: string;
  phaseId: string;
  stage: Pick<Stage, 'key' | 'groups'>;
  /** Server-side only: the season seed (`random_seeded`). */
  seed: string;
}

/** The phase's groups after forming them when the stage asks for groups and the phase has none yet. */
export async function ensureKitPhaseGroups(input: KitGroupsInput): Promise<TournamentGroupWithMembers[]> {
  const existing = await getGroupsByTournament(input.phaseId);
  const spec = input.stage.groups;
  if (existing.length > 0 || spec === undefined || spec.method === 'manual') return existing;
  const [leagueGroups, rounds, participants] = await Promise.all([
    seasonHasGroups(input.seasonId),
    getRoundsByTournament(input.phaseId),
    getParticipants(input.phaseId),
  ]);
  if (leagueGroups || rounds.length > 0) return existing;

  // Seed order (unseeded players last, in enrollment order): serpentine and straight deal by it.
  const ordered = participants
    .map((participant, index) => ({ id: participant.id, seed: participant.seed ?? Infinity, index }))
    .sort((a, b) => a.seed - b.seed || a.index - b.index)
    .map((participant) => participant.id);
  const formed = formKitGroups(ordered, spec, { seed: input.seed, stageKey: input.stage.key });
  if (formed.length === 0) return existing;

  const created = await createGroupBatch(
    formed.map((group) => ({
      tournament_id: input.phaseId,
      name: `Group ${groupLabel(group.group_number - 1)}`,
      group_number: group.group_number,
    })),
  );
  const idByNumber = new Map(created.map((group) => [group.group_number, group.id]));
  await addGroupMembersBatch(
    formed.flatMap((group) =>
      group.members.map((member) => ({
        group_id: idByNumber.get(group.group_number)!,
        player_id: member.player_id,
        seed: member.seed,
      })),
    ),
  );
  expireTournamentReads(input.phaseId, input.seasonId);
  return getGroupsByTournament(input.phaseId);
}
