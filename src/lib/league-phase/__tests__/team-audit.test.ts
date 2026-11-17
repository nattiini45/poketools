import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compile } from '@/lib/format-kit/compile';
import { wichtelcupDoc } from '@/lib/format-kit/__tests__/fixtures/docs';
import { stateFor } from '@/lib/format-engine/runtime/__tests__/helpers';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { phaseTeam } from '@/lib/team/__tests__/phase-team-fixture';
import { makeSet } from '@/test/team-fixtures';
import type { PhaseTeamAuditInput } from '@/lib/format-engine/runtime/team-audit-server';

const h = vi.hoisted(() => ({ phase: vi.fn(), match: vi.fn(), round: vi.fn(), outcome: vi.fn(),
  games: vi.fn(), stats: vi.fn(), team: vi.fn(), ruleset: vi.fn(), open: vi.fn(),
  legacy: vi.fn(() => { throw new Error('Legacy audit reader called'); }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: h.phase }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: h.match }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getPhaseRoundById: h.round }));
vi.mock('@/lib/supabase/queries/phase-match-outcomes', () => ({ getPhaseMatchOutcome: h.outcome }));
vi.mock('@/lib/supabase/queries/phase-games', () => ({ getPhaseGamesByMatch: h.games, getPhaseBattleStatsByMatch: h.stats }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({ getPlayerPhaseTeamForMatch: h.team,
  PhaseTeamRowConflictError: class extends Error {} }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: h.ruleset }));
vi.mock('@/lib/supabase/queries/format-runtime', () => ({ openFormatCheck: h.open }));
vi.mock('@/lib/supabase/queries/games', () => ({ getGamesByMatch: h.legacy, getBattleStatsByMatch: h.legacy }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: h.legacy }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundById: h.legacy }));
vi.mock('@/lib/supabase/queries/match-outcomes', () => ({ getMatchOutcome: h.legacy }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: h.legacy }));
vi.mock('@/lib/supabase/queries/teams', () => ({ getPlayerTeamForMatch: h.legacy, TeamRowConflictError: class extends Error {} }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: h.legacy }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { createNativePhaseTeamAudit } from '../team-audit';
import { PhaseTeamRowConflictError } from '@/lib/supabase/queries/phase-teams';

const invalidate = vi.fn();
const audit = createNativePhaseTeamAudit(invalidate);
function input(): PhaseTeamAuditInput {
  const def = compile(wichtelcupDoc()).definition;
  if (!def) throw new Error('Synthetic format fixture did not compile');
  return { phase: { id: 'phase', season_id: 'league', season_format_type: 'custom' },
    matchId: 'match', roundId: 'round', player1Id: 'p1', player2Id: 'p2', generation: 2,
    context: { seasonId: 'league', seed: 'synthetic', revision: 7, def, state: stateFor(def),
      tunableIssues: [], phases: [{ id: 'phase', stage: def.stages[0], members: ['p1', 'p2'] }] },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  h.phase.mockResolvedValue({ id: 'phase', season_id: 'league', ruleset_id: 'version' });
  h.match.mockResolvedValue({ id: 'match', phase_id: 'phase', round_id: 'round', player_1_id: 'p1', player_2_id: 'p2',
    confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  h.round.mockResolvedValue({ id: 'round', phase_id: 'phase', round_number: 3 });
  h.outcome.mockResolvedValue(null); h.games.mockResolvedValue([]); h.stats.mockResolvedValue({});
  h.ruleset.mockResolvedValue(makeRuleset({ id: 'version' }));
  h.team.mockImplementation(async playerId => playerId === 'p1'
    ? phaseTeam({ id: 'team', phase_id: 'phase', player_id: 'p1', match_id: 'match', pokemon: [makeSet()] }) : null);
  h.open.mockResolvedValue('check');
});

describe('concrete native kit team audit', () => {
  it('shares constraint evaluation but uses native rows, immutable pin and explicitly owned check subjects', async () => {
    const result = await audit(input());
    expect(result.opened).toBeGreaterThan(0);
    expect(h.team).toHaveBeenCalledWith('p1', { id: 'match', phase_id: 'phase' });
    expect(h.ruleset).toHaveBeenCalledExactlyOnceWith('version');
    expect(h.games).toHaveBeenCalledWith('match'); expect(h.stats).toHaveBeenCalledWith('match');
    expect(h.open).toHaveBeenCalledWith(expect.objectContaining({ seasonId: 'league', revision: 7,
      dedupeKey: 'team_audit:match:2:p1', subject: expect.objectContaining({
        phase_id: 'phase', match_id: 'match', owner_kind: 'phase', match_kind: 'phase_match', completion_ref: 'match:2',
      }) }));
    expect(invalidate).toHaveBeenCalledWith('league'); expect(h.legacy).not.toHaveBeenCalled();
  });

  it('does no storage read when the stage has no team audit rules', async () => {
    const scope = input();
    scope.context.phases[0].stage = { ...scope.context.phases[0].stage, constraints: [] };
    scope.context.def = { ...scope.context.def, domains: [], resources: [] };
    expect(await audit(scope)).toEqual({ opened: 0 });
    expect(h.match).not.toHaveBeenCalled(); expect(h.round).not.toHaveBeenCalled(); expect(h.open).not.toHaveBeenCalled();
  });

  it('refuses cross-store/league or wrong native child scope before opening checks or reading teams', async () => {
    const scope = input(); scope.phase.season_id = 'foreign';
    await expect(audit(scope)).rejects.toThrow('league scope mismatch');
    h.match.mockResolvedValue({ phase_id: 'foreign' });
    await expect(audit(input())).rejects.toThrow('context does not match');
    expect(h.team).not.toHaveBeenCalled(); expect(h.open).not.toHaveBeenCalled();
  });

  it('keeps a duplicate native roster distinguishable from transient read failures', async () => {
    h.team.mockRejectedValue(new PhaseTeamRowConflictError());
    await audit(input());
    expect(h.open).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.objectContaining({ cause: 'team_rows_duplicate' }) }));
    expect(h.legacy).not.toHaveBeenCalled();
  });

  it('propagates transient native team errors inside the retry window', async () => {
    const error = new Error('Native roster read unavailable'); h.team.mockRejectedValue(error);
    await expect(audit(input())).rejects.toBe(error);
    expect(h.legacy).not.toHaveBeenCalled();
  });
});
