import 'server-only';

import { expireSeasonReads, expireTournamentReads } from '@/lib/revalidation';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import { addGroupMembersBatch, createGroupBatch, deleteGroup, deleteGroupsByTournament, getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getParticipants } from '@/lib/supabase/queries/tournaments';
import type { PhaseGroupWithMembers } from '@/types/league-phase';
import type { TournamentGroupWithMembers } from '@/types/season';

export interface KitGroup {
  id: string;
  group_number: number;
  created_at: string;
  members: readonly { player_id: string }[];
}

export interface KitGroupsStorage<G extends KitGroup = KitGroup> {
  groups(phaseId: string): Promise<G[]>;
  leagueGroups(seasonId: string): Promise<boolean>;
  rounds(phaseId: string): Promise<readonly { id: string }[]>;
  participants(phaseId: string): Promise<readonly { id: string; seed: number | null }[]>;
  deleteAll(phaseId: string): Promise<void>;
  create(seasonId: string, phaseId: string, groups: { name: string; group_number: number }[]): Promise<{ id: string; group_number: number }[]>;
  addMembers(phaseId: string, members: { group_id: string; player_id: string; seed: number }[]): Promise<void>;
  delete(phaseId: string, groupId: string): Promise<void>;
  invalidate(seasonId: string, phaseIds: readonly string[]): void;
}

export const legacyKitGroups: KitGroupsStorage<TournamentGroupWithMembers> = {
  groups: (id) => getGroupsByTournament(id),
  leagueGroups: (id) => seasonHasGroups(id),
  rounds: (id) => getRoundsByTournament(id),
  participants: (id) => getParticipants(id),
  deleteAll: (id) => deleteGroupsByTournament(id),
  create: (_seasonId, phaseId, groups) => createGroupBatch(groups.map((group) => ({ ...group, tournament_id: phaseId }))),
  addMembers: (_phaseId, members) => addGroupMembersBatch(members),
  delete: (_phaseId, id) => deleteGroup(id),
  invalidate: (seasonId, ids) => { for (const id of ids) expireTournamentReads(id, seasonId); },
};

export const nativeKitGroups: KitGroupsStorage<PhaseGroupWithMembers> = {
  groups: async (id) => (await import('@/lib/supabase/queries/phase-groups')).getGroupsByPhase(id),
  leagueGroups: (id) => seasonHasGroups(id),
  rounds: async (id) => (await import('@/lib/supabase/queries/phase-rounds')).getRoundsByPhase(id),
  participants: async (id) => (await import('@/lib/supabase/queries/league-phases')).getPhaseParticipants(id),
  deleteAll: async (id) => (await import('@/lib/supabase/queries/phase-groups')).deleteGroupsByPhase(id),
  create: async (seasonId, phaseId, groups) => (await import('@/lib/supabase/queries/phase-groups')).createPhaseGroupBatch(
    groups.map((group) => ({ ...group, phase_id: phaseId, season_id: seasonId })),
  ),
  addMembers: async (phaseId, members) => (await import('@/lib/supabase/queries/phase-groups')).addPhaseGroupMembersBatch(
    members.map((member) => ({ ...member, phase_id: phaseId })),
  ),
  delete: async (phaseId, id) => (await import('@/lib/supabase/queries/phase-groups')).deletePhaseGroup(phaseId, id),
  invalidate: (seasonId) => expireSeasonReads(seasonId),
};
