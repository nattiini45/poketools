import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';
import { readBoundedPages } from '../read-bounded-pages';
import { ilikeAnyOf, postgrestQuoted } from '../postgrest-filter';
import { TEAM_COLUMNS, type TeamVisibilityFacts, type PinImpactTeam } from './teams';
import type { TeamLeadWithFacts } from './teams';
import { TeamChangedError, throwTeamWriteError } from '@/lib/team/completed-match-lock';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Json, Tables } from '@/types/database';
import type { PhaseTeam, PhaseTeamFormData, PhaseMatchPrepTeam } from '@/types/phase-team';
import type { Team, TeamLibraryListParams, TeamShareLink } from '@/types/team';
import { canWriteTeam, teamLockState, type TeamRosterActor } from '@/lib/team/team-roster-state';
import type { MatchStatus } from '@/types/match';
import teamErrors from '@/i18n/messages/errors/teams/en';
import { teamLibraryMachine, teamShareMachine, type TeamFlagActor } from '@/lib/team/team-share-state';
import { assertValidUuid } from '@/lib/utils/uuid';

export const PHASE_TEAM_COLUMNS = 'id, player_id, phase_id, season_id, name, match_id, pokemon, import_source, locked, is_draft_team, draft_pool_id, library_published_at, library_title, library_description, library_tags, forked_from_team_id, forked_from_phase_team_id, created_at, updated_at' as const;
const PREP_COLUMNS = 'id, match_id, player_id, pokemon, import_source, created_at, updated_at' as const;
type Row = Omit<Tables<'phase_teams'>, 'share_token' | 'share_enabled_at'>;
type RosterArgs = {
  p_operation: 'create' | 'edit' | 'delete' | 'match_prep';
  p_phase_id: string;
  p_player_id: string;
  p_team_id?: string;
  p_match_id?: string;
  p_pokemon?: Json;
  p_import_source?: PhaseTeam['import_source'];
  p_name?: string;
  p_actor: TeamRosterActor;
};

