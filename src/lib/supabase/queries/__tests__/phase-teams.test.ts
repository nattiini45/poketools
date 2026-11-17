import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { phaseTeam } from '@/lib/team/__tests__/phase-team-fixture';
const { query, rpc, settle } = vi.hoisted(() => {
  const settle = vi.fn();
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const key of ['from', 'select', 'update', 'insert', 'eq', 'is', 'not', 'in', 'order', 'range', 'or', 'overlaps']) query[key] = vi.fn().mockReturnValue(query);
  query.single = vi.fn(); query.maybeSingle = vi.fn();
  query.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(settle()).then(resolve));
  return { query, settle, rpc: vi.fn().mockReturnValue(query) };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: query.from, rpc } }));
import { PHASE_TEAM_COLUMNS, getPhaseTeamById, getPlayerPhaseTeamForMatch, setPhaseTeamShareToken,
  writePhaseTeam, publishPhaseTeam, releasePhaseTeamsFromMatches, listPhaseTeamsForPinImpact, listPhaseTeams,
  forkPhaseTeamToLibrary } from '../phase-teams';
import { PhaseTeamRowConflictError } from '../phase-teams';

beforeEach(() => {
  for (const mock of Object.values(query)) mock.mockClear();
  query.maybeSingle.mockReset(); query.single.mockReset();
  settle.mockReset().mockReturnValue({ data: [], error: null });
  rpc.mockClear();
});

