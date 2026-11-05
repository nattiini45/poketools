import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSet } from '@/test/team-fixtures';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { makeRequest } from '@/lib/__tests__/helpers/api-request';

vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: vi.fn() }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn() }));
vi.mock('@/lib/ruleset-studio/exposure', () => ({ readExposedRuleset: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/team/check.server', () => ({ checkTeam: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/team-server', () => ({ evaluateTeam: vi.fn(), currentPhaseRound: vi.fn() }));

import { POST } from '../route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { checkTeam } from '@/lib/team/check.server';
import { currentPhaseRound, evaluateTeam } from '@/lib/format-engine/runtime/team-server';

const RULESET_ID = '00000000-0000-4000-8000-000000000001';
const SEASON_ID = '00000000-0000-4000-8000-000000000002';
const TOURNAMENT_ID = '00000000-0000-4000-8000-000000000003';
const PLAYER_ID = '00000000-0000-4000-8000-000000000010';
const RULESET = makeRuleset({ id: RULESET_ID });
const pokemon = [makeSet('Garchomp')];

const PLAIN = { valid: true, issues: [], team_issues: [], team_issue_details: [], ruleset_source: { kind: 'ruleset' } };
const MERGED = {
  valid: false,
  issues: [],
  team_issues: ['Team size: this league needs 6 to 6 Pokémon, found 1'],
  team_issue_details: [{ issue: 'Team size: this league needs 6 to 6 Pokémon, found 1', code: 'kit_roster_size', params: { min: 6, max: 6, have: 1 } }],
  ruleset_source: { kind: 'ruleset' },
};

const post = (body: Record<string, unknown> = {}) =>
  POST(makeRequest({ pokemon, ruleset_id: RULESET_ID, tournament_id: TOURNAMENT_ID, ...body }));
const tournament = (format: string) => ({ id: TOURNAMENT_ID, season_id: SEASON_ID, season_format_type: format, ruleset_id: RULESET_ID });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue({ playerId: PLAYER_ID, name: 'Test', isAdmin: false } as never);
  vi.mocked(getTournamentById).mockResolvedValue(tournament('custom') as never);
  vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON_ID, format_type: 'custom' } as never);
  vi.mocked(getRulesetById).mockResolvedValue(RULESET);
  vi.mocked(readExposedRuleset).mockResolvedValue(RULESET);
  vi.mocked(checkTeam).mockResolvedValue(PLAIN as never);
  vi.mocked(currentPhaseRound).mockResolvedValue(2);
  vi.mocked(evaluateTeam).mockResolvedValue({ applies: true, result: MERGED } as never);
});

describe('POST /api/validate-team for a kit phase', () => {
  it('answers the merged verdict of the phase for its current round, with the phase ruleset', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(MERGED);
    expect(evaluateTeam).toHaveBeenCalledWith({
      seasonId: SEASON_ID,
      phaseId: TOURNAMENT_ID,
      playerId: PLAYER_ID,
      roundNumber: 2,
      pokemon,
      ruleset: RULESET,
    });
    expect(checkTeam).not.toHaveBeenCalled();
  });

  it('checks the round the request names', async () => {
    await post({ round_number: 4 });
    expect(evaluateTeam).toHaveBeenCalledWith(expect.objectContaining({ roundNumber: 4 }));
    expect(currentPhaseRound).not.toHaveBeenCalled();
  });

  it.each([0, 1.5, 501, '2'])('refuses round_number %s', async (round_number) => {
    const response = await post({ round_number });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('validation_failed');
    expect(evaluateTeam).not.toHaveBeenCalled();
  });

  it('keeps the plain check when the phase has no kit rules', async () => {
    vi.mocked(evaluateTeam).mockResolvedValue({ applies: false, result: { valid: true, issues: [], team_issues: [] } } as never);
    const response = await post();

    expect((await response.json()).data).toEqual(PLAIN);
    expect(checkTeam).toHaveBeenCalledTimes(1);
  });

  it.each(['singles', 'evolution_point_buy'])('keeps the plain check for a %s league', async (format) => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament(format) as never);
    const response = await post();

    expect((await response.json()).data).toEqual(PLAIN);
    expect(evaluateTeam).not.toHaveBeenCalled();
  });

  it('keeps the plain check without tournament context', async () => {
    const response = await post({ tournament_id: undefined });

    expect((await response.json()).data).toEqual(PLAIN);
    expect(evaluateTeam).not.toHaveBeenCalled();
    expect(getTournamentById).not.toHaveBeenCalled();
  });
});
