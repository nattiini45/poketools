import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../route';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { makeSet } from '@/test/team-fixtures';

const mock = vi.hoisted(() => ({
  requirePlayer: vi.fn(), getPhaseRouteMode: vi.fn(),
  findNativePhaseAliasOwner: vi.fn(), findLegacyPhaseAliasOwner: vi.fn(), standaloneMatchAliasExists: vi.fn(),
  getPhaseMatchById: vi.fn(), getPhaseById: vi.fn(), isPlayerPhaseParticipant: vi.fn(), getPhaseRoundById: vi.fn(),
  getSeasonById: vi.fn(), getRulesetById: vi.fn(), getSeasonFormat: vi.fn(), getFormatRuntime: vi.fn(),
  getPlayerPhaseMatchPrep: vi.fn(), writePhaseTeam: vi.fn(), getPhaseMatchPrepTeams: vi.fn(),
  getMatchById: vi.fn(), getTournamentById: vi.fn(), getRoundById: vi.fn(), getMatchPrepTeam: vi.fn(),
  upsertMatchPrepTeam: vi.fn(), upsertTeamForMatch: vi.fn(), expireItemUsageReads: vi.fn(),
  checkTeam: vi.fn(), assertEpbTeamCompliant: vi.fn(), assertNoSuspendedLinesInTeam: vi.fn(),
  expirePhaseReads: vi.fn(), expirePublicTags: vi.fn(),
}));

vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: mock.requirePlayer }));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: mock.getPhaseRouteMode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => mock);
vi.mock('@/lib/supabase/queries/phase-matches', () => mock);
vi.mock('@/lib/supabase/queries/league-phases', () => mock);
vi.mock('@/lib/supabase/queries/phase-rounds', () => mock);
vi.mock('@/lib/supabase/queries/phase-teams', () => mock);
vi.mock('@/lib/supabase/queries/seasons', () => mock);
vi.mock('@/lib/supabase/queries/rulesets', () => mock);
vi.mock('@/lib/supabase/queries/season-formats', () => mock);
vi.mock('@/lib/supabase/queries/format-runtime', () => mock);
vi.mock('@/lib/supabase/queries/matches', () => mock);
vi.mock('@/lib/supabase/queries/tournaments', () => mock);
vi.mock('@/lib/supabase/queries/rounds', () => mock);
vi.mock('@/lib/supabase/queries/match-prep-teams', () => mock);
vi.mock('@/lib/supabase/queries/teams', () => mock);
vi.mock('@/lib/team/item-usage-cache', () => mock);
vi.mock('@/lib/team/check.server', () => mock);
vi.mock('@/lib/draft/epb-team-validation', () => mock);
vi.mock('@/lib/revalidation', () => ({
  ...mock,
  publicTags: { aggregates: (scope: string, id: string | null) => ['aggregates', scope, id].filter(Boolean).join(':') },
}));

const matchId = 'ab000000-0000-4000-8000-000000000001';
const playerId = 'ab000000-0000-4000-8000-000000000002';
const opponentId = 'ab000000-0000-4000-8000-000000000003';
const outsider = 'ab000000-0000-4000-8000-000000000004';
const owner = { kind: 'phase', phase_id: 'native-phase', season_id: 'league' };
const match = { id: matchId, phase_id: owner.phase_id, round_id: 'round', player_1_id: playerId, player_2_id: opponentId, status: 'scheduled' };
const pin = makeRuleset({ id: 'pinned-version' });
const phase = { id: owner.phase_id, season_id: owner.season_id, ruleset_id: pin.id, current_round: 8, format_stage_key: null };
const round = { id: match.round_id, phase_id: phase.id, round_number: 3 };
const pokemon = [makeSet('Pikachu')];
const prep = { id: 'prep', match_id: matchId, player_id: playerId, pokemon, import_source: 'manual', created_at: '', updated_at: '' };
const clean = { valid: true, issues: [], team_issues: [] };

