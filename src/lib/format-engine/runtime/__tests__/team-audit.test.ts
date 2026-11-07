import { describe, expect, it } from 'vitest';
import { emptyRuntimeState, type RuntimeItem } from '../types';
import type { ConstraintIssue, TeamMember } from '../team';
import {
  MAX_AUDIT_ISSUES,
  TEAM_AUDIT_RULE_ID,
  auditViolations,
  auditsTeams,
  observedOffTeam,
  planTeamAuditChecks,
  stateBeforeCompletion,
  type TeamAuditSide,
} from '../team-audit';

const member = (species: string, baseSpecies = species): TeamMember => ({
  name: species,
  species,
  baseName: baseSpecies,
  baseSpecies,
  types: [],
  item: '',
  itemName: '',
  teraType: null,
  evolution: 'fe',
});

const issue = (over: Partial<ConstraintIssue> = {}): ConstraintIssue => ({
  code: 'kit_count_min',
  constraint_index: 0,
  params: { source: 'resource gifts_premium', min: 2, have: 1 },
  ...over,
});

const side = (over: Partial<TeamAuditSide> = {}): TeamAuditSide => ({
  playerId: 'p1',
  teamId: 'team-1',
  teamSource: 'match',
  teamUpdatedAt: '2026-11-01T10:00:00.000Z',
  editedAfterPlay: false,
  violations: [],
  offTeam: [],
  observedAny: true,
  deadlineCheckOpen: false,
  cause: null,
  ...over,
});

const plan = (sides: TeamAuditSide[], over: Partial<Parameters<typeof planTeamAuditChecks>[0]> = {}) =>
  planTeamAuditChecks({
    stage: 'cup',
    phaseId: 'cup-1',
    matchId: 'm-1',
    generation: 0,
    completionRef: 'm-1',
    round: 3,
    evaluatedAt: '2026-11-05T12:00:00.000Z',
    sides,
    ...over,
  });

describe('auditsTeams', () => {
  it('audits a stage with team constraints only', () => {
    expect(auditsTeams({ stage: { constraints: [{}] } as never })).toBe(true);
    expect(auditsTeams({ stage: { constraints: [] } as never })).toBe(false);
    expect(auditsTeams({ stage: {} as never })).toBe(false);
  });
});

describe('auditViolations', () => {
  it('never counts a league expression that could not be evaluated', () => {
    const kept = issue({ code: 'kit_roster_size' });
    expect(auditViolations([issue({ code: 'kit_constraint_expr' }), kept])).toEqual([kept]);
  });
});

describe('stateBeforeCompletion', () => {
  const grant = (id: string, ref: string | null): RuntimeItem => ({
    id,
    resource: 'gifts',
    player_id: 'p1',
    item_id: 'x',
    amount: 1,
    exclusive: false,
    source: 'event',
    source_ref: ref,
  });

  it('drops only the items the completion itself granted', () => {
    const state = {
      ...emptyRuntimeState(),
      flags: { f: 1 },
      items: [
        grant('own', 'reward:match_completed:m-1'),
        grant('later', 'round4:round_start:swiss:4'),
        grant('other-match', 'reward:match_completed:m-2'),
        grant('manual', null),
      ],
    };
    const out = stateBeforeCompletion(state, 'm-1');
    expect(out.items.map((i) => i.id)).toEqual(['later', 'other-match', 'manual']);
    expect(out.flags).toEqual({ f: 1 });
    expect(state.items).toHaveLength(4);
  });

  it('keeps the grants of the other completion of the same match', () => {
    const state = {
      ...emptyRuntimeState(),
      items: [grant('first', 'reward:match_completed:m-1'), grant('second', 'reward:match_completed:m-1:1')],
    };
    expect(stateBeforeCompletion(state, 'm-1').items.map((i) => i.id)).toEqual(['second']);
    expect(stateBeforeCompletion(state, 'm-1:1').items.map((i) => i.id)).toEqual(['first']);
  });

  it('returns the state itself when the completion granted nothing', () => {
    const state = emptyRuntimeState();
    expect(stateBeforeCompletion(state, 'm-1')).toBe(state);
  });
});

describe('observedOffTeam', () => {
  const team = [member('garchomp'), member('rotomwash', 'rotom'), member('greninjaash', 'greninja')];

  it('flags a species the team does not hold and nothing for the registered ones', () => {
    expect(observedOffTeam(['Garchomp', 'Dragonite'], team)).toEqual(['Dragonite']);
  });

  it('covers the registered species, its battle formes and the bare base species', () => {
    expect(observedOffTeam(['Rotom-Wash', 'Greninja', 'Greninja-Ash'], team)).toEqual([]);
  });

  it('does not let one forme of a base species stand for another', () => {
    // A format whose pools split Rotom-Frost (normal) from Rotom-Heat (a premium gift): the swap must show.
    expect(observedOffTeam(['Rotom-Heat'], team)).toEqual(['Rotom-Heat']);
    expect(observedOffTeam(['Rotom-Heat', 'Rotom-Frost'], [member('rotomfrost', 'rotom')])).toEqual(['Rotom-Heat']);
    expect(observedOffTeam(['Rotom-Frost'], [member('rotomheat', 'rotom')])).toEqual(['Rotom-Frost']);
  });

  it('covers the formes of a registered base-forme Pokémon and the battle formes of a registered forme', () => {
    expect(observedOffTeam(['Rotom-Heat', 'Arceus-Fire'], [member('rotom'), member('arceus')])).toEqual([]);
    expect(observedOffTeam(['Mimikyu-Busted'], [member('mimikyu')])).toEqual([]);
    expect(observedOffTeam(['Greninja-Ash'], [member('greninjabond', 'greninja')])).toEqual([]);
  });

  it('covers a bare base species name for a registered forme, since a hidden preview does not show the forme', () => {
    expect(observedOffTeam(['Rotom-*'], [member('rotomfrost', 'rotom')])).toEqual([]);
  });

  it('reads a hidden-preview name without its suffix and lists each name once', () => {
    expect(observedOffTeam(['Dragonite-*', 'Dragonite', 'Garchomp-*'], team)).toEqual(['Dragonite']);
  });

  it('skips a name the dex cannot resolve', () => {
    expect(observedOffTeam(['Not A Real Mon', ''], team)).toEqual([]);
  });

  it('lets an unreadable registered set cover nothing', () => {
    expect(observedOffTeam(['Garchomp'], [member('')])).toEqual(['Garchomp']);
  });
});

