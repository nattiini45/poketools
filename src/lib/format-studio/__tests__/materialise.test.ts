import { describe, expect, it } from 'vitest';
import { CURRENT_ENV, PRESETS, compile, ltext, type CountRange, type FormatDefinition, type SeriesOverride, type Stage } from '@/lib/format-kit';
import { FIELD_LIMITS } from '@/lib/validation/schemas';
import { mapSeriesOverrides, planStages, type PlanStagesInput } from '../materialise';

const preset = (id: string): FormatDefinition => {
  const found = PRESETS.find((entry) => entry.id === id);
  if (!found) throw new Error(`no preset ${id}`);
  return structuredClone(found.definition);
};

const RULESET_SEASON = '00000000-0000-4000-8000-000000000001';
const RULESET_EXPLICIT = '00000000-0000-4000-8000-000000000002';

const exact = (n: number): CountRange => ({ min: n, max: n });
const override = (round: number, from: 'start' | 'end', best_of: number): SeriesOverride => ({ round, from, best_of });

/** Compiles a definition and plans its stages the way `attachFormatToSeason` does. */
function plan(definition: FormatDefinition, extra: Partial<PlanStagesInput> = {}, rosterSize?: number) {
  const result = compile(definition, { ...CURRENT_ENV, ...(rosterSize !== undefined ? { rosterSize } : {}) });
  if (result.definition === null || result.graph === null || result.plan === null) {
    throw new Error(`definition does not compile: ${JSON.stringify(result.diagnostics.slice(0, 3))}`);
  }
  return planStages({
    definition: result.definition,
    graphOrder: result.graph.order,
    plan: result.plan,
    seasonRulesetId: RULESET_SEASON,
    seasonLanguage: 'en',
    specHash: 'a'.repeat(64),
    ...extra,
  });
}