function toTeam(row: Row): PhaseTeam {
  return {
    id: row.id, player_id: row.player_id, phase_id: row.phase_id, season_id: row.season_id,
    name: row.name, match_id: row.match_id, pokemon: row.pokemon as unknown as PhaseTeam['pokemon'],
    import_source: row.import_source, locked: row.locked, is_draft_team: row.is_draft_team,
    draft_pool_id: row.draft_pool_id, library_published_at: row.library_published_at,
    library_title: row.library_title, library_description: row.library_description, library_tags: row.library_tags,
    forked_from_team_id: row.forked_from_team_id, forked_from_phase_team_id: row.forked_from_phase_team_id,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export async function getPhaseTeamById(id: string): Promise<PhaseTeam | null> {
  const { data, error } = await supabase.from('phase_teams').select(PHASE_TEAM_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toTeam(data) : null;
}

export async function listPhaseTeams(scope: { kind: 'phase' | 'player' | 'season'; id: string }): Promise<PhaseTeam[]> {
  const column = { phase: 'phase_id', player: 'player_id', season: 'season_id' } as const;
  const rows = await readAllPages<Row>((from, to) => supabase.from('phase_teams').select(PHASE_TEAM_COLUMNS)
    .eq(column[scope.kind], scope.id).order('created_at').order('id').range(from, to));
  return rows.map(toTeam);
}

export async function getPlannedPhaseTeam(playerId: string, phaseId: string): Promise<PhaseTeam | null> {
  const { data, error } = await supabase.from('phase_teams').select(PHASE_TEAM_COLUMNS)
    .eq('player_id', playerId).eq('phase_id', phaseId).is('match_id', null).maybeSingle();
  if (error) throw error;
  return data ? toTeam(data) : null;
}

/**
 * The player's team for a phase as the teambuilder names one: their planned row, else the newest row they registered
 * for a match of that phase (the teambuilder is one team per competition; a match's own prep editor reads its row
 * through `getPlayerPhaseTeamForMatch`).
 */
export async function getPlayerPhaseTeamForPhase(playerId: string, phaseId: string): Promise<PhaseTeam | null> {
  const planned = await getPlannedPhaseTeam(playerId, phaseId);
  if (planned) return planned;
  const { data, error } = await supabase.from('phase_teams').select(PHASE_TEAM_COLUMNS)
    .eq('player_id', playerId).eq('phase_id', phaseId).not('match_id', 'is', null)
    .order('created_at', { ascending: false }).order('id').limit(1);
  if (error) throw error;
  return data?.[0] ? toTeam(data[0]) : null;
}

export class PhaseTeamRowConflictError extends Error {
  constructor() {
    super('Conflicting phase team rows');
    this.name = 'PhaseTeamRowConflictError';
  }
}

export async function getPlayerPhaseTeamForMatch(playerId: string, match: { id: string; phase_id: string }): Promise<PhaseTeam | null> {
  const { data, error } = await supabase.from('phase_teams').select(PHASE_TEAM_COLUMNS)
    .eq('player_id', playerId).eq('phase_id', match.phase_id)
    .or(`match_id.eq.${postgrestQuoted(match.id)},match_id.is.null`).order('id');
  if (error) throw error;
  const linked = (data ?? []).filter((row) => row.match_id === match.id);
  const planned = (data ?? []).filter((row) => row.match_id === null);
  if (linked.length > 1 || (!linked.length && planned.length > 1)) throw new PhaseTeamRowConflictError();
  const row = linked[0] ?? planned[0];
  return row ? toTeam(row) : null;
}

function writeError(error: unknown, operation: RosterArgs['p_operation']): never {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : null;
  if (message === 'team_changed') throw new TeamChangedError();
  if (message === 'team_already_submitted') throw new UserFacingError(teamErrors.team_already_submitted, { code: 'team_already_submitted', status: 409 });
  if (operation === 'match_prep' && message === 'TEAM_MATCH_COMPLETED') {
    throw new UserFacingError(teamErrors.match_prep_match_completed, { code: 'match_prep_match_completed', status: 409 });
  }
  const codes = ['team_locked', 'team_submission_closed', 'team_submission_tournament_archived', 'team_submission_league_closed', 'team_not_tournament_participant', 'match_prep_target_not_participant'] as const;
  for (const code of codes) {
    if (message === code) throw new UserFacingError(teamErrors[code], { code, status: code === 'team_locked' ? 409 : 403 });
  }
  throwTeamWriteError(error);
}

export async function writePhaseTeam(args: RosterArgs): Promise<PhaseTeam | null> {
  const { data, error } = await supabase.rpc('phase_team_roster_write', args).select(PHASE_TEAM_COLUMNS);
  if (error) writeError(error, args.p_operation);
  return data?.[0] ? toTeam(data[0]) : null;
}

export async function createPhaseTeam(playerId: string, form: PhaseTeamFormData, actor: TeamRosterActor): Promise<PhaseTeam> {
  const team = await writePhaseTeam({ p_operation: 'create', p_phase_id: form.phase_id, p_player_id: playerId,
    p_pokemon: form.pokemon as unknown as Json, p_import_source: form.import_source, p_name: form.name, p_actor: actor });
  if (!team) throw new TeamChangedError();
  return team;
}

export async function getPhaseMatchPrepTeams(matchId: string): Promise<PhaseMatchPrepTeam[]> {
  const { data, error } = await supabase.from('phase_match_prep_teams').select(PREP_COLUMNS).eq('match_id', matchId);
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, pokemon: row.pokemon as unknown as PhaseTeam['pokemon'] }));
}

export async function getPlayerPhaseMatchPrep(matchId: string, playerId: string): Promise<PhaseMatchPrepTeam | null> {
  const { data, error } = await supabase.from('phase_match_prep_teams').select(PREP_COLUMNS)
    .eq('match_id', matchId).eq('player_id', playerId).maybeSingle();
  if (error) throw error;
  return data ? { ...data, pokemon: data.pokemon as unknown as PhaseTeam['pokemon'] } : null;
}

