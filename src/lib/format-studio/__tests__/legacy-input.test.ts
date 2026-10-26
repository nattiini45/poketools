/**
 * `toLegacyInput`: live rows to the descriptor's input, field by field. Nothing is spread, so a column added to a
 * row later cannot reach the descriptor; the exact key sets below fail the day one does.
 */
import { describe, expect, it } from 'vitest';
import { epbPack } from '@/lib/format-pack';
import type { SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';
import { toLegacyInput } from '../legacy-input';

function league(patch: Partial<SeasonWithDetails> = {}): SeasonWithDetails {
  return {
    id: 'season-1',
    name: 'Spring League',
    description: 'A friendly league',
    format_type: 'singles',
    ruleset_id: 'rs-main',
    start_date: '2026-01-01',
    end_date: null,
    status: 'active',
    archived: false,
    legacy: false,
    is_test_season: false,
    core_pool: null,
    point_buy_list_id: null,
    route_theme: 'plaza',
    language: 'en',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ruleset_name: 'Main ruleset',
    participant_count: 12,
    tournament_count: 2,
    ...patch,
  };
}

function stage(patch: Partial<TournamentWithDetails> = {}): TournamentWithDetails {
  return {
    id: 'stage-1',
    name: 'Group stage',
    description: 'private notes',
    season_id: 'season-1',
    bracket_type: 'round_robin',
    ruleset_id: 'rs-main',
    best_of_default: 3,
    bo_overrides: { Finals: 5 },
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    status: 'completed',
    current_round: 2,
    stage_order: 0,
    advancement_rule: { type: 'top_n', count: 4, per_group: true },
    enrollment_source: { type: 'standings', source_phase_id: 'stage-0', synced_at: '2026-01-03T00:00:00Z', frozen: true },
    archived: false,
    legacy: false,
    bracket_reset_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ruleset_name: 'Phase ruleset',
    season_name: 'Spring League',
    participant_count: 12,
    ...patch,
  };
}

const base = {
  stageGroupCounts: new Map<string, number>(),
  leagueGroupCount: 0,
  facts: {},
  epb: epbPack,
};

const STAGE_KEYS = [
  'advancementRule',
  'bestOfDefault',
  'bracketResetEnabled',
  'bracketType',
  'boOverrides',
  'enrollmentSource',
  'groupCount',
  'id',
  'isDoubles',
  'name',
  'rulesetId',
  'rulesetName',
  'stageOrder',
].sort();

const SEASON_KEYS = [
  'corePoolSize',
  'description',
  'formatType',
  'id',
  'language',
  'leagueGroupCount',
  'name',
  'participantCount',
  'routeTheme',
  'rulesetId',
  'rulesetName',
].sort();

describe('toLegacyInput', () => {
  it('maps the league field by field with exactly the descriptor keys', () => {
    const input = toLegacyInput({ ...base, league: league(), stages: [stage()], leagueGroupCount: 2 });
    expect(Object.keys(input.season).sort()).toEqual(SEASON_KEYS);
    expect(input.season).toEqual({
      id: 'season-1',
      name: 'Spring League',
      description: 'A friendly league',
      formatType: 'singles',
      language: 'en',
      rulesetId: 'rs-main',
      rulesetName: 'Main ruleset',
      routeTheme: 'plaza',
      participantCount: 12,
      corePoolSize: null,
      leagueGroupCount: 2,
    });
  });

  it('maps a phase field by field and leaks no other column', () => {
    const input = toLegacyInput({ ...base, league: league(), stages: [stage()], stageGroupCounts: new Map([['stage-1', 3]]) });
    const mapped = input.stages[0];
    expect(Object.keys(mapped).sort()).toEqual(STAGE_KEYS);
    expect(mapped).toEqual({
      id: 'stage-1',
      name: 'Group stage',
      bracketType: 'round_robin',
      stageOrder: 0,
      bestOfDefault: 3,
      boOverrides: { Finals: 5 },
      isDoubles: false,
      rulesetId: 'rs-main',
      rulesetName: 'Phase ruleset',
      advancementRule: { type: 'top_n', count: 4, per_group: true },
      enrollmentSource: { type: 'standings', source_phase_id: 'stage-0' },
      bracketResetEnabled: false,
      groupCount: 3,
    });
    const json = JSON.stringify(input);
    for (const leaked of ['private notes', 'synced_at', 'frozen', 'hidden_until_match', 'completed', 'created_at', 'season_name']) {
      expect(json).not.toContain(leaked);
    }
  });

  it('keeps the phases in the order they were read', () => {
    const input = toLegacyInput({
      ...base,
      league: league(),
      stages: [stage({ id: 'b', stage_order: 5 }), stage({ id: 'a', stage_order: 1 })],
    });
    expect(input.stages.map((s) => s.id)).toEqual(['b', 'a']);
    expect(input.stages.map((s) => s.stageOrder)).toEqual([5, 1]);
  });

  it('counts groups by phase id; a phase without an entry has none', () => {
    const input = toLegacyInput({
      ...base,
      league: league(),
      stages: [stage({ id: 'a' }), stage({ id: 'b' })],
      stageGroupCounts: new Map([['a', 4]]),
      leagueGroupCount: 3,
    });
    expect(input.stages.map((s) => s.groupCount)).toEqual([4, 0]);
    expect(input.season.leagueGroupCount).toBe(3);
  });

  it('tells an absent core pool from an empty one', () => {
    expect(toLegacyInput({ ...base, league: league({ core_pool: null }), stages: [] }).season.corePoolSize).toBeNull();
    expect(toLegacyInput({ ...base, league: league({ core_pool: [] }), stages: [] }).season.corePoolSize).toBe(0);
    expect(
      toLegacyInput({
        ...base,
        league: league({ core_pool: [['Fire', 'Water', 'Grass'], ['Ice', 'Dark', 'Fairy']] }),
        stages: [],
      }).season.corePoolSize,
    ).toBe(2);
  });

  it('reads the enrollment source as type and source phase only, and null as null', () => {
    const input = toLegacyInput({
      ...base,
      league: league(),
      stages: [
        stage({ id: 'a', enrollment_source: null }),
        stage({ id: 'b', enrollment_source: { type: 'roster', source_phase_id: null, synced_at: 'x', frozen: false } }),
      ],
    });
    expect(input.stages[0].enrollmentSource).toBeNull();
    expect(input.stages[1].enrollmentSource).toEqual({ type: 'roster', source_phase_id: null });
    expect(Object.keys(input.stages[1].enrollmentSource ?? {}).sort()).toEqual(['source_phase_id', 'type']);
  });

  it('reads an empty ruleset id or name as absent and an absent reset flag as undefined', () => {
    const input = toLegacyInput({
      ...base,
      league: league({ ruleset_id: null, ruleset_name: null, route_theme: undefined }),
      stages: [stage({ ruleset_id: '', ruleset_name: '', bracket_reset_enabled: undefined, advancement_rule: null })],
    });
    expect(input.stages[0]).toMatchObject({ rulesetId: null, rulesetName: null, bracketResetEnabled: undefined, advancementRule: null });
    expect(input.season).toMatchObject({ rulesetId: null, rulesetName: null, routeTheme: undefined });
  });

  it('reads the facts that were read and leaves the others at null', () => {
    const none = toLegacyInput({ ...base, league: league(), stages: [] });
    expect(none.facts).toEqual({ typeAssignments: null, formatRules: null, draftTierLimits: null });
    const some = toLegacyInput({
      ...base,
      league: league(),
      stages: [],
      facts: { typeAssignments: { gymTyped: 2, cored: 1 }, draftTierLimits: [{ tier: 'S', maxPicks: 1 }] },
    });
    expect(some.facts).toEqual({
      typeAssignments: { gymTyped: 2, cored: 1 },
      formatRules: null,
      draftTierLimits: [{ tier: 'S', maxPicks: 1 }],
    });
  });

  it('copies only the pack sections the descriptor reads', () => {
    const { pack } = toLegacyInput({ ...base, league: league(), stages: [] });
    expect(Object.keys(pack)).toEqual(['epb']);
    expect(Object.keys(pack.epb).sort()).toEqual(
      ['comeback', 'defaults', 'matchPoints', 'participationPoints', 'stageLock', 'teraByStage', 'tiebreakerChain'].sort(),
    );
    expect(pack.epb.matchPoints).toEqual(epbPack.matchPoints);
  });

  it('does not touch its source rows', () => {
    const rows = { league: Object.freeze(league()), stages: Object.freeze([Object.freeze(stage())]) };
    expect(() =>
      toLegacyInput({ ...base, league: rows.league, stages: rows.stages, stageGroupCounts: Object.freeze(new Map()) }),
    ).not.toThrow();
  });
});
