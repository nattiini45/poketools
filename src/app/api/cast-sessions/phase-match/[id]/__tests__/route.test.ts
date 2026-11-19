import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const q = vi.hoisted(() => ({
  creator: vi.fn(), mode: vi.fn(), matchOwner: vi.fn(), hasStandalone: vi.fn(),
  match: vi.fn(), phase: vi.fn(), round: vi.fn(), team: vi.fn(), ruleset: vi.fn(),
  owned: vi.fn(), independent: vi.fn(), create: vi.fn(), legacy: vi.fn(),
  AuthError: class extends Error {
    constructor(message: string, public statusCode: number) { super(message); }
  },
}));
vi.mock('@/lib/auth/helpers', () => ({ requireCreator: q.creator, AuthError: q.AuthError }));
vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: q.mode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  findNativePhaseAliasOwner: q.matchOwner, standaloneMatchAliasExists: q.hasStandalone,
}));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: q.match }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: q.phase }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getPhaseRoundById: q.round }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({ getPlayerPhaseTeamForMatch: q.team }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: q.ruleset }));
vi.mock('@/lib/supabase/queries/cast-sessions', () => ({ listIndependentCastSessions: q.independent }));
vi.mock('@/lib/supabase/queries/phase-cast-sessions', () => ({ listPhaseCastSessions: q.owned, createPhaseCastSession: q.create }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: q.legacy }));

import { POST } from '../route';

const MATCH = '10000000-0000-4000-8000-000000000001';
const PHASE = '10000000-0000-4000-8000-000000000002';
const LEAGUE = '10000000-0000-4000-8000-000000000003';
const ROUND = '10000000-0000-4000-8000-000000000004';
const REF = { phase_id: PHASE, season_id: LEAGUE, match_id: MATCH };
const existing = {
  ...REF, id: 'native-owned', owner_id: 'fixture-caster', realtime_key: 'private capability',
  status: 'live', updated_at: '2026-11-01T08:00:00Z', caster_notes: { match: 'private notes' },
};
const independent = {
  id: 'independent', owner_id: existing.owner_id, status: 'draft',
  updated_at: '2026-11-02T08:00:00Z', phase_ref: REF, realtime_key: 'another private capability',
};
const pokemon = [{ species: 'Fixture species', item: 'Fixture set' }];

function request(id = MATCH) {
  return POST(new Request(`http://localhost/api/cast-sessions/phase-match/${id}`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
  q.creator.mockResolvedValue({ playerId: existing.owner_id, isAdmin: false });
  q.mode.mockResolvedValue('phase');
  q.matchOwner.mockResolvedValue({ kind: 'phase', ...REF });
  q.match.mockResolvedValue({
    id: MATCH, phase_id: PHASE, round_id: ROUND, status: 'scheduled',
    player_1_id: 'seat-one', player_2_id: 'seat-two', player_1_name: 'Fixture Aster', player_2_name: 'Fixture Birch',
  });
  q.phase.mockResolvedValue({ id: PHASE, season_id: LEAGUE, ruleset_id: 'pin', team_visibility: 'hidden_until_match' });
  q.round.mockResolvedValue({ id: ROUND, phase_id: PHASE });
  q.team.mockImplementation(async (playerId: string) => ({
    player_id: playerId, match_id: MATCH, library_published_at: null, pokemon,
  }));
  q.ruleset.mockResolvedValue({ id: 'pin', base_format: 'gen8ou' });
  q.owned.mockResolvedValue([]);
  q.independent.mockResolvedValue([]);
  q.create.mockResolvedValue({ id: 'new-native', realtime_key: 'new private capability' });
});
afterEach(() => vi.unstubAllEnvs());

describe('native dashboard cast-session endpoint', () => {
  it('uses the newest active session from either store and returns only its stable ID', async () => {
    q.owned.mockResolvedValue([existing]);
    q.independent.mockResolvedValue([independent]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ success: true, data: { id: independent.id } });
    expect(q.owned).toHaveBeenCalledExactlyOnceWith(existing.owner_id, PHASE, MATCH);
    expect(q.independent).toHaveBeenCalledExactlyOnceWith(existing.owner_id, { phaseId: PHASE, matchId: MATCH });
    expect(q.team).not.toHaveBeenCalled();
    expect(q.create).not.toHaveBeenCalled();
  });

  it('preserves a migrated phase-owned session without regenerating its capability', async () => {
    q.owned.mockResolvedValue([existing]);
    expect(await (await request()).json()).toEqual({ success: true, data: { id: existing.id } });
    expect(q.create).not.toHaveBeenCalled();
  });

  it('never reuses another creator’s, an archived, or a differently scoped row and seeds only visible rosters', async () => {
    q.owned.mockResolvedValue([
      { ...existing, owner_id: 'someone-else' },
      { ...existing, status: 'archived' },
      { ...existing, season_id: 'wrong-league' },
    ]);
    q.independent.mockResolvedValue([{ ...independent, phase_ref: { ...REF, match_id: ROUND } }]);
    const response = await request();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ success: true, data: { id: 'new-native' } });
    expect(q.create).toHaveBeenCalledExactlyOnceWith(existing.owner_id, expect.objectContaining({
      phase_id: PHASE, match_id: MATCH, player1_team: [], player2_team: [], format: 'gen8ou', generation: 8,
    }), LEAGUE);
    expect(q.create.mock.calls[0][1]).not.toHaveProperty('tournament_id');
  });

  it('lets a site admin seed visible rosters but still creates for their own account only', async () => {
    q.creator.mockResolvedValue({ playerId: 'fixture-admin', isAdmin: true });
    q.owned.mockResolvedValue([existing]);
    expect((await request()).status).toBe(201);
    expect(q.create).toHaveBeenCalledExactlyOnceWith('fixture-admin', expect.objectContaining({
      player1_team: pokemon, player2_team: pokemon,
    }), LEAGUE);
  });

  it('runs live auth first and refuses a bad UUID before storage', async () => {
    q.creator.mockRejectedValueOnce(new q.AuthError('Creator access required', 403));
    expect((await request()).status).toBe(403);
    expect((await request('malformed')).status).toBe(404);
    expect(q.mode).not.toHaveBeenCalled();
    expect(q.create).not.toHaveBeenCalled();
  });

  it.each(['frozen_legacy', 'frozen_phase'])('refuses %s and never falls back to legacy', async (mode) => {
    q.mode.mockResolvedValue(mode);
    const response = await request();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(q.matchOwner).not.toHaveBeenCalled();
    expect(q.legacy).not.toHaveBeenCalled();
    expect(q.create).not.toHaveBeenCalled();
  });

  it('fails closed on a native read error, mismatched league, or mode-fence refusal at write time', async () => {
    q.match.mockRejectedValueOnce(new Error('Fixture native read failed'));
    expect((await request()).status).toBe(500);
    q.phase.mockResolvedValueOnce({ id: PHASE, season_id: 'wrong-league' });
    expect((await request()).status).toBe(404);
    expect(q.owned).not.toHaveBeenCalled();
    q.create.mockRejectedValueOnce({ code: 'P0001', message: 'phase_storage_not_ready' });
    expect((await request()).status).toBe(503);
    expect(q.legacy).not.toHaveBeenCalled();
  });

  it('does not read legacy rows for the native-only POST in flag-off mode', async () => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'false');
    expect((await request()).status).toBe(404);
    expect(q.mode).not.toHaveBeenCalled();
    expect(q.legacy).not.toHaveBeenCalled();
  });
});
