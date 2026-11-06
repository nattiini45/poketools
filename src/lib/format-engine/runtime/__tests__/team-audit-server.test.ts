import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compile } from '@/lib/format-kit/compile';
import { wichtelcupDoc } from '@/lib/format-kit/__tests__/fixtures/docs';
import type { FormatDefinition } from '@/lib/format-kit/types';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { makeSet } from '@/test/team-fixtures';
import { SEED, item, stateFor } from './helpers';

vi.mock('@/lib/supabase/queries/teams', () => {
  class TeamRowConflictError extends Error {}
  return { getPlayerTeamForMatch: vi.fn(), TeamRowConflictError };
});
vi.mock('@/lib/supabase/queries/games', () => ({ getGamesByMatch: vi.fn(), getBattleStatsByMatch: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: vi.fn() }));
vi.mock('@/lib/supabase/queries/match-outcomes', () => ({ getMatchOutcome: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundById: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime', () => ({ openFormatCheck: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/team-server', async (importOriginal) => ({
  ...(await (async () => {
    const actual = await importOriginal<typeof import('../team-server')>();
    return { ...actual, evaluateKitConstraints: vi.fn(actual.evaluateKitConstraints) };
  })()),
  readPhaseRuleset: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn() }));

import { getBattleStatsByMatch, getGamesByMatch } from '@/lib/supabase/queries/games';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getMatchOutcome } from '@/lib/supabase/queries/match-outcomes';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { openFormatCheck } from '@/lib/supabase/queries/format-runtime';
import { getPlayerTeamForMatch, TeamRowConflictError } from '@/lib/supabase/queries/teams';
import { expireSeasonReads } from '@/lib/revalidation';
import { logger } from '@/lib/logger';
import type { KitContext } from '../load';
import { evaluateKitConstraints, readPhaseRuleset } from '../team-server';
import { AUDIT_RETRY_WINDOW_MS, auditMatchTeams, type AuditMatchTeamsInput } from '../team-audit-server';

function wichtelDef(): FormatDefinition {
  const result = compile(wichtelcupDoc());
  if (result.definition === null) throw new Error('the Wichtelcup fixture does not compile');
  return result.definition as FormatDefinition;
}

const DEF = wichtelDef();
const RULESET = makeRuleset({ id: 'rs-1' });
const TOURNAMENT = { id: 'cup-1', season_id: 's-1', season_format_type: 'custom' as const };
const NOW = new Date('2026-11-05T12:00:00.000Z');

function context(over: Partial<KitContext> = {}): KitContext {
  return {
    seasonId: 's-1',
    seed: SEED,
    def: DEF,
    state: stateFor(DEF),
    tunableIssues: [],
    phases: [{ id: 'cup-1', stage: DEF.stages[0], members: ['p1', 'p2'] }],
    ...over,
  };
}

function input(over: Partial<AuditMatchTeamsInput> = {}): AuditMatchTeamsInput {
  return {
    tournament: TOURNAMENT,
    matchId: 'm-1',
    roundId: 'r-1',
    player1Id: 'p1',
    player2Id: 'p2',
    generation: 0,
    context: context(),
    ...over,
  };
}

// One item per slot (the Wichtelcup allows each item once). Six members break the roster-size rule of the fixture.
const full = (...species: string[]) => species.map((s, i) => makeSet(s, { moves: ['Tackle'], item: `Item ${i}` }));
const TEAM_ROW = (over: Record<string, unknown> = {}) => ({
  id: 'team-1',
  player_id: 'p1',
  match_id: 'm-1',
  tournament_id: 'cup-1',
  pokemon: full('Garchomp'),
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
  ...over,
});

const stat = (player: string, name: string, wasBrought = true) => ({ player_id: player, pokemon_name: name, was_brought: wasBrought });

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(getRoundById).mockResolvedValue({ id: 'r-1', round_number: 3 } as never);
  vi.mocked(getMatchOutcome).mockResolvedValue(null);
  vi.mocked(readPhaseRuleset).mockResolvedValue(RULESET);
  vi.mocked(getGamesByMatch).mockResolvedValue([{ id: 'g-1', created_at: '2026-11-02T00:00:00.000Z' }] as never);
  vi.mocked(getBattleStatsByMatch).mockResolvedValue({});
  vi.mocked(openFormatCheck).mockResolvedValue('check-1');
  vi.mocked(getMatchById).mockResolvedValue({ id: 'm-1', confirmed_at: '2026-11-05T10:00:00.000Z', updated_at: '2026-11-05T10:00:00.000Z' } as never);
});

const opened = () => vi.mocked(openFormatCheck).mock.calls.map(([call]) => call);