describe('native phase team persistence', () => {
  it('classifies conflicting native roster rows for the post-match audit without masking the cause', async () => {
    settle.mockReturnValue({ data: [phaseTeam({ id: 'one', match_id: 'match' }), phaseTeam({ id: 'two', match_id: 'match' })], error: null });
    await expect(getPlayerPhaseTeamForMatch('owner', { id: 'match', phase_id: 'phase' })).rejects.toBeInstanceOf(PhaseTeamRowConflictError);
  });
  it('never selects share capabilities on ordinary reads and maps phase identity', async () => {
    query.maybeSingle.mockResolvedValue({ data: { ...phaseTeam(), share_token: 'secret' }, error: null });
    const result = await getPhaseTeamById('id');
    expect(result).toEqual(phaseTeam());
    expect(result).not.toHaveProperty('share_token');
    expect(PHASE_TEAM_COLUMNS).not.toContain('share_');
    expect(query.from).toHaveBeenCalledWith('phase_teams');
  });

  it('uses the linked row before a planned fallback, never another match', async () => {
    settle.mockReturnValue({ data: [phaseTeam(), phaseTeam({ id: 'linked', match_id: 'match' })], error: null });
    expect((await getPlayerPhaseTeamForMatch('owner', { id: 'match', phase_id: 'phase' }))?.id).toBe('linked');
    expect(query.eq).toHaveBeenCalledWith('phase_id', 'phase');
    expect(query.or).toHaveBeenCalledWith('match_id.eq."match",match_id.is.null');
  });

  it('reads lists past a short server-capped page with stable ordering', async () => {
    settle.mockReturnValueOnce({ data: [phaseTeam()], error: null }).mockReturnValueOnce({ data: [phaseTeam({ id: 'next' })], error: null }).mockReturnValueOnce({ data: [], error: null });
    expect(await listPhaseTeams({ kind: 'phase', id: 'phase' })).toHaveLength(2);
    expect(query.range.mock.calls).toEqual([[0, 999], [1, 1000], [2, 1001]]);
    expect(query.order).toHaveBeenCalledWith('id');
  });

  it('uses guarded native RPC writes and maps completed-match failures', async () => {
    settle.mockReturnValue({ data: [phaseTeam()], error: null });
    const args = { p_operation: 'edit' as const, p_phase_id: 'phase', p_player_id: 'owner', p_actor: 'admin' as const };
    expect(await writePhaseTeam(args)).toEqual(phaseTeam());
    expect(rpc).toHaveBeenCalledWith('phase_team_roster_write', args);
    expect(query.select).toHaveBeenCalledWith(PHASE_TEAM_COLUMNS);
    settle.mockReturnValue({ data: null, error: { code: 'P0001', message: 'TEAM_MATCH_COMPLETED' } });
    await expect(writePhaseTeam(args)).rejects.toMatchObject({ code: 'team_match_completed' });
  });

  it('rotates a token with its old token as the CAS guard', async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: { share_token: 'old' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'id', share_token: 'new', share_enabled_at: 'now' }, error: null });
    expect(await setPhaseTeamShareToken('id')).toEqual({ team_id: 'id', share_token: 'new', share_enabled_at: 'now' });
    expect(query.eq).toHaveBeenCalledWith('share_token', 'old');
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(setPhaseTeamShareToken('id')).rejects.toMatchObject({ code: 'team_changed' });
  });

  it.each([
    ['team_submission_closed', 'Tournament is completed — team submission is closed', 403],
    ['team_not_tournament_participant', 'You are not a participant in this tournament', 403],
    ['team_already_submitted', 'You already have a team for this tournament', 409],
  ])('preserves the safe creation refusal %s', async (message, english, statusCode) => {
    settle.mockReturnValue({ data: null, error: { code: 'P0001', message } });
    await expect(writePhaseTeam({ p_operation: 'create', p_phase_id: 'phase', p_player_id: 'owner', p_actor: 'admin' }))
      .rejects.toMatchObject({ code: message, message: english, statusCode });
  });

  it('guards library publication against the read revision', async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(publishPhaseTeam(phaseTeam({ library_published_at: '2099-01-01T00:00:00.000Z' }), {})).rejects.toMatchObject({ code: 'team_changed' });
    expect(query.eq).toHaveBeenCalledWith('library_published_at', '2099-01-01T00:00:00.000Z');
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ library_published_at: '2099-01-01T00:00:00.001Z' }));
  });

  it('retains the native fork pointer in a personal library row', async () => {
    query.single.mockResolvedValue({ data: { id: 'new', pokemon: [] }, error: null });
    await forkPhaseTeamToLibrary(phaseTeam(), 'target');
    expect(query.insert).toHaveBeenCalledWith({ player_id: 'target', pokemon: [], import_source: 'manual', forked_from_phase_team_id: phaseTeam().id });
    expect(query.from).toHaveBeenCalledWith('teams');
  });

  it('releases the entire requested set in one RPC and propagates transaction failure', async () => {
    settle.mockReturnValue({ data: 2, error: null });
    expect(await releasePhaseTeamsFromMatches(['one', 'two', 'one'])).toBe(2);
    expect(rpc).toHaveBeenCalledWith('phase_teams_release_matches', { p_match_ids: ['one', 'two'] });
    const error = new Error('transfer failed');
    settle.mockReturnValue({ data: null, error });
    await expect(releasePhaseTeamsFromMatches(['one'])).rejects.toBe(error);
  });

  it('pin impact uses native joins and leaves completed-match rosters out', async () => {
    settle.mockReturnValue({ data: [
      { id: 'planned', player_id: 'owner', pokemon: [], match: null },
      { id: 'completed', player_id: 'owner', pokemon: [], match: { status: 'completed' } },
      { id: 'next', player_id: 'owner', pokemon: [], match: { status: 'scheduled' } },
    ], error: null });
    expect(await listPhaseTeamsForPinImpact('phase', 1)).toEqual({ teams: [{ id: 'planned', player_id: 'owner', pokemon: [] }], truncated: true });
    expect(query.select).toHaveBeenCalledWith('id, player_id, pokemon, match:phase_matches!phase_teams_phase_match_fkey(status)');
    expect(query.eq).toHaveBeenCalledWith('locked', false);
  });
});

describe('phase team SQL contract', () => {
  const sql = readFileSync('supabase/migrations/20261117130000_phase_team_services.sql', 'utf8');
  it('serializes both share stores and defers same-ID transfer validation to commit', () => {
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(2);
    expect(sql).toContain('v_other <> NEW.id');
    for (const table of ['teams', 'phase_teams']) expect(sql).toContain(`ON public.${table}\nFOR EACH ROW EXECUTE FUNCTION public.team_global_share_lock()`);
  });
  it('keeps release fenced, conditional and atomic with both-store lineage repair', () => {
    expect(sql).toContain('phase_storage_not_ready');
    expect(sql).toContain('AND match_id IS NULL AND id <> v_row.id');
    expect(sql).toContain('INSERT INTO public.teams (id, player_id, name, season_id');
    for (const table of ['teams', 'phase_teams']) expect(sql).toContain(`UPDATE public.${table} SET forked_from_phase_team_id = NULL, forked_from_team_id = v_row.id`);
    expect(sql).not.toContain('SET phase_id = NULL');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
  });
});