describe('mapSeriesOverrides', () => {
  describe('round robin and Swiss', () => {
    it.each(['round_robin', 'swiss'] as const)('%s: counting from the start names Round N', (bracket) => {
      const mapped = mapSeriesOverrides(bracket, [override(1, 'start', 3), override(4, 'start', 5)], null);
      expect(mapped.map).toEqual({ 'Round 1': 3, 'Round 4': 5 });
      expect(mapped.unmapped).toEqual([]);
    });

    it.each(['round_robin', 'swiss'] as const)('%s: counting from the end needs an exact round count', (bracket) => {
      const ends = [override(1, 'end', 5), override(2, 'end', 3)];
      expect(mapSeriesOverrides(bracket, ends, exact(7)).map).toEqual({ 'Round 7': 5, 'Round 6': 3 });
      const unknown = mapSeriesOverrides(bracket, ends, null);
      expect(unknown.map).toEqual({});
      expect(unknown.unmapped).toEqual(ends);
      const range = mapSeriesOverrides(bracket, ends, { min: 5, max: 7 });
      expect(range.unmapped).toEqual(ends);
    });

    it('a distance from the end beyond the round count is unmapped', () => {
      const mapped = mapSeriesOverrides('swiss', [override(5, 'end', 3)], exact(4));
      expect(mapped.map).toEqual({});
      expect(mapped.unmapped).toHaveLength(1);
    });
  });

  describe('single elimination', () => {
    it('names the last three rounds without a total', () => {
      const mapped = mapSeriesOverrides(
        'single_elim',
        [override(1, 'end', 7), override(2, 'end', 5), override(3, 'end', 3)],
        null,
      );
      expect(mapped.map).toEqual({ Finals: 7, Semifinals: 5, Quarterfinals: 3 });
      expect(mapped.unmapped).toEqual([]);
    });

    it('needs the total for any other distance from the end, and for counting from the start', () => {
      const overrides = [override(4, 'end', 3), override(1, 'start', 3)];
      expect(mapSeriesOverrides('single_elim', overrides, null).unmapped).toEqual(overrides);
      expect(mapSeriesOverrides('single_elim', overrides, { min: 3, max: 4 }).unmapped).toEqual(overrides);
    });

    it('with an exact total converts every override to the name the bracket writes', () => {
      // 5 rounds: Round 1, Round 2, Quarterfinals, Semifinals, Finals.
      const mapped = mapSeriesOverrides(
        'single_elim',
        [override(1, 'start', 1), override(2, 'start', 3), override(3, 'start', 5), override(4, 'start', 7), override(5, 'start', 9)],
        exact(5),
      );
      expect(mapped.map).toEqual({ 'Round 1': 1, 'Round 2': 3, Quarterfinals: 5, Semifinals: 7, Finals: 9 });
      const fromEnd = mapSeriesOverrides('single_elim', [override(4, 'end', 3), override(5, 'end', 5)], exact(5));
      expect(fromEnd.map).toEqual({ 'Round 2': 3, 'Round 1': 5 });
    });

    it('a round beyond the total is unmapped', () => {
      const mapped = mapSeriesOverrides('single_elim', [override(4, 'start', 3), override(3, 'end', 3)], exact(2));
      expect(mapped.map).toEqual({});
      expect(mapped.unmapped).toHaveLength(2);
    });
  });

  it('double elimination maps nothing: its round names depend on the bracket', () => {
    const overrides = [override(1, 'start', 3), override(1, 'end', 5)];
    const mapped = mapSeriesOverrides('double_elim', overrides, exact(5));
    expect(mapped.map).toEqual({});
    expect(mapped.unmapped).toEqual(overrides);
  });

  it('two overrides that land on one name: the first wins, the second is unmapped', () => {
    const first = override(1, 'end', 5);
    const second = override(3, 'start', 3);
    const mapped = mapSeriesOverrides('single_elim', [first, second], exact(3));
    // The last of three rounds and the third round are both the final.
    expect(mapped.map).toEqual({ Finals: 5 });
    expect(mapped.unmapped).toEqual([second]);
    const robin = mapSeriesOverrides('round_robin', [override(3, 'start', 3), override(2, 'end', 5)], exact(4));
    expect(robin.map).toEqual({ 'Round 3': 3 });
    expect(robin.unmapped).toEqual([override(2, 'end', 5)]);
  });

  it('is deterministic and does not mutate its input', () => {
    const input = [override(1, 'end', 5), override(2, 'start', 3)];
    const snapshot = structuredClone(input);
    const a = mapSeriesOverrides('single_elim', input, exact(3));
    const b = mapSeriesOverrides('single_elim', input, exact(3));
    expect(a).toEqual(b);
    expect(input).toEqual(snapshot);
  });
});