describe('auditMatchTeams', () => {
  it('opens a check for the breaking side only, evaluated at the match round', async () => {
    // p1: one Pokémon (the roster rule wants more); p2: no problem the constraints can see is reachable without a roster, so no team.
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId) => (playerId === 'p1' ? (TEAM_ROW() as never) : null));
    const out = await auditMatchTeams(input());

    expect(out.opened).toBe(1);
    expect(getRoundById).toHaveBeenCalledWith('r-1');
    expect(getPlayerTeamForMatch).toHaveBeenCalledWith('p1', { id: 'm-1', tournament_id: 'cup-1' });
    expect(opened()).toHaveLength(1);
    const [call] = opened();
    expect(call).toMatchObject({ seasonId: 's-1', source: 'team_audit', ruleId: 'team.audit', dedupeKey: 'team_audit:m-1:0:p1' });
    expect(call.subject).toMatchObject({
      stage: DEF.stages[0].key,
      phase_id: 'cup-1',
      match_id: 'm-1',
      round: 3,
      completion_ref: 'm-1',
      player_id: 'p1',
      team_id: 'team-1',
      team_source: 'match',
      reasons: ['rules'],
      cause: null,
    });
    expect((call.subject as { issues: { code: string }[] }).issues.map((i) => i.code)).toContain('kit_roster_size');
    expect(expireSeasonReads).toHaveBeenCalledWith('s-1');
  });

  it('spells the generation out in the key and the completion ref of a re-completed match', async () => {
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId) => (playerId === 'p1' ? (TEAM_ROW() as never) : null));
    await auditMatchTeams(input({ generation: 2 }));
    expect(opened()[0]).toMatchObject({ dedupeKey: 'team_audit:m-1:2:p1' });
    expect(opened()[0].subject).toMatchObject({ completion_ref: 'm-1:2' });
  });

  it('evaluates against the state before the completion own item grants', async () => {
    const own = item({ resource: 'gifts_premium', player_id: 'p1', item_id: 'x', source_ref: 'reward:match_completed:m-1' });
    const later = item({ resource: 'gifts_premium', player_id: 'p1', item_id: 'y', source_ref: 'reward:round_start:cup:4' });
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId) => (playerId === 'p1' ? (TEAM_ROW() as never) : null));
    await auditMatchTeams(input({ context: context({ state: stateFor(DEF, { items: [own, later] }) }) }));
    const passed = vi.mocked(evaluateKitConstraints).mock.calls[0][0];
    expect(passed.ctx.state.items.map((i) => i.id)).toEqual([later.id]);
    expect(passed.roundNumber).toBe(3);
    expect(passed.ruleset).toBe(RULESET);
  });

  it('skips both sides when the match ended in a forfeit or a no-show', async () => {
    for (const kind of ['forfeit', 'no_show'] as const) {
      vi.mocked(getMatchOutcome).mockResolvedValue({ kind } as never);
      await expect(auditMatchTeams(input())).resolves.toEqual({ opened: 0 });
    }
    expect(getPlayerTeamForMatch).not.toHaveBeenCalled();
    expect(openFormatCheck).not.toHaveBeenCalled();
  });

  it('makes no read for a phase without stage constraints', async () => {
    const bare = context({ phases: [{ id: 'cup-1', stage: { ...DEF.stages[0], constraints: [] }, members: ['p1', 'p2'] }] });
    await expect(auditMatchTeams(input({ context: bare }))).resolves.toEqual({ opened: 0 });
    await expect(auditMatchTeams(input({ context: context({ phases: [] }) }))).resolves.toEqual({ opened: 0 });
    expect(getRoundById).not.toHaveBeenCalled();
    expect(getPlayerTeamForMatch).not.toHaveBeenCalled();
    expect(readPhaseRuleset).not.toHaveBeenCalled();
  });

  it('opens audit_unavailable for a side with two team rows and resolves', async () => {
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId) => {
      if (playerId === 'p1') throw new TeamRowConflictError('two rows');
      return null;
    });
    await expect(auditMatchTeams(input())).resolves.toEqual({ opened: 1 });
    expect(opened()[0]).toMatchObject({ dedupeKey: 'team_audit:m-1:0:p1' });
    expect(opened()[0].subject).toMatchObject({ reasons: ['audit_unavailable'], cause: 'team_rows_duplicate', issues: [] });
  });

  it('opens audit_unavailable for both sides when the pinned ruleset is missing', async () => {
    vi.mocked(readPhaseRuleset).mockResolvedValue(null);
    await expect(auditMatchTeams(input())).resolves.toEqual({ opened: 2 });
    expect(opened().map((c) => c.subject)).toEqual([
      expect.objectContaining({ player_id: 'p1', reasons: ['audit_unavailable'], cause: 'ruleset_missing' }),
      expect.objectContaining({ player_id: 'p2', reasons: ['audit_unavailable'], cause: 'ruleset_missing' }),
    ]);
    expect(getPlayerTeamForMatch).not.toHaveBeenCalled();
  });

  it('rejects after opening the other side check when a read fails inside the retry window', async () => {
    const failure = new Error('db down');
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId) => {
      if (playerId === 'p2') throw failure;
      return TEAM_ROW() as never;
    });
    await expect(auditMatchTeams(input())).rejects.toBe(failure);
    expect(opened()).toHaveLength(1);
    expect(opened()[0]).toMatchObject({ dedupeKey: 'team_audit:m-1:0:p1' });
    expect(getMatchById).toHaveBeenCalledWith('m-1');
  });

  it('reports the failed side as unavailable once the match is older than the retry window', async () => {
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId) => {
      if (playerId === 'p2') throw new Error('db down');
      return TEAM_ROW() as never;
    });
    const finished = new Date(NOW.getTime() - AUDIT_RETRY_WINDOW_MS - 60_000).toISOString();
    vi.mocked(getMatchById).mockResolvedValue({ id: 'm-1', confirmed_at: finished, updated_at: finished } as never);
    await expect(auditMatchTeams(input())).resolves.toEqual({ opened: 2 });
    const gaveUp = opened().find((c) => c.dedupeKey === 'team_audit:m-1:0:p2');
    expect(gaveUp?.subject).toMatchObject({ reasons: ['audit_unavailable'], cause: 'read_failed' });
    expect(logger.error).toHaveBeenCalled();
  });

  it('retry "always" rethrows for a match older than the window, "never" reports for a recent one', async () => {
    const failure = new Error('db down');
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId) => {
      if (playerId === 'p2') throw failure;
      return TEAM_ROW() as never;
    });
    const finished = new Date(NOW.getTime() - AUDIT_RETRY_WINDOW_MS - 60_000).toISOString();
    vi.mocked(getMatchById).mockResolvedValue({ id: 'm-1', confirmed_at: finished, updated_at: finished } as never);
    await expect(auditMatchTeams(input({ retry: 'always' }))).rejects.toBe(failure);

    vi.mocked(openFormatCheck).mockClear();
    const recent = new Date(NOW.getTime() - 60_000).toISOString();
    vi.mocked(getMatchById).mockResolvedValue({ id: 'm-1', confirmed_at: recent, updated_at: recent } as never);
    await expect(auditMatchTeams(input({ retry: 'never' }))).resolves.toEqual({ opened: 2 });
    expect(opened().find((c) => c.dedupeKey === 'team_audit:m-1:0:p2')?.subject).toMatchObject({ reasons: ['audit_unavailable'], cause: 'read_failed' });
  });

  it('retries a failing shared read inside the window and gives up after it', async () => {
    const failure = new Error('games down');
    vi.mocked(getGamesByMatch).mockRejectedValue(failure);
    await expect(auditMatchTeams(input())).rejects.toBe(failure);
    expect(openFormatCheck).not.toHaveBeenCalled();

    const finished = new Date(NOW.getTime() - AUDIT_RETRY_WINDOW_MS - 1000).toISOString();
    vi.mocked(getMatchById).mockResolvedValue({ id: 'm-1', confirmed_at: null, updated_at: finished } as never);
    await expect(auditMatchTeams(input())).resolves.toEqual({ opened: 2 });
    expect(opened().map((c) => c.subject)).toEqual([
      expect.objectContaining({ cause: 'read_failed', player_id: 'p1' }),
      expect.objectContaining({ cause: 'read_failed', player_id: 'p2' }),
    ]);
  });

  it('rethrows the original error when the match cannot be read for the window decision', async () => {
    const failure = new Error('games down');
    vi.mocked(getGamesByMatch).mockRejectedValue(failure);
    vi.mocked(getMatchById).mockRejectedValue(new Error('match read'));
    await expect(auditMatchTeams(input())).rejects.toBe(failure);
  });

  it('opens nothing new on a repeat call and does not expire the reads', async () => {
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId) => (playerId === 'p1' ? (TEAM_ROW() as never) : null));
    vi.mocked(openFormatCheck).mockResolvedValue(null);
    await expect(auditMatchTeams(input())).resolves.toEqual({ opened: 0 });
    expect(openFormatCheck).toHaveBeenCalledTimes(1);
    expect(expireSeasonReads).not.toHaveBeenCalled();
  });

  it('computes edited_after_play from the team update time against the first replay', async () => {
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId) =>
      playerId === 'p1' ? (TEAM_ROW({ updated_at: '2026-11-03T00:00:00.000Z' }) as never) : (TEAM_ROW({ id: 'team-2', player_id: 'p2', updated_at: '2026-11-01T00:00:00.000Z' }) as never),
    );
    await auditMatchTeams(input());
    const subjects = opened().map((c) => c.subject as { player_id: string; edited_after_play: boolean });
    expect(subjects.find((s) => s.player_id === 'p1')?.edited_after_play).toBe(true);
    expect(subjects.find((s) => s.player_id === 'p2')?.edited_after_play).toBe(false);
  });

  it('flags a brought species the registered team does not hold', async () => {
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId) => (playerId === 'p1' ? (TEAM_ROW({ pokemon: full('Garchomp', 'Blissey', 'Rotom') }) as never) : null));
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({
      'g-1': [stat('p1', 'Garchomp'), stat('p1', 'Dragonite'), stat('p1', 'Blissey', false), stat('p2', 'Snorlax')] as never,
    });
    await auditMatchTeams(input());
    const mismatch = opened().find((c) => (c.subject as { reasons: string[] }).reasons.includes('observed_mismatch'));
    expect(mismatch?.dedupeKey).toBe('team_audit:m-1:0:p1');
    expect(mismatch?.subject).toMatchObject({ off_team: ['Dragonite'] });
  });

  it('reports a side that played without a registered team, unless a deadline check owns it', async () => {
    vi.mocked(getPlayerTeamForMatch).mockResolvedValue(null);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({ 'g-1': [stat('p1', 'Garchomp')] as never });
    await auditMatchTeams(input());
    expect(opened().map((c) => [c.dedupeKey, (c.subject as { reasons: string[] }).reasons])).toEqual([['team_audit:m-1:0:p1', ['no_registered_team']]]);

    vi.mocked(openFormatCheck).mockClear();
    const deadline = {
      id: 'c-1',
      source: 'deadline_missed' as const,
      rule_id: 'deadline:cup:0',
      dedupe_key: 'deadline:cup:0:m-1',
      subject: { match_id: 'm-1', applies: 'team' },
      status: 'open' as const,
      note: null,
    };
    await auditMatchTeams(input({ context: context({ state: stateFor(DEF, { checks: [deadline] }) }) }));
    expect(openFormatCheck).not.toHaveBeenCalled();
    // An admin who already confirmed the team deadline check has dealt with the missing team too.
    await auditMatchTeams(input({ context: context({ state: stateFor(DEF, { checks: [{ ...deadline, status: 'confirmed' }] }) }) }));
    expect(openFormatCheck).not.toHaveBeenCalled();
  });

  it.each([
    ['a match-policy deadline check (the match was only unplayed past its instant)', { match_id: 'm-1', applies: 'match' }, 'open' as const],
    ['a deadline check without a policy kind', { match_id: 'm-1' }, 'open' as const],
    ['a rejected team-policy deadline check', { match_id: 'm-1', applies: 'team' }, 'rejected' as const],
  ])('still opens no_registered_team next to %s', async (_label, subject, status) => {
    vi.mocked(getPlayerTeamForMatch).mockResolvedValue(null);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({ 'g-1': [stat('p1', 'Garchomp')] as never });
    const deadline = { id: 'c-1', source: 'deadline_missed' as const, rule_id: 'deadline:cup:1', dedupe_key: 'deadline:cup:1:m-1', subject, status, note: null };
    await auditMatchTeams(input({ context: context({ state: stateFor(DEF, { checks: [deadline] }) }) }));
    expect(opened().map((c) => [c.dedupeKey, (c.subject as { reasons: string[] }).reasons])).toEqual([['team_audit:m-1:0:p1', ['no_registered_team']]]);
  });

  it('warns about a league expression that cannot be evaluated and opens no check for it', async () => {
    const stage = { ...DEF.stages[0], constraints: [{ kind: 'roster_size', min: 1, max: 1, when: { k: 'ref', name: 'nope', t: 'boolean' } }] } as never;
    vi.mocked(getPlayerTeamForMatch).mockResolvedValue(TEAM_ROW() as never);
    await auditMatchTeams(input({ context: context({ phases: [{ id: 'cup-1', stage, members: ['p1', 'p2'] }] }) }));
    expect(openFormatCheck).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('format-engine/team-audit', 'a team constraint could not be evaluated', expect.objectContaining({ matchId: 'm-1' }));
  });
});
