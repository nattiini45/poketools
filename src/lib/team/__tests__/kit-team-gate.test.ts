import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSet } from '@/test/team-fixtures';
import { makeRuleset } from '@/test/ruleset-fixtures';
import type { TeamValidationResult } from '@/types/team';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

vi.mock('@/lib/format-engine/runtime/team-server', () => ({ evaluateTeam: vi.fn(), currentPhaseRound: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));

import { currentPhaseRound, evaluateTeam } from '@/lib/format-engine/runtime/team-server';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { logger } from '@/lib/logger';
import { adviseKitTeam, isKitTeamCandidate, kitTeamVerdict } from '../kit-team-gate';

const KIT = { id: 'cup-1', season_id: 's-1', season_format_type: 'custom' };
const pokemon = [makeSet('Garchomp')];
const INVALID: TeamValidationResult = {
  valid: false,
  issues: [
    { pokemon_index: 0, species: 'Garchomp', issue: 'Terastallization is not allowed in this league', severity: 'error', code: 'kit_tera_banned' },
    { pokemon_index: 0, species: 'Garchomp', issue: 'Just a hint', severity: 'warning' },
  ],
  team_issues: ['Team size: this league needs 6 to 6 Pokémon, found 1'],
  team_issue_details: [{ issue: 'Team size: this league needs 6 to 6 Pokémon, found 1', code: 'kit_roster_size', params: { min: 6, max: 6, have: 1 } }],
};
const VALID: TeamValidationResult = { valid: true, issues: [], team_issues: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentPhaseRound).mockResolvedValue(2);
  vi.mocked(evaluateTeam).mockResolvedValue({ applies: true, result: INVALID });
});

describe('isKitTeamCandidate', () => {
  it('needs a season and a custom league', () => {
    expect(isKitTeamCandidate(KIT)).toBe(true);
    expect(isKitTeamCandidate({ ...KIT, season_id: null })).toBe(false);
    expect(isKitTeamCandidate({ ...KIT, season_format_type: 'swiss' })).toBe(false);
    expect(isKitTeamCandidate({ id: 't', season_id: 's' })).toBe(false);
    expect(isKitTeamCandidate(null)).toBe(false);
  });
});

describe('kitTeamVerdict', () => {
  it('reads nothing for a league that is not custom', async () => {
    expect(await kitTeamVerdict({ tournament: { ...KIT, season_format_type: 'swiss' }, playerId: 'p1', pokemon })).toBeNull();
    expect(evaluateTeam).not.toHaveBeenCalled();
    expect(currentPhaseRound).not.toHaveBeenCalled();
  });

  it('checks a custom league for the phase round, or the round the caller names', async () => {
    expect(await kitTeamVerdict({ tournament: KIT, playerId: 'p1', pokemon })).toBe(INVALID);
    expect(evaluateTeam).toHaveBeenCalledWith({ seasonId: 's-1', phaseId: 'cup-1', playerId: 'p1', roundNumber: 2, pokemon });

    await kitTeamVerdict({ tournament: KIT, playerId: 'p1', pokemon, roundNumber: 4 });
    expect(evaluateTeam).toHaveBeenLastCalledWith(expect.objectContaining({ roundNumber: 4 }));
    expect(currentPhaseRound).toHaveBeenCalledTimes(1);
  });

  it('passes the ruleset the caller read', async () => {
    const ruleset = makeRuleset({ id: 'rs-1' });
    await kitTeamVerdict({ tournament: KIT, playerId: 'p1', pokemon, ruleset });
    expect(evaluateTeam).toHaveBeenCalledWith(expect.objectContaining({ ruleset }));
  });

  it('is null when the phase has nothing to enforce', async () => {
    vi.mocked(evaluateTeam).mockResolvedValue({ applies: false, result: VALID });
    expect(await kitTeamVerdict({ tournament: KIT, playerId: 'p1', pokemon })).toBeNull();
  });

  it('reads a phase named by id, and is null when it does not exist', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(KIT as never);
    expect(await kitTeamVerdict({ tournament: 'cup-1', playerId: 'p1', pokemon })).toBe(INVALID);
    vi.mocked(getTournamentById).mockResolvedValue(null);
    expect(await kitTeamVerdict({ tournament: 'gone', playerId: 'p1', pokemon })).toBeNull();
  });
});

describe('adviseKitTeam', () => {
  const context = { tournamentId: 'cup-1', playerId: 'p1' };

  it('is empty for a league that is not custom, without evaluating anything', async () => {
    expect(await adviseKitTeam({ tournament: { ...KIT, season_format_type: 'swiss' }, playerId: 'p1', pokemon }, context)).toEqual({});
    expect(evaluateTeam).not.toHaveBeenCalled();
  });

  it('is empty for a team that meets the rules and for a phase with nothing to enforce', async () => {
    vi.mocked(evaluateTeam).mockResolvedValue({ applies: true, result: VALID });
    expect(await adviseKitTeam({ tournament: KIT, playerId: 'p1', pokemon }, context)).toEqual({});
    vi.mocked(evaluateTeam).mockResolvedValue({ applies: false, result: INVALID });
    expect(await adviseKitTeam({ tournament: KIT, playerId: 'p1', pokemon }, context)).toEqual({});
  });

  it('answers unmet with the whole verdict for a team that breaks the rules, and never refuses', async () => {
    expect(await adviseKitTeam({ tournament: KIT, playerId: 'p1', pokemon }, context)).toEqual({ team_check: { status: 'unmet', verdict: INVALID } });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('answers unavailable and logs the original error when the verdict cannot be computed', async () => {
    const failure = new Error('runtime read failed');
    vi.mocked(evaluateTeam).mockRejectedValue(failure);
    expect(await adviseKitTeam({ tournament: KIT, playerId: 'p1', pokemon }, context)).toEqual({ team_check: { status: 'unavailable' } });
    expect(logger.error).toHaveBeenCalledWith('api/team-check', 'Team advisory could not be computed', { ...context, error: failure });
  });

  it('answers unavailable when the phase cannot be read', async () => {
    vi.mocked(getTournamentById).mockRejectedValue(new Error('db down'));
    expect(await adviseKitTeam({ tournament: 'cup-1', playerId: 'p1', pokemon }, context)).toEqual({ team_check: { status: 'unavailable' } });
  });
});
