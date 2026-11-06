/**
 * The post-match team audit with the SHIPPED Wichtelcup preset (not the placeholder fixture): the real pools, the real
 * round-bound constraints and the real gift resources, through `auditMatchTeams` with the real constraint evaluation.
 * A week-1 team that holds a New Year Pokemon stays illegal when it is audited after the `week4` unlock; a premium
 * species the player never received is a rules issue, and one the player played but did not register is an
 * `observed_mismatch`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compile } from '@/lib/format-kit/compile';
import { wichtelcup } from '@/lib/format-kit/presets/wichtelcup';
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
  ...(await importOriginal<typeof import('../team-server')>()),
  readPhaseRuleset: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn() }));

import { getBattleStatsByMatch, getGamesByMatch } from '@/lib/supabase/queries/games';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getMatchOutcome } from '@/lib/supabase/queries/match-outcomes';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { openFormatCheck } from '@/lib/supabase/queries/format-runtime';
import { getPlayerTeamForMatch } from '@/lib/supabase/queries/teams';
import type { KitContext } from '../load';
import { readPhaseRuleset } from '../team-server';
import { auditMatchTeams, type AuditMatchTeamsInput } from '../team-audit-server';

const compiled = compile(wichtelcup);
if (compiled.definition === null) throw new Error('the Wichtelcup example does not compile');
const DEF = compiled.definition as FormatDefinition;
const CUP = DEF.stages.find((stage) => stage.key === 'cup');
if (CUP === undefined) throw new Error('the Wichtelcup example has no cup stage');

const RULESET = makeRuleset({ id: 'rs-1' });
const TOURNAMENT = { id: 'cup-1', season_id: 's-1', season_format_type: 'custom' as const };
const NOW = new Date('2026-11-05T12:00:00.000Z');

const pool = (key: string): string[] => (DEF.domains?.find((d) => d.key === key)?.entries ?? []).map((e) => e.id);
const NORMAL = pool('normal');
const JUNK = pool('junk');
const PREMIUM = pool('premium');
const NEW_YEAR = pool('new_year');
const OWN_JUNK = JUNK[0];
const OWN_PREMIUM = PREMIUM[0];
const NEVER_RECEIVED = PREMIUM[1];

const gift = (resource: 'junk_gifts' | 'premium_gift', itemId: string) => item({ resource, player_id: 'p1', item_id: itemId });

function context(flags: Record<string, string> = {}): KitContext {
  return {
    seasonId: 's-1',
    seed: SEED,
    def: DEF,
    state: stateFor(DEF, { flags, items: [gift('junk_gifts', OWN_JUNK), gift('premium_gift', OWN_PREMIUM)] }),
    tunableIssues: [],
    phases: [{ id: 'cup-1', stage: CUP!, members: ['p1', 'p2'] }],
  };
}

const input = (ctx: KitContext): AuditMatchTeamsInput => ({
  tournament: TOURNAMENT,
  matchId: 'm-1',
  roundId: 'r-1',
  player1Id: 'p1',
  player2Id: 'p2',
  generation: 0,
  context: ctx,
});

// One distinct item per slot (the Item Clause of the example), six members.
const team = (...species: string[]) => ({
  id: 'team-1',
  player_id: 'p1',
  match_id: 'm-1',
  tournament_id: 'cup-1',
  pokemon: species.map((s, i) => makeSet(s, { moves: ['Tackle'], item: `Item ${i}` })),
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
});

const stat = (player: string, name: string) => ({ player_id: player, pokemon_name: name, was_brought: true });
const opened = () => vi.mocked(openFormatCheck).mock.calls.map(([call]) => call);
const subjectOf = (call: ReturnType<typeof opened>[number]) =>
  call.subject as { reasons: string[]; issues: { code: string; pokemon_indexes?: number[] }[]; off_team: string[] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(getRoundById).mockResolvedValue({ id: 'r-1', round_number: 1 } as never);
  vi.mocked(getMatchOutcome).mockResolvedValue(null);
  vi.mocked(readPhaseRuleset).mockResolvedValue(RULESET);
  vi.mocked(getGamesByMatch).mockResolvedValue([{ id: 'g-1', created_at: '2026-11-02T00:00:00.000Z' }] as never);
  vi.mocked(getBattleStatsByMatch).mockResolvedValue({});
  vi.mocked(openFormatCheck).mockResolvedValue('check-1');
  vi.mocked(getMatchById).mockResolvedValue({ id: 'm-1', confirmed_at: '2026-11-05T10:00:00.000Z', updated_at: '2026-11-05T10:00:00.000Z' } as never);
});

describe('auditMatchTeams with the shipped Wichtelcup', () => {
  it('has the pools this file reads', () => {
    expect(JUNK.length).toBeGreaterThan(1);
    expect(PREMIUM.length).toBeGreaterThan(1);
    expect(NEW_YEAR.length).toBeGreaterThan(0);
    expect(NORMAL.length).toBeGreaterThanOrEqual(5);
  });

  it('accepts a week 1 team of an own junk gift and five normal Pokemon', async () => {
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId) => (playerId === 'p1' ? (team(OWN_JUNK, ...NORMAL.slice(0, 5)) as never) : null));
    await expect(auditMatchTeams(input(context()))).resolves.toEqual({ opened: 0 });
  });

  it('keeps a week 1 team with a New Year Pokemon illegal when audited after the week4 unlock', async () => {
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId) =>
      playerId === 'p1' ? (team(OWN_JUNK, NEW_YEAR[0], ...NORMAL.slice(0, 4)) as never) : null,
    );
    // The domain is unlocked and the week4 event has fired by the time the audit runs; the legality is bound to the match round.
    const afterWeek4 = context({ 'domain:new_year': 'unlocked' });
    afterWeek4.state = { ...afterWeek4.state, firedEventKeys: ['week4'] };
    await expect(auditMatchTeams(input(afterWeek4))).resolves.toEqual({ opened: 1 });
    const [call] = opened();
    expect(call).toMatchObject({ source: 'team_audit', dedupeKey: 'team_audit:m-1:0:p1' });
    expect(subjectOf(call).reasons).toContain('rules');
    expect(subjectOf(call).issues.map((issue) => issue.code)).toEqual(['kit_count_max']);
    expect(subjectOf(call).issues[0].pokemon_indexes).toEqual([1]);

    // The same kind of team is legal in a week 4 match (up to two New Year Pokemon, the premium gift required).
    vi.mocked(openFormatCheck).mockClear();
    vi.mocked(getRoundById).mockResolvedValue({ id: 'r-1', round_number: 4 } as never);
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId) =>
      playerId === 'p1' ? (team(OWN_PREMIUM, NEW_YEAR[0], ...NORMAL.slice(0, 4)) as never) : null,
    );
    await expect(auditMatchTeams(input(afterWeek4))).resolves.toEqual({ opened: 0 });
  });

  it('flags a premium species the player never received as a rules issue', async () => {
    vi.mocked(getRoundById).mockResolvedValue({ id: 'r-1', round_number: 3 } as never);
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId) =>
      playerId === 'p1' ? (team(OWN_JUNK, JUNK[1], NEVER_RECEIVED, ...NORMAL.slice(0, 3)) as never) : null,
    );
    const ctx = context();
    ctx.state = { ...ctx.state, items: [...ctx.state.items, gift('junk_gifts', JUNK[1])] };
    await auditMatchTeams(input(ctx));
    const [call] = opened();
    expect(subjectOf(call).reasons).toContain('rules');
    expect(subjectOf(call).issues.map((issue) => issue.code)).toContain('kit_not_allowed');
  });

  it('flags a premium species the player brought but never registered as observed_mismatch', async () => {
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId) => (playerId === 'p1' ? (team(OWN_JUNK, ...NORMAL.slice(0, 5)) as never) : null));
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({
      'g-1': [stat('p1', NORMAL[0]), stat('p1', NEVER_RECEIVED)] as never,
    });
    await auditMatchTeams(input(context()));
    const [call] = opened();
    expect(subjectOf(call).reasons).toEqual(['observed_mismatch']);
    expect(subjectOf(call).off_team).toEqual([NEVER_RECEIVED]);
  });
});
