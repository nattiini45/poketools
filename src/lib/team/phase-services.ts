import * as storage from '@/lib/supabase/queries/phase-teams';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { TeamChangedError, TeamMatchCompletedError } from './completed-match-lock';
import { resolveTeamWriteVerdict, type TeamRosterActor, type TeamWriteOp } from './team-roster-state';
import { checkPhaseTeamForkAccess } from './phase-visibility';
import type { PhaseTeam, PhaseTeamFormData } from '@/types/phase-team';
import type { Json } from '@/types/database';
import teamErrors from '@/i18n/messages/errors/teams/en';

export interface PhaseTeamActor { playerId: string; isAdmin: boolean }

function assertOwner(team: PhaseTeam, actor: PhaseTeamActor): TeamRosterActor {
  if (actor.isAdmin) return 'admin';
  if (actor.playerId !== team.player_id) throw new UserFacingError(teamErrors.team_not_owner, { code: 'team_not_owner', status: 403 });
  return 'owner';
}

async function requireTeam(id: string, code: 'team_not_found' | 'team_fork_source_not_found' = 'team_not_found'): Promise<PhaseTeam> {
  const team = await storage.getPhaseTeamById(id);
  if (!team) throw new UserFacingError(teamErrors[code], { code, status: 404 });
  return team;
}

async function assertWrite(team: PhaseTeam, actor: PhaseTeamActor, op: TeamWriteOp): Promise<TeamRosterActor> {
  const role = assertOwner(team, actor);
  const verdict = await resolveTeamWriteVerdict({ op, actor: role, locked: team.locked, linkedToMatch: team.match_id !== null,
    loadClosure: async () => {
      const phase = await getPhaseById(team.phase_id);
      if (!phase) throw new TeamChangedError();
      if (phase.status === 'completed') return 'tournament_completed';
      if (phase.archived) return 'tournament_archived';
      const season = await getSeasonById(phase.season_id);
      if (!season) throw new TeamChangedError();
      return season.status === 'completed' || season.archived ? 'league_closed' : null;
    },
    loadMatchCompleted: async () => {
      if (!team.match_id) return false;
      const match = await getPhaseMatchById(team.match_id);
      if (!match) throw new TeamChangedError();
      return match.status === 'completed';
    },
  });
  if (!verdict.ok) {
    if (verdict.state === 'match_completed') throw new TeamMatchCompletedError();
    const code = verdict.state === 'locked' ? 'team_locked' : verdict.closure === 'tournament_completed'
      ? 'team_submission_closed' : verdict.closure === 'tournament_archived'
        ? 'team_submission_tournament_archived' : 'team_submission_league_closed';
    throw new UserFacingError(teamErrors[code], { code, status: code === 'team_locked' ? 409 : 403 });
  }
  return role;
}

export function createPhaseTeamServices() {
  return {
    getById: storage.getPhaseTeamById,
    list: storage.listPhaseTeams,
    getPlanned: storage.getPlannedPhaseTeam,
    getForMatch: storage.getPlayerPhaseTeamForMatch,
    getMatchPrep: storage.getPhaseMatchPrepTeams,
    listLibrary: storage.listPhaseLibraryTeams,
    async create(actor: PhaseTeamActor, form: PhaseTeamFormData) {
      return storage.createPhaseTeam(actor.playerId, form, actor.isAdmin ? 'admin' : 'owner');
    },
    async edit(actor: PhaseTeamActor, id: string, form: Pick<PhaseTeamFormData, 'pokemon' | 'import_source' | 'name'>) {
      const team = await requireTeam(id);
      const role = await assertWrite(team, actor, 'edit');
      const result = await storage.writePhaseTeam({ p_operation: 'edit', p_team_id: id, p_phase_id: team.phase_id,
        p_player_id: team.player_id, p_pokemon: form.pokemon as unknown as Json, p_import_source: form.import_source,
        p_name: form.name, p_actor: role });
      if (!result) throw new TeamChangedError();
      return result;
    },
    async delete(actor: PhaseTeamActor, id: string) {
      const team = await requireTeam(id);
      const role = await assertWrite(team, actor, 'delete');
      await storage.writePhaseTeam({ p_operation: 'delete', p_team_id: id, p_phase_id: team.phase_id, p_player_id: team.player_id, p_actor: role });
    },
    async saveMatchPrep(actor: PhaseTeamActor, matchId: string, form: Pick<PhaseTeamFormData, 'pokemon' | 'import_source'>, targetPlayerId = actor.playerId) {
      const match = await getPhaseMatchById(matchId);
      if (!match) throw new UserFacingError('Match not found', { code: 'match_not_found', status: 404 });
      if ((!actor.isAdmin && actor.playerId !== targetPlayerId)
        || ![match.player_1_id, match.player_2_id].includes(targetPlayerId)) {
        throw new UserFacingError(teamErrors.match_prep_target_not_participant, { code: 'match_prep_target_not_participant', status: 403 });
      }
      if (match.status === 'completed' && !actor.isAdmin) throw new UserFacingError(teamErrors.match_prep_match_completed, { code: 'match_prep_match_completed', status: 409 });
      const team = await storage.writePhaseTeam({ p_operation: 'match_prep', p_phase_id: match.phase_id,
        p_player_id: targetPlayerId, p_match_id: matchId, p_pokemon: form.pokemon as unknown as Json,
        p_import_source: form.import_source, p_actor: actor.isAdmin ? 'admin' : 'participant' });
      const prep = (await storage.getPhaseMatchPrepTeams(matchId)).find((row) => row.player_id === targetPlayerId);
      if (!prep) throw new TeamChangedError();
      return { team, prep };
    },
    async share(actor: PhaseTeamActor, id: string) {
      const role = assertOwner(await requireTeam(id), actor);
      return storage.setPhaseTeamShareToken(id, role === 'admin' ? 'admin' : 'owner');
    },
    async unshare(actor: PhaseTeamActor, id: string) {
      assertOwner(await requireTeam(id), actor);
      return storage.disablePhaseTeamShareToken(id);
    },
    async publish(actor: PhaseTeamActor, id: string, metadata: { title?: string; description?: string; tags?: string[] }) {
      const team = await requireTeam(id);
      const role = assertOwner(team, actor);
      return storage.publishPhaseTeam(team, metadata, role === 'admin' ? 'admin' : 'owner');
    },
    async unpublish(actor: PhaseTeamActor, id: string) {
      assertOwner(await requireTeam(id), actor);
      return storage.unpublishPhaseTeam(id);
    },
    async fork(actor: PhaseTeamActor, id: string, token?: string) {
      const source = await requireTeam(id, 'team_fork_source_not_found');
      const access = await checkPhaseTeamForkAccess(source, token);
      if (access !== 'allowed') {
        const code = access === 'source_private' ? 'team_fork_source_private' : 'team_fork_share_token_invalid';
        throw new UserFacingError(teamErrors[code], { code, status: 403 });
      }
      return storage.forkPhaseTeamToLibrary(source, actor.playerId);
    },
    clearTeamsMatchPointer: (matchId: string) => storage.releasePhaseTeamsFromMatches([matchId]),
    async releaseTeams(matchId: string): Promise<void> {
      await storage.releasePhaseTeamsFromMatches([matchId]);
    },
    async releaseTeamsFromMatches(matchIds: readonly string[]): Promise<void> {
      await storage.releasePhaseTeamsFromMatches(matchIds);
    },
  };
}