export async function releasePhaseTeamsFromMatches(matchIds: readonly string[]): Promise<number> {
  const { data, error } = await supabase.rpc('phase_teams_release_matches', { p_match_ids: [...new Set(matchIds)] });
  if (error) throw error;
  return data;
}

export async function getPhaseTeamVisibilityFacts(ids: readonly string[]): Promise<Map<string, TeamVisibilityFacts>> {
  const out = new Map<string, TeamVisibilityFacts>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await supabase.from('phase_teams')
      .select('id, match:phase_matches!phase_teams_phase_match_fkey(status), phase:league_phases!phase_teams_phase_id_fkey(team_visibility)')
      .in('id', unique.slice(i, i + 100));
    if (error) throw error;
    for (const row of data ?? []) out.set(row.id, { match_status: row.match?.status ?? null, tournament_visibility: row.phase?.team_visibility ?? null });
  }
  return out;
}

export async function listSeasonPhaseRostersWithFacts(seasonId: string, playerId?: string) {
  const rows = await readAllPages((from, to) => {
    const query = supabase.from('phase_teams')
      .select(`
        id, player_id, match_id, created_at, library_published_at, pokemon,
        match:phase_matches!phase_teams_phase_match_fkey ( status ),
        phase:league_phases!phase_teams_phase_id_fkey!inner ( team_visibility )
      `)
      .eq('phase.season_id', seasonId);
    if (playerId !== undefined) query.eq('player_id', playerId);
    return query.order('created_at').order('id').range(from, to);
  });
  return rows.map(({ id, player_id, match_id, created_at, library_published_at, pokemon, match, phase }) => ({
    id, player_id, match_id, created_at, library_published_at,
    pokemon: pokemon as unknown as PhaseTeam['pokemon'],
    facts: {
      match_status: match?.status ?? null,
      tournament_visibility: phase?.team_visibility ?? null,
    },
  }));
}

export async function listSeasonPhaseTeamLeadsWithFacts(seasonId: string): Promise<TeamLeadWithFacts[]> {
  assertValidUuid(seasonId, 'seasonId');
  const { rows } = await readBoundedPages(
    (from, to) => supabase.from('phase_teams')
      .select(`
        id, player_id, updated_at, lead_species:pokemon->0->>species,
        match:phase_matches!phase_teams_phase_match_fkey ( status ),
        phase:league_phases!phase_teams_phase_id_fkey!inner ( team_visibility )
      `)
      .eq('phase.season_id', seasonId).order('created_at').order('id').range(from, to),
    { label: 'listSeasonPhaseTeamLeadsWithFacts' },
  );
  return rows.map(row => ({
    id: row.id,
    player_id: row.player_id,
    updated_at: row.updated_at,
    lead_species: typeof row.lead_species === 'string' ? row.lead_species : null,
    facts: {
      match_status: row.match?.status ?? null,
      tournament_visibility: row.phase?.team_visibility ?? null,
    },
  }));
}

export async function getPhaseTeamByShareToken(token: string): Promise<PhaseTeam | null> {
  const { data, error } = await supabase.from('phase_teams').select(PHASE_TEAM_COLUMNS)
    .eq('share_token', token).not('share_enabled_at', 'is', null).maybeSingle();
  if (error) throw error;
  return data ? toTeam(data) : null;
}

export async function setPhaseTeamShareToken(id: string, actor: TeamFlagActor = 'owner'): Promise<TeamShareLink> {
  const { data: current, error: readError } = await supabase.from('phase_teams').select('share_token, share_enabled_at').eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!current) throw new TeamChangedError();
  teamShareMachine.assertTransition(current.share_token && current.share_enabled_at ? 'on' : 'off', 'on', actor);
  const update = supabase.from('phase_teams').update({ share_token: crypto.randomUUID(), share_enabled_at: new Date().toISOString() }).eq('id', id);
  const { data, error } = await (current.share_token === null ? update.is('share_token', null) : update.eq('share_token', current.share_token))
    .select('id, share_token, share_enabled_at').maybeSingle();
  if (error) throw error;
  if (!data?.share_token || !data.share_enabled_at) throw new TeamChangedError();
  return { team_id: data.id, share_token: data.share_token, share_enabled_at: data.share_enabled_at };
}

