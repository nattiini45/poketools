import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { bracketTypeSchema, contentLanguageSchema, seasonFormatTypeSchema, teamVisibilitySchema } from '@/lib/validation/schemas';
import { applyPlanPatch, isPatchablePath } from '../../plans/edit';
import { planReadiness } from '../../plans/readiness';
import { PLAN_SLOT_NAMES, PLAN_SLOT_SCHEMAS, emptyPlan, planAssumptionSchema, planPhaseSchema, planRosterEntrySchema, planRulesetSlotSchema } from '../../plans/schema';
import { ALL_TOOLS } from '../index';
import { PLAN_PATCH_EXAMPLES, PLAN_SET_DESCRIPTION, PLAN_SHAPE_ENUMS, PLAN_SLOT_EXAMPLES } from '../plan-shapes';

/**
 * The cheat-sheet in the `plan_set` and `plan_patch` descriptions is the only way the model learns the slot shapes, so it
 * is held against the schemas that decide what is accepted (`plans/schema.ts`, the route schemas behind it).
 */

const sampleId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Replace each `<...>` placeholder with a valid id (every placeholder stands for something read from a tool). */
function fill(value: unknown): unknown {
  let counter = 0;
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return /^<.+>$/.test(node) ? sampleId((counter += 1)) : node;
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node === 'object' && node !== null) return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
    return node;
  };
  return walk(value);
}

const tool = (name: string) => {
  const found = ALL_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

describe('the plan_set shapes', () => {
  it('give one example for every slot the tool accepts', () => {
    expect(Object.keys(PLAN_SLOT_EXAMPLES).sort()).toEqual([...PLAN_SLOT_NAMES].sort());
  });

  for (const slot of PLAN_SLOT_NAMES) {
    it(`parse with the ${slot} slot schema, and the description carries the example verbatim`, () => {
      const parsed = PLAN_SLOT_SCHEMAS[slot].safeParse(fill(PLAN_SLOT_EXAMPLES[slot]));
      expect(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error.issues)).toBe(true);
      expect(tool('plan_set').description).toContain(JSON.stringify(PLAN_SLOT_EXAMPLES[slot]));
    });
  }

  it('are what the tool description is rendered from, with no double space or line break', () => {
    expect(tool('plan_set').description).toBe(PLAN_SET_DESCRIPTION);
    expect(PLAN_SET_DESCRIPTION).not.toMatch(/\s{2,}|\n/);
  });

  it('name exactly the enumerations of the schemas they mirror', () => {
    expect([...PLAN_SHAPE_ENUMS.bracket_type]).toEqual([...bracketTypeSchema.options]);
    expect([...PLAN_SHAPE_ENUMS.format_type]).toEqual([...seasonFormatTypeSchema.options]);
    expect([...PLAN_SHAPE_ENUMS.team_visibility]).toEqual([...teamVisibilitySchema.options]);
    expect([...PLAN_SHAPE_ENUMS.language]).toEqual([...contentLanguageSchema.options]);
    expect([...PLAN_SHAPE_ENUMS.ruleset_modes]).toEqual(planRulesetSlotSchema.options.map((option) => option.shape.mode.value));
    expect([...PLAN_SHAPE_ENUMS.roster_states]).toEqual(planRosterEntrySchema.options.map((option) => option.shape.state.value));
    for (const value of Object.values(PLAN_SHAPE_ENUMS).flat()) expect(PLAN_SET_DESCRIPTION, value).toContain(value);
  });

  it('put the advancement rule on the receiving phase, never the first (the readiness blocker agrees)', () => {
    const phases = PLAN_SLOT_EXAMPLES.phases;
    expect('advancement_rule' in phases[0]).toBe(false);
    expect(phases[1].advancement_rule).toBeDefined();
    expect(planPhaseSchema.safeParse(fill(phases[1])).success).toBe(true);
    expect(PLAN_SET_DESCRIPTION).toContain('RECEIVES the qualifiers');

    // The whole example Plan: the first phase carries no rule, so the blocker for it does not fire.
    const plan = emptyPlan({ title: 'Example', intent: 'league', contentLocale: 'en' });
    plan.slots = {
      league: PLAN_SLOT_SCHEMAS.league.parse(fill(PLAN_SLOT_EXAMPLES.league)),
      phases: PLAN_SLOT_SCHEMAS.phases.parse(fill(PLAN_SLOT_EXAMPLES.phases)),
    };
    const blockers = planReadiness(plan).blockers.map((blocker) => blocker.code);
    expect(blockers).not.toContain('advancement_rule_on_first_phase');
  });

  it('tell the model to set one slot per call', () => {
    expect(PLAN_SET_DESCRIPTION).toContain('Set one slot per call');
  });

  it('say the literal values are only illustrations, never defaults to copy', () => {
    expect(PLAN_SET_DESCRIPTION).toContain('only show the shape');
    expect(PLAN_SET_DESCRIPTION).toContain("use the admin's values");
    expect(PLAN_SET_DESCRIPTION).toContain('record a default as an assumption');
  });
});

describe('the plan_patch examples', () => {
  const description = (): string => tool('plan_patch').description;

  it('are in the description verbatim and use paths the editor accepts at the Plan root', () => {
    for (const op of Object.values(PLAN_PATCH_EXAMPLES)) {
      expect(description()).toContain(JSON.stringify(op));
      expect(isPatchablePath(op.path), op.path).toBe(true);
    }
    expect(isPatchablePath('/doc/slots/phases')).toBe(false);
  });

  it('apply: the slot edit changes the advancement count, the assumption is appended with "-"', () => {
    const base = emptyPlan({ title: 'Example', intent: 'league', contentLocale: 'en' });
    base.slots = { phases: PLAN_SLOT_SCHEMAS.phases.parse(fill(PLAN_SLOT_EXAMPLES.phases)) };

    const replaced = applyPlanPatch(base, JSON.stringify([{ ...PLAN_PATCH_EXAMPLES.replace, value: 3 }]));
    expect(replaced.ok && replaced.plan.slots.phases?.[1].advancement_rule?.count).toBe(3);

    const added = applyPlanPatch(base, JSON.stringify([PLAN_PATCH_EXAMPLES.assumption]));
    expect(added.ok && added.plan.assumptions).toEqual([PLAN_PATCH_EXAMPLES.assumption.value]);
    expect(planAssumptionSchema.safeParse(PLAN_PATCH_EXAMPLES.assumption.value).success).toBe(true);
  });

  it('say how a double round robin is recorded and that a refused operation applies nothing', () => {
    expect(description()).toContain('legs.<phase key>');
    expect(description()).toContain('nothing is applied');
    expect(description()).not.toMatch(/\s{2,}|\n/);
  });
});

describe('the smaller description lines', () => {
  const text = (name: string) => tool(name).description;

  it('carry the guidance the diagnosis asked for', () => {
    expect(text('plan_create')).toContain('working label');
    expect(text('plan_create')).toContain('not the league name');
    expect(text('whoami')).toContain('max_phase');
    expect(text('ruleset_list')).toContain('no name filter');
    expect(text('outward_effects_preview')).toContain('never to explain a refusal');
    expect(text('propose_build')).toContain('not chosen by the admin');
    expect(text('request_clarification')).toContain('always pass options');
    expect(text('league_list')).toContain('does not prove the league is missing');
  });
});
