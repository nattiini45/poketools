/**
 * `group.form` of a kit stage: the phase's groups, formed from its enrolled players by the stage's `groups` spec
 * (`formKitGroups`) before its first round. Server only.
 *
 * League groups win: a phase of a league with groups mirrors them (`ensurePhaseGroupsFromLeague`) and this forms
 * nothing. A phase that already has groups (formed earlier, or built by an admin in the phase editor) or rounds
 * keeps them, and a `manual` spec forms nothing: the admin places the players.
 *
 * Two first-round generations of one phase can run at once (a double click, two admins). The database holds a unique
 * index on (tournament, group number) (`uq_tournament_groups_tournament_group_number`), so the second insert fails with
 * 23505 and answers 409 `groups_forming_in_progress`: the winner's call fills the groups, and the caller retries. The
 * cleanup that keeps the earliest inserted set of each group number (`settleGroups`) stays as the fallback for a database
 * without the index; keep the index, the guard is not safe against a concurrent insert without it.
 */
import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Stage } from '@/lib/format-kit/types';
import { expireTournamentReads } from '@/lib/revalidation';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import {
  addGroupMembersBatch,
  createGroupBatch,
  deleteGroup,
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
  if (existing.length > 0) {
    assertKitGroupsFormed(existing, input.stage);
    return existing;
  }
  if (spec === undefined || spec.method === 'manual') return existing;
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

  let created: Awaited<ReturnType<typeof createGroupBatch>>;
  try {
    created = await createGroupBatch(
      formed.map((group) => ({
        tournament_id: input.phaseId,
        name: `Group ${groupLabel(group.group_number - 1)}`,
        group_number: group.group_number,
      })),
    );
  } catch (error) {
    // A unique key on (phase, group number), where the database has one, refused the second of two concurrent inserts.
    if ((error as { code?: unknown } | null)?.code === '23505') throw formingInProgress();
    throw error;
  }
  const mine = new Set(created.map((group) => group.id));
  if (await settleGroups(input.phaseId, mine)) throw formingInProgress();
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
  // The other call may have inserted after the first check: settle again once the members are in.
  if (await settleGroups(input.phaseId, mine)) throw formingInProgress();
  expireTournamentReads(input.phaseId, input.seasonId);
  return getGroupsByTournament(input.phaseId);
}

/** Groups that are all empty and were inserted within this window may still be filled by the call that inserted them. */
export const KIT_GROUPS_FORMING_WINDOW_MS = 2 * 60_000;

/**
 * Throws 409 `groups_forming_in_progress` for the groups of a kit stage with a formed (non-`manual`) spec that are all
 * still empty and only just inserted: the call that formed them commits the group rows first and adds the members in a
 * second write, so a request that reads in between must not pair against them. Older empty groups (an admin built
 * them, or the winner died) are left to the caller, as a `manual` spec's empty groups always are.
 */
export function assertKitGroupsFormed(
  groups: readonly Pick<TournamentGroupWithMembers, 'created_at' | 'members'>[],
  stage: Pick<Stage, 'groups'>,
  now: number = Date.now(),
): void {
  const spec = stage.groups;
  if (spec === undefined || spec.method === 'manual' || groups.length === 0) return;
  if (groups.some((group) => group.members.length > 0)) return;
  const newest = Math.max(...groups.map((group) => Date.parse(group.created_at)));
  if (Number.isFinite(newest) && now - newest < KIT_GROUPS_FORMING_WINDOW_MS) throw formingInProgress();
}

function formingInProgress(): UserFacingError<'groups_forming_in_progress'> {
  return new UserFacingError('Another request is forming the groups of this phase right now.', {
    code: 'groups_forming_in_progress',
    status: 409,
  });
}

/**
 * Removes the groups of `mine` that another call inserted earlier for the same group number (earliest `created_at`,
 * then lowest id, wins). True when it removed some: this call lost the race and must stop.
 */
async function settleGroups(phaseId: string, mine: ReadonlySet<string>): Promise<boolean> {
  const all = await getGroupsByTournament(phaseId);
  const first = new Map<number, TournamentGroupWithMembers>();
  for (const group of all) {
    const current = first.get(group.group_number);
    if (current === undefined || group.created_at < current.created_at || (group.created_at === current.created_at && group.id < current.id)) {
      first.set(group.group_number, group);
    }
  }
  const losers = all.filter((group) => mine.has(group.id) && first.get(group.group_number)?.id !== group.id);
  for (const group of losers) await deleteGroup(group.id);
  return losers.length > 0;
}