describe('planStages', () => {
  describe('bracket types', () => {
    it('maps every pairing kind to the legacy bracket type', () => {
      const definition = preset('cup');
      const base = definition.stages[0];
      const pairings: Array<[Stage['pairing'], string]> = [
        [{ kind: 'round_robin', legs: 1, mirror_legs: true }, 'round_robin'],
        [{ kind: 'swiss', rounds: 'auto', avoid_repeats: true }, 'swiss'],
        [{ kind: 'single_elim', third_place: false }, 'single_elim'],
        [{ kind: 'double_elim', bracket_reset: true }, 'double_elim'],
        [{ kind: 'manual' }, 'round_robin'],
      ];
      for (const [pairing, expected] of pairings) {
        const stage: Stage = { ...structuredClone(base), key: 'only', groups: undefined, pairing, series: { best_of: 1, allow_draw: false, overrides: [] } };
        delete stage.groups;
        const single: FormatDefinition = { ...definition, stages: [stage], edges: [] };
        const planned = plan(single, {}, 8);
        expect(planned.stages).toHaveLength(1);
        expect(planned.stages[0].bracket_type).toBe(expected);
        expect(planned.stages[0].stage_spec.mapped_bracket_type).toBe(expected);
      }
    });

    it('falls back to the pairing when the plan has no entry for a stage', () => {
      const definition = preset('cup');
      const result = compile(definition);
      const planned = planStages({
        definition: result.definition as FormatDefinition,
        graphOrder: (result.graph as { order: readonly string[] }).order,
        plan: [],
        seasonRulesetId: 'r',
        seasonLanguage: 'en',
        specHash: 'b'.repeat(64),
      });
      expect(planned.stages.map((s) => s.bracket_type)).toEqual(['round_robin', 'single_elim']);
    });
  });

  describe('the cup example', () => {
    const definition = preset('cup');

    it('writes one row per stage in graph order with 1-based stage_order', () => {
      const { stages } = plan(definition, {}, 16);
      expect(stages.map((s) => [s.key, s.stage_order, s.bracket_type])).toEqual([
        ['groups', 1, 'round_robin'],
        ['knockout', 2, 'single_elim'],
      ]);
    });

    it('copies best-of, doubles, the reset flag and the frozen stage', () => {
      const { stages } = plan(definition, { specHash: 'c'.repeat(64) }, 16);
      const knockout = stages[1];
      expect(knockout.best_of_default).toBe(3);
      expect(knockout.is_doubles).toBe(false);
      expect(knockout.bracket_reset_enabled).toBe(true);
      expect(knockout.stage_spec).toEqual({
        v: 1,
        spec_hash: 'c'.repeat(64),
        stage: definition.stages[1],
        mapped_bracket_type: 'single_elim',
      });
      expect(knockout.stage_spec.stage).not.toBe(definition.stages[1]);
    });

    it('maps the final override once the bracket size is known', () => {
      // 8 players in the knockout: 3 rounds, so the last round is Finals.
      const { stages } = plan(definition, {}, 16);
      expect(stages[1].bo_overrides).toEqual({ Finals: 5 });
    });

    it('warns about the groups the engine does not create yet', () => {
      const { warnings } = plan(definition, {}, 16);
      expect(warnings).toEqual([{ code: 'groups_not_created', stage: 'groups', params: { count: 4, method: 'serpentine' } }]);
    });
  });

  describe('stage order', () => {
    it('follows the graph, not the declaration order', () => {
      const definition = preset('cup');
      const reversed: FormatDefinition = { ...definition, stages: [...definition.stages].reverse() };
      const { stages } = plan(reversed, {}, 16);
      expect(stages.map((s) => s.key)).toEqual(['groups', 'knockout']);
      expect(stages.map((s) => s.stage_order)).toEqual([1, 2]);
    });

    it('appends a stage that is missing from the order, in declaration order', () => {
      const definition = preset('cup');
      const planned = planStages({
        definition,
        graphOrder: ['knockout'],
        plan: [],
        seasonRulesetId: 'r',
        seasonLanguage: 'en',
        specHash: 'd'.repeat(64),
      });
      expect(planned.stages.map((s) => [s.key, s.stage_order])).toEqual([
        ['knockout', 1],
        ['groups', 2],
      ]);
    });
  });

  describe('rulesets', () => {
    it('uses the league ruleset for a season_default stage and the named one otherwise', () => {
      const definition = preset('cup');
      definition.stages[1].ruleset = { kind: 'ruleset', id: RULESET_EXPLICIT };
      const { stages } = plan(definition, { seasonRulesetId: RULESET_SEASON }, 16);
      expect(stages.map((s) => s.ruleset_id)).toEqual([RULESET_SEASON, RULESET_EXPLICIT]);
    });

    it('needs no league ruleset when every stage names one', () => {
      const definition = preset('cup');
      for (const stage of definition.stages) stage.ruleset = { kind: 'ruleset', id: RULESET_EXPLICIT };
      const { stages } = plan(definition, { seasonRulesetId: null }, 16);
      expect(stages.map((s) => s.ruleset_id)).toEqual([RULESET_EXPLICIT, RULESET_EXPLICIT]);
    });

    it('does not map a season_default stage without a league ruleset (the caller refuses first)', () => {
      expect(() => plan(preset('cup'), { seasonRulesetId: null }, 16)).toThrow(/has no ruleset/);
    });
  });

  describe('names', () => {
    it('resolves the stage name in the league language', () => {
      const definition = preset('cup');
      definition.stages[0].name = ltext('en', 'Group stage', 'Gruppenphase');
      expect(plan(definition, { seasonLanguage: 'de' }, 16).stages[0].name).toBe('Gruppenphase');
      expect(plan(definition, { seasonLanguage: 'en' }, 16).stages[0].name).toBe('Group stage');
    });

    it('falls back to the base language when the league language is missing', () => {
      const definition = preset('cup');
      definition.stages[0].name = ltext('en', 'Only English');
      expect(plan(definition, { seasonLanguage: 'de' }, 16).stages[0].name).toBe('Only English');
    });

    it('cuts a long name to the title limit', () => {
      const definition = preset('cup');
      definition.stages[0].name = ltext('en', 'x'.repeat(FIELD_LIMITS.TITLE + 50));
      const name = plan(definition, {}, 16).stages[0].name;
      expect(name).toHaveLength(FIELD_LIMITS.TITLE);
    });

    it('uses "Stage <n>" for a name without any text', () => {
      const definition = preset('cup');
      const result = compile(definition);
      const blank = structuredClone(result.definition as FormatDefinition);
      blank.stages[0].name = { base: 'en' };
      const planned = planStages({
        definition: blank,
        graphOrder: (result.graph as { order: readonly string[] }).order,
        plan: result.plan ?? [],
        seasonRulesetId: 'r',
        seasonLanguage: 'en',
        specHash: 'e'.repeat(64),
      });
      expect(planned.stages[0].name).toBe('Stage 1');
    });
  });

  describe('engine gaps', () => {
    it('reports an override the legacy names cannot express', () => {
      const definition = preset('cup');
      definition.stages[1].pairing = { kind: 'double_elim', bracket_reset: false };
      definition.stages[1].series.overrides = [override(1, 'end', 5)];
      const { stages, warnings } = plan(definition, {}, 16);
      expect(stages[1].bo_overrides).toEqual({});
      expect(stages[1].bracket_reset_enabled).toBe(false);
      expect(warnings).toContainEqual({
        code: 'override_unmapped',
        stage: 'knockout',
        params: { round: 1, from: 'end', best_of: 5 },
      });
    });

    it('reports legs, a third-place match and unrun edge selections', () => {
      const definition = preset('cup');
      definition.stages[0].pairing = { kind: 'round_robin', legs: 2, mirror_legs: false };
      definition.stages[1].pairing = { kind: 'single_elim', third_place: true };
      definition.edges[0].select = [
        { kind: 'top_n', n: 2 },
        { kind: 'wildcard', n: 1 },
        { kind: 'bottom_n', n: 1 },
      ];
      const { warnings } = plan(definition, {}, 16);
      expect(warnings).toContainEqual({ code: 'rr_legs_not_run', stage: 'groups', params: { legs: 2 } });
      expect(warnings).toContainEqual({ code: 'third_place_not_run', stage: 'knockout', params: {} });
      expect(warnings).toContainEqual({ code: 'edge_select_not_run', stage: 'groups', edge: 'to_knockout', params: { kind: 'wildcard' } });
      expect(warnings).toContainEqual({ code: 'edge_select_not_run', stage: 'groups', edge: 'to_knockout', params: { kind: 'bottom_n' } });
      expect(warnings.filter((w) => w.code === 'edge_select_not_run')).toHaveLength(2);
    });

    it('lists stage gaps in stage order, then the edge gaps', () => {
      const definition = preset('cup');
      definition.stages[1].pairing = { kind: 'single_elim', third_place: true };
      definition.edges[0].select = [{ kind: 'per_group', n: 2 }, { kind: 'wildcard', n: 1 }];
      const { warnings } = plan(definition, {}, 16);
      expect(warnings.map((w) => w.code)).toEqual(['groups_not_created', 'third_place_not_run', 'edge_select_not_run']);
    });

    it('reports nothing for a format the engine runs completely', () => {
      const definition = preset('swiss-top-cut');
      for (const stage of definition.stages) delete stage.groups;
      const { warnings } = plan(definition, {}, 16);
      expect(warnings.filter((w) => w.code === 'groups_not_created')).toEqual([]);
    });
  });

  it('is deterministic', () => {
    const definition = preset('swiss-top-cut');
    expect(plan(definition, {}, 16)).toEqual(plan(definition, {}, 16));
  });
});
