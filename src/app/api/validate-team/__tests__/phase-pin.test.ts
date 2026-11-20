import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A match-less team opened from a league phase is checked against the phase's pinned ruleset version. Once phases are
 * read, that version is readable through the phase pin; the legacy generation keeps its exact exposure read.
 */

const m = vi.hoisted(() => ({ mode: vi.fn(), legacy: vi.fn(), phase: vi.fn() }));

vi.mock('@/lib/utils/rate-limit', () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 })), rateLimitedResponse: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: vi.fn(async () => ({ playerId: '00000000-0000-4000-8000-000000000010', isAdmin: false })), AuthError: class extends Error {} }));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: m.mode }));
vi.mock('@/lib/ruleset-studio/exposure', () => ({ readExposedRuleset: m.legacy }));
vi.mock('@/lib/ruleset-studio/phase-pins', () => ({ readExposedRulesetWithPhases: m.phase }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn(async () => null), getParticipantCore: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolBySeason: vi.fn(async () => null), getDraftPoolBySeasonGroup: vi.fn(async () => null), getPicksByPlayer: vi.fn(async () => []),
  GroupedLeaguePoolLookupError: class extends Error {},
}));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroupOfPlayer: vi.fn(async () => null) }));
vi.mock('@/lib/pkmn/validation', () => ({
  validateTeam: vi.fn(() => ({ valid: true, issues: [], team_issues: [] })),
  codedIssue: (code: string, params?: Record<string, unknown>) => (params ? { code, params } : { code }),
}));
vi.mock('@/lib/pkmn/team-legality', () => ({ checkTeamLegality: vi.fn(async () => []) }));

import { POST } from '../route';
import { makeRequest } from '@/lib/__tests__/helpers/api-request';

const RULESET_ID = '00000000-0000-4000-8000-000000000001';
const RULESET = {
  id: RULESET_ID, name: 'League pin', base_format: 'gen9ou', is_doubles: false, clauses: [],
  bans: { pokemon: [], moves: [], abilities: [], items: [] }, additions: { pokemon: [], moves: [], abilities: [], items: [] },
  custom_rules_string: null, min_shared_type_pct: null, created_by: null,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
};
const POKEMON = [{
  name: '', species: 'Garchomp', gender: '', item: '', ability: 'Rough Skin',
  evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: 'Jolly', level: 100, moves: ['Earthquake'],
}];

beforeEach(() => vi.clearAllMocks());

describe('POST /api/validate-team without a tournament', () => {
  it('reads a phase-pinned version through the phase pins once phases are read', async () => {
    m.mode.mockResolvedValue('phase');
    m.phase.mockResolvedValue(RULESET);
    const res = await POST(makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID }));
    expect((await res.json()).success).toBe(true);
    expect(m.phase).toHaveBeenCalledExactlyOnceWith(RULESET_ID);
    expect(m.legacy).not.toHaveBeenCalled();
  });

  it('keeps the legacy exposure read in the legacy generation', async () => {
    m.mode.mockResolvedValue('legacy');
    m.legacy.mockResolvedValue(null);
    const res = await POST(makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID }));
    expect(res.status).toBe(404);
    expect(m.legacy).toHaveBeenCalledExactlyOnceWith(RULESET_ID);
    expect(m.phase).not.toHaveBeenCalled();
  });
});