describe('planTeamAuditChecks', () => {
  it('opens nothing for clean sides', () => {
    expect(plan([side(), side({ playerId: 'p2' })])).toEqual([]);
  });

  it('opens one check per breaking side with the generation spelled out in the key', () => {
    const checks = plan([side({ violations: [issue()] }), side({ playerId: 'p2' })], { generation: 2, completionRef: 'm-1:2' });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ source: 'team_audit', rule_id: TEAM_AUDIT_RULE_ID, dedupe_key: 'team_audit:m-1:2:p1' });
    expect(checks[0].subject).toMatchObject({
      stage: 'cup',
      phase_id: 'cup-1',
      match_id: 'm-1',
      round: 3,
      completion_ref: 'm-1:2',
      evaluated_at: '2026-11-05T12:00:00.000Z',
      player_id: 'p1',
      team_id: 'team-1',
      team_source: 'match',
      edited_after_play: false,
      reasons: ['rules'],
      off_team: [],
      cause: null,
      issues: [{ code: 'kit_count_min', params: { source: 'resource gifts_premium', min: 2, have: 1 }, pokemon_indexes: [] }],
    });
  });

  it('combines reasons', () => {
    const [check] = plan([side({ violations: [issue()], offTeam: ['Dragonite'] })]);
    expect(check.subject).toMatchObject({ reasons: ['rules', 'observed_mismatch'], off_team: ['Dragonite'] });
  });

  it('opens a check for a species mismatch alone', () => {
    const [check] = plan([side({ offTeam: ['Dragonite'] })]);
    expect(check.subject).toMatchObject({ reasons: ['observed_mismatch'], issues: [] });
  });

  it('never counts kit_constraint_expr as a violation', () => {
    expect(plan([side({ violations: [issue({ code: 'kit_constraint_expr' })] })])).toEqual([]);
  });

  it('sorts the issues by constraint then code and caps them', () => {
    const many = Array.from({ length: 20 }, (_, i) => issue({ constraint_index: 20 - i, code: 'kit_distinct' }));
    many.push(issue({ constraint_index: 0, code: 'kit_roster_size' }), issue({ constraint_index: 0, code: 'kit_count_min' }));
    const [check] = plan([side({ violations: many })]);
    const issues = (check.subject as { issues: { code: string }[] }).issues;
    expect(issues).toHaveLength(MAX_AUDIT_ISSUES);
    expect(issues.slice(0, 3).map((i) => i.code)).toEqual(['kit_count_min', 'kit_roster_size', 'kit_distinct']);
  });

  it('cuts long param strings and keeps the pokemon indexes', () => {
    const [check] = plan([side({ violations: [issue({ params: { source: 'x'.repeat(200), have: 1 }, pokemon_indexes: [2, 4] })] })]);
    const [first] = (check.subject as { issues: { params: { source: string }; pokemon_indexes: number[] }[] }).issues;
    expect(first.params.source).toHaveLength(80);
    expect(first.pokemon_indexes).toEqual([2, 4]);
  });

  it('opens nothing for an edit after play alone, and carries it as evidence on a check that opens', () => {
    expect(plan([side({ editedAfterPlay: true })])).toEqual([]);
    const [check] = plan([side({ editedAfterPlay: true, violations: [issue()] })]);
    expect(check.subject).toMatchObject({ edited_after_play: true });
  });

  it('opens no_registered_team only when something was played and no deadline check owns it', () => {
    const none = { teamSource: 'none' as const, teamId: null, teamUpdatedAt: null };
    expect(plan([side({ ...none, observedAny: false })])).toEqual([]);
    expect(plan([side({ ...none, deadlineCheckOpen: true })])).toEqual([]);
    const [check] = plan([side(none)]);
    expect(check.subject).toMatchObject({ reasons: ['no_registered_team'], team_id: null, team_source: 'none' });
  });

  it('reports a side that could not be audited with its cause and no verdict', () => {
    const [check] = plan([side({ cause: 'ruleset_missing', violations: [issue()], offTeam: ['Dragonite'] })]);
    expect(check.subject).toMatchObject({ reasons: ['audit_unavailable'], cause: 'ruleset_missing', issues: [] });
  });

  it('holds codes, ids and counts only, no free text', () => {
    const [check] = plan([side({ violations: [issue()], offTeam: ['Dragonite'] })]);
    const subject = check.subject as Record<string, unknown>;
    expect(Object.keys(subject).sort()).toEqual([
      'cause',
      'completion_ref',
      'edited_after_play',
      'evaluated_at',
      'issues',
      'match_id',
      'off_team',
      'phase_id',
      'player_id',
      'reasons',
      'round',
      'stage',
      'team_id',
      'team_source',
      'team_updated_at',
    ]);
  });
});