export async function disablePhaseTeamShareToken(id: string): Promise<void> {
  const { error } = await supabase.from('phase_teams').update({ share_token: null, share_enabled_at: null }).eq('id', id);
  if (error) throw error;
}

export async function publishPhaseTeam(team: PhaseTeam, metadata: { title?: string; description?: string; tags?: string[] }, actor: TeamFlagActor = 'owner'): Promise<PhaseTeam> {
  teamLibraryMachine.assertTransition(team.library_published_at ? 'published' : 'unpublished', 'published', actor);
  const update = supabase.from('phase_teams').update({ library_published_at: new Date(Math.max(
    Date.now(), team.library_published_at === null ? 0 : Date.parse(team.library_published_at) + 1,
  )).toISOString(),
    library_title: metadata.title ?? null, library_description: metadata.description ?? null, library_tags: metadata.tags ?? [] }).eq('id', team.id);
  const { data, error } = await (team.library_published_at === null ? update.is('library_published_at', null) : update.eq('library_published_at', team.library_published_at))
    .select(PHASE_TEAM_COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) throw new TeamChangedError();
  return toTeam(data);
}

export async function unpublishPhaseTeam(id: string): Promise<PhaseTeam> {
  const { data, error } = await supabase.from('phase_teams').update({ library_published_at: null, library_title: null,
    library_description: null, library_tags: null }).eq('id', id).select(PHASE_TEAM_COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) throw new TeamChangedError();
  return toTeam(data);
}

export async function listPhaseLibraryTeams(params: TeamLibraryListParams = {}): Promise<{ data: PhaseTeam[]; total: number }> {
  const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
  const offset = Math.max(0, params.offset ?? 0);
  let query = supabase.from('phase_teams').select(PHASE_TEAM_COLUMNS, { count: 'exact' })
    .not('library_published_at', 'is', null).order('library_published_at', { ascending: false }).order('id').range(offset, offset + limit - 1);
  if (params.tags?.length) query = query.overlaps('library_tags', params.tags);
  if (params.search) query = query.or(ilikeAnyOf(['library_title', 'library_description'], params.search));
  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data ?? []).map(toTeam), total: count ?? 0 };
}

export async function forkPhaseTeamToLibrary(source: PhaseTeam, playerId: string): Promise<Team> {
  const { data, error } = await supabase.from('teams').insert({ player_id: playerId,
    pokemon: source.pokemon as unknown as Json, import_source: 'manual', forked_from_phase_team_id: source.id })
    .select(TEAM_COLUMNS).single();
  if (error) throw error;
  return { ...data, pokemon: data.pokemon as unknown as Team['pokemon'] };
}

export async function listPhaseTeamsForPinImpact(phaseId: string, budget: number): Promise<{ teams: PinImpactTeam[]; truncated: boolean }> {
  const { rows, truncated } = await readBoundedPages<{
    id: string; player_id: string; pokemon: Json; match: { status: MatchStatus } | null;
  }>((from, to) => supabase.from('phase_teams')
    .select('id, player_id, pokemon, match:phase_matches!phase_teams_phase_match_fkey(status)')
    .eq('phase_id', phaseId).eq('locked', false).order('id').range(from, to),
  { label: 'listPhaseTeamsForPinImpact', maxPages: Math.max(1, Math.ceil(budget / 1000)) });
  const open = rows.filter((row) => canWriteTeam(teamLockState({ locked: false, linkedToMatch: row.match !== null,
    closure: null, matchCompleted: row.match?.status === 'completed' }), 'edit', 'owner'));
  return { teams: open.slice(0, budget).map((row) => ({ id: row.id, player_id: row.player_id,
    pokemon: row.pokemon as unknown as PhaseTeam['pokemon'] })), truncated: truncated || open.length > budget };
}