const get = () => GET(new NextRequest(`http://localhost/api/match-prep?match_id=${matchId.toUpperCase()}&player_id=${opponentId}`));
const post = (extra: Record<string, unknown> = {}) => POST(new NextRequest('http://localhost/api/match-prep', {
  method: 'POST',
  body: JSON.stringify({ match_id: matchId.toUpperCase(), pokemon, ...extra }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mock.requirePlayer.mockResolvedValue({ playerId, isAdmin: false });
  mock.getPhaseRouteMode.mockResolvedValue('phase');
  mock.findNativePhaseAliasOwner.mockResolvedValue(owner);
  mock.getPhaseMatchById.mockResolvedValue(match);
  mock.getPhaseById.mockResolvedValue(phase);
  mock.isPlayerPhaseParticipant.mockResolvedValue(true);
  mock.getPhaseRoundById.mockResolvedValue(round);
  mock.getSeasonById.mockResolvedValue({ id: owner.season_id, format_type: 'singles' });
  mock.getRulesetById.mockResolvedValue(pin);
  mock.getPlayerPhaseMatchPrep.mockResolvedValue(prep);
  mock.writePhaseTeam.mockResolvedValue({ id: 'team' });
  mock.checkTeam.mockResolvedValue(clean);
});

describe('ID-only phase match preparation', () => {
  it('reads only live participant prep, ignoring any supplied target', async () => {
    expect(await (await get()).json()).toEqual({ success: true, data: prep });
    expect(mock.findNativePhaseAliasOwner).toHaveBeenCalledWith({ matchId });
    expect(mock.isPlayerPhaseParticipant).toHaveBeenCalledWith(playerId, phase.id);
    expect(mock.getPlayerPhaseMatchPrep).toHaveBeenCalledExactlyOnceWith(matchId, playerId);
    expect(mock.getPhaseMatchPrepTeams).not.toHaveBeenCalled();
    expect(mock.getMatchPrepTeam).not.toHaveBeenCalled();
  });

  it('does not read prep for an unenrolled participant or a non-playing site admin', async () => {
    mock.isPlayerPhaseParticipant.mockResolvedValue(false);
    expect((await get()).status).toBe(403);
    mock.requirePlayer.mockResolvedValue({ playerId: outsider, isAdmin: true });
    expect(await (await get()).json()).toEqual({ success: true, data: null });
    expect(mock.getPlayerPhaseMatchPrep).not.toHaveBeenCalled();
  });

  it('writes through the native writer with the live player and phase, and expires native tags after commit', async () => {
    const response = await post({ player_id: opponentId, phase_id: 'untrusted' });
    expect(await response.json()).toEqual({ success: true, data: prep });
    expect(mock.getRulesetById).toHaveBeenCalledExactlyOnceWith(pin.id);
    expect(mock.checkTeam).toHaveBeenCalledWith(expect.objectContaining({ ruleset: pin, playerId, seasonId: owner.season_id }));
    expect(mock.writePhaseTeam).toHaveBeenCalledExactlyOnceWith({
      p_operation: 'match_prep', p_actor: 'participant', p_phase_id: phase.id, p_match_id: matchId,
      p_player_id: playerId, p_pokemon: pokemon, p_import_source: 'manual',
    });
    expect(mock.expirePhaseReads).toHaveBeenCalledExactlyOnceWith(phase.id, owner.season_id);
    expect(mock.expirePublicTags).toHaveBeenCalledExactlyOnceWith([
      'aggregates:phase:native-phase', 'aggregates:league:league', 'aggregates:all_time',
    ]);
    expect(mock.expirePhaseReads.mock.invocationCallOrder[0]).toBeGreaterThan(mock.writePhaseTeam.mock.invocationCallOrder[0]);
    expect(mock.upsertMatchPrepTeam).not.toHaveBeenCalled();
    expect(mock.upsertTeamForMatch).not.toHaveBeenCalled();
    expect(mock.getMatchById).not.toHaveBeenCalled();
    expect(mock.getTournamentById).not.toHaveBeenCalled();
  });

  it('keeps a completed roster final for participants but allows an explicit site-admin correction without private advice', async () => {
    mock.getPhaseMatchById.mockResolvedValue({ ...match, status: 'completed' });
    expect(await (await post()).json()).toMatchObject({ code: 'match_prep_match_completed' });
    expect(mock.writePhaseTeam).not.toHaveBeenCalled();
    mock.requirePlayer.mockResolvedValue({ playerId: outsider, isAdmin: true });
    mock.getPlayerPhaseMatchPrep.mockResolvedValue({ ...prep, player_id: opponentId });
    const response = await post({ player_id: opponentId.toUpperCase() });
    expect(response.status).toBe(200);
    expect(mock.writePhaseTeam).toHaveBeenCalledWith(expect.objectContaining({ p_actor: 'admin', p_player_id: opponentId }));
    expect(mock.checkTeam).not.toHaveBeenCalled();
    expect(mock.getFormatRuntime).not.toHaveBeenCalled();
  });

  it('returns the prep when the writer preserves a manually locked registered roster', async () => {
    mock.writePhaseTeam.mockResolvedValue(null);
    expect(await (await post()).json()).toEqual({ success: true, data: prep });
    expect(mock.expirePhaseReads).toHaveBeenCalled();
    expect(mock.expirePublicTags).not.toHaveBeenCalled();
  });

  it('maps a freeze that races the request to a typed refusal, with no prep read or cache expiry', async () => {
    mock.writePhaseTeam.mockRejectedValue({ code: 'P0001', message: 'phase_storage_not_ready' });
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'phase_storage_unavailable' });
    expect(mock.getPlayerPhaseMatchPrep).not.toHaveBeenCalled();
    expect(mock.expirePhaseReads).not.toHaveBeenCalled();
  });

  it('requires EPB compliance and matchday suspension checks before writing', async () => {
    mock.getSeasonById.mockResolvedValue({ id: owner.season_id, format_type: 'evolution_point_buy' });
    mock.assertNoSuspendedLinesInTeam.mockRejectedValue(new UserFacingError('Suspended line', { code: 'suspended_line_in_team' }));
    const response = await post();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'suspended_line_in_team' });
    expect(mock.assertEpbTeamCompliant).toHaveBeenCalledExactlyOnceWith(owner.season_id, playerId, pokemon);
    expect(mock.assertNoSuspendedLinesInTeam).toHaveBeenCalledExactlyOnceWith(owner.season_id, playerId, 3, pokemon);
    expect(mock.writePhaseTeam).not.toHaveBeenCalled();
  });

  it('checks a frozen Kit stage against the native match round, not the latest round or the format head stage', async () => {
    mock.getSeasonById.mockResolvedValue({ id: owner.season_id, format_type: 'custom' });
    mock.getSeasonFormat.mockResolvedValue({
      season_id: owner.season_id, engine: 'kit', seed: 'test-seed', spec: { stages: [] },
    });
    mock.getFormatRuntime.mockResolvedValue({
      flags: [], relationLinks: [], resourceItems: [], actionSubmissions: [], playerAttrs: [], trackProgress: [],
      adjustments: [], checks: [], eventLog: [],
    });
    const stage = {
      key: 'cup',
      name: { en: { v: 'Cup', s: 'human' }, base: 'en' },
      participants: { from: 'roster', seeding: 'signup' },
      pairing: { kind: 'round_robin' },
      series: { best_of: 3 },
      scoring: { win: 3, loss: 0, bye: 0 },
      constraints: [{
        kind: 'roster_size', min: 2, max: 2,
        when: { k: 'cmp', op: '<=', a: { k: 'ref', name: 'round', t: 'number' }, b: { k: 'num', v: 3 } },
      }],
    };
    mock.getPhaseById.mockResolvedValue({ ...phase, format_stage_key: stage.key, stage_spec: { stage } });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true, team_check: { status: 'unmet', verdict: { team_issue_details: [{ code: 'kit_roster_size' }] } },
    });
    expect(mock.getPhaseRoundById).toHaveBeenCalledExactlyOnceWith(match.round_id);
    expect(mock.getRoundById).not.toHaveBeenCalled();
    expect(mock.writePhaseTeam).toHaveBeenCalled();
  });

  it('refuses a missing pin, mismatched native round, and unmaterialized Kit policy before writing', async () => {
    mock.getRulesetById.mockResolvedValueOnce(null);
    expect(await (await post()).json()).toMatchObject({ code: 'ruleset_not_found' });
    mock.getPhaseRoundById.mockResolvedValueOnce({ ...round, phase_id: 'wrong' });
    expect(await (await post()).json()).toMatchObject({ code: 'round_not_found' });
    mock.getSeasonById.mockResolvedValue({ id: owner.season_id, format_type: 'custom' });
    mock.getSeasonFormat.mockResolvedValue({ season_id: owner.season_id, engine: 'kit' });
    expect(await (await post()).json()).toMatchObject({ code: 'format_context_stale' });
    expect(mock.writePhaseTeam).not.toHaveBeenCalled();
  });

  it('refuses a mismatched native owner without falling back to a standalone', async () => {
    mock.getPhaseById.mockResolvedValue({ ...phase, season_id: 'other' });
    expect(await (await get()).json()).toMatchObject({ code: 'PHASE_NOT_FOUND' });
    expect(await (await post()).json()).toMatchObject({ code: 'PHASE_NOT_FOUND' });
    expect(mock.getPlayerPhaseMatchPrep).not.toHaveBeenCalled();
    expect(mock.writePhaseTeam).not.toHaveBeenCalled();
    expect(mock.standaloneMatchAliasExists).not.toHaveBeenCalled();
  });

  it.each(['frozen_legacy', 'frozen_phase'])('refuses known league matches in %s mode without reading prep', async (mode) => {
    mock.getPhaseRouteMode.mockResolvedValue(mode);
    mock.findLegacyPhaseAliasOwner.mockResolvedValue(mode === 'frozen_legacy' ? { tournament_id: 'legacy', season_id: owner.season_id } : null);
    expect(await (await get()).json()).toMatchObject({ code: 'phase_storage_unavailable' });
    expect((await post()).status).toBe(503);
    expect(mock.getPhaseMatchById).not.toHaveBeenCalled();
    expect(mock.getMatchPrepTeam).not.toHaveBeenCalled();
    expect(mock.writePhaseTeam).not.toHaveBeenCalled();
  });

  it('refuses an unknown phase-mode ID, and uses only the legacy shape for a verified standalone', async () => {
    mock.findNativePhaseAliasOwner.mockResolvedValue(null);
    mock.standaloneMatchAliasExists.mockResolvedValue(false);
    expect((await get()).status).toBe(404);
    expect((await post()).status).toBe(404);
    expect(mock.getMatchById).not.toHaveBeenCalled();
    expect(mock.getMatchPrepTeam).not.toHaveBeenCalled();

    mock.standaloneMatchAliasExists.mockResolvedValue(true);
    mock.getMatchById.mockResolvedValue({ ...match, tournament_id: 'standalone' });
    mock.getTournamentById.mockResolvedValue({ id: 'standalone', season_id: null });
    mock.getMatchPrepTeam.mockResolvedValue(prep);
    mock.upsertMatchPrepTeam.mockResolvedValue(prep);
    expect(await (await get()).json()).toEqual({ success: true, data: prep });
    expect(await (await post()).json()).toEqual({ success: true, data: prep });
    expect(mock.getPhaseMatchById).not.toHaveBeenCalled();
    expect(mock.upsertTeamForMatch).toHaveBeenCalledWith(playerId, matchId.toUpperCase(), 'standalone', pokemon, 'manual', { correction: false });
  });

  it('keeps a default legacy read to the single scoped prep query', async () => {
    mock.getPhaseRouteMode.mockResolvedValue('legacy');
    mock.getMatchPrepTeam.mockResolvedValue(null);
    expect(await (await get()).json()).toEqual({ success: true, data: null });
    expect(mock.getMatchPrepTeam).toHaveBeenCalledExactlyOnceWith(matchId.toUpperCase(), playerId);
    expect(mock.findNativePhaseAliasOwner).not.toHaveBeenCalled();
    expect(mock.findLegacyPhaseAliasOwner).not.toHaveBeenCalled();
    expect(mock.standaloneMatchAliasExists).not.toHaveBeenCalled();
    expect(mock.getMatchById).not.toHaveBeenCalled();
  });
});
