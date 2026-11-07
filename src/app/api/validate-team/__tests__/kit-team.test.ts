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
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundById: vi.fn() }));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));

import { POST } from '../route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { checkTeam } from '@/lib/team/check.server';
import { currentPhaseRound, evaluateTeam } from '@/lib/format-engine/runtime/team-server';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { checkRateLimit } from '@/lib/utils/rate-limit';

const RULESET_ID = '00000000-0000-4000-8000-000000000001';
const SEASON_ID = '00000000-0000-4000-8000-000000000002';
const TOURNAMENT_ID = '00000000-0000-4000-8000-000000000003';
const PLAYER_ID = '00000000-0000-4000-8000-000000000010';
const OPPONENT_ID = '00000000-0000-4000-8000-000000000011';
const STRANGER_ID = '00000000-0000-4000-8000-000000000012';
const MATCH_ID = '00000000-0000-4000-8000-000000000020';
const ROUND_ID = '00000000-0000-4000-8000-000000000030';
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

const match = (over: Record<string, unknown> = {}) => ({
  id: MATCH_ID,
  tournament_id: TOURNAMENT_ID,
  round_id: ROUND_ID,
  player_1_id: PLAYER_ID,
  player_2_id: OPPONENT_ID,
  ...over,
});

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
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 239, retryAfterSeconds: 0 });
  vi.mocked(getMatchById).mockResolvedValue(match() as never);
  vi.mocked(getRoundById).mockResolvedValue({ id: ROUND_ID, round_number: 3 } as never);
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

describe('POST /api/validate-team for a team built for a match', () => {
  it('checks the round of the match, not the current round of the phase', async () => {
    const response = await post({ match_id: MATCH_ID });

    expect(response.status).toBe(200);
    expect(evaluateTeam).toHaveBeenCalledWith(expect.objectContaining({ roundNumber: 3, playerId: PLAYER_ID }));
    expect(currentPhaseRound).not.toHaveBeenCalled();
  });

  it('lets the match win over a round_number in the same request', async () => {
    await post({ match_id: MATCH_ID, round_number: 4 });
    expect(evaluateTeam).toHaveBeenCalledWith(expect.objectContaining({ roundNumber: 3 }));
  });

  it('falls back to the current round of the phase when the round of the match is gone', async () => {
    vi.mocked(getRoundById).mockResolvedValue(null);
    await post({ match_id: MATCH_ID });
    expect(currentPhaseRound).toHaveBeenCalledWith(TOURNAMENT_ID);
    expect(evaluateTeam).toHaveBeenCalledWith(expect.objectContaining({ roundNumber: 2 }));
  });

  it('lets player two of the match check their own team', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: OPPONENT_ID, name: 'Opp', isAdmin: false } as never);
    const response = await post({ match_id: MATCH_ID });

    expect(response.status).toBe(200);
    expect(evaluateTeam).toHaveBeenCalledWith(expect.objectContaining({ roundNumber: 3, playerId: OPPONENT_ID }));
  });

  it('answers 404 for a match that does not exist or belongs to another tournament', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null);
    const missing = await post({ match_id: MATCH_ID });
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe('match_not_found');

    vi.mocked(getMatchById).mockResolvedValue(match({ tournament_id: '00000000-0000-4000-8000-0000000000ff' }) as never);
    const foreign = await post({ match_id: MATCH_ID });
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).code).toBe('match_not_found');
    expect(evaluateTeam).not.toHaveBeenCalled();
    expect(checkTeam).not.toHaveBeenCalled();
  });

  it('refuses a player who does not play the match', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: STRANGER_ID, name: 'Stranger', isAdmin: false } as never);
    const response = await post({ match_id: MATCH_ID });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('match_prep_not_participant');
    expect(evaluateTeam).not.toHaveBeenCalled();
    expect(checkTeam).not.toHaveBeenCalled();
  });

  it('gives an admin who does not play the match the ruleset verdict only, never a verdict on their own gifts', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: STRANGER_ID, name: 'Admin', isAdmin: true } as never);
    const response = await post({ match_id: MATCH_ID });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(PLAIN);
    expect(evaluateTeam).not.toHaveBeenCalled();
    expect(checkTeam).toHaveBeenCalledTimes(1);
  });

  it('checks an admin who plays the match like any player', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: PLAYER_ID, name: 'Admin', isAdmin: true } as never);
    await post({ match_id: MATCH_ID });
    expect(evaluateTeam).toHaveBeenCalledWith(expect.objectContaining({ roundNumber: 3, playerId: PLAYER_ID }));
  });

  it('refuses a match without its tournament, and a match id that is not a uuid', async () => {
    const noTournament = await post({ match_id: MATCH_ID, tournament_id: undefined });
    expect(noTournament.status).toBe(400);
    expect((await noTournament.json()).code).toBe('validation_failed');
    expect(getMatchById).not.toHaveBeenCalled();

    const badId = await post({ match_id: 'not-a-uuid' });
    expect(badId.status).toBe(400);
    expect((await badId.json()).code).toBe('validation_failed');
    expect(evaluateTeam).not.toHaveBeenCalled();
  });

  it.each(['singles', 'evolution_point_buy'])('does not read the match of a %s league', async (format) => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament(format) as never);
    const response = await post({ match_id: MATCH_ID });

    expect(response.status).toBe(200);
    expect(getMatchById).not.toHaveBeenCalled();
    expect(checkTeam).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/validate-team rate limit', () => {
  it('counts every check against the player and answers 429 over the limit, before reading anything', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 17 });
    const response = await post();

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('17');
    expect(await response.json()).toMatchObject({ code: 'rate_limited', params: { seconds: 17 } });
    expect(checkRateLimit).toHaveBeenCalledWith('validate-team', PLAYER_ID, expect.objectContaining({ limit: expect.any(Number), windowSeconds: 60 }));
    expect(getTournamentById).not.toHaveBeenCalled();
    expect(evaluateTeam).not.toHaveBeenCalled();
  });

  it('lets a request within the limit through', async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
  });
});
