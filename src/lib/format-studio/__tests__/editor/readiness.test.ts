import { describe, expect, it } from 'vitest';
import { PRESETS, deepFreeze, type FormatDefinition } from '@/lib/format-kit/client';
import { LEAGUE_ADMIN_TABS } from '@/lib/league-admin/tabs';
import { computeReadiness, type ReadinessInput, type ReadinessItem } from '../../editor/readiness';

const RULESET = '3f2b8c1e-5a47-4d09-9b6e-7c1d2a4e8f10';

function spec(id: string): FormatDefinition {
  const found = PRESETS.find((entry) => entry.id === id);
  if (!found) throw new Error(`no preset ${id}`);
  return structuredClone(found.definition);
}

/** A custom league that is ready: the classic league attached, enough players, a league ruleset, all phases made. */
function ready(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    formatType: 'custom',
    started: false,
    participantCount: 8,
    seasonRulesetId: RULESET,
    attached: { version_no: 1, spec: spec('classic-league') },
    phaseCount: 2,
    manualPhaseCount: 0,
    ...over,
  };
}

const item = (input: ReadinessInput, id: ReadinessItem['id']): ReadinessItem => {
  const found = computeReadiness(input).items.find((entry) => entry.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

const PICKER = { tab: 'format', anchor: 'format-attach' };

describe('not applicable', () => {
  it.each(['singles', 'doubles', 'draft', 'evolution_point_buy'] as const)('%s leagues have no checklist', (formatType) => {
    expect(computeReadiness(ready({ formatType, attached: null }))).toEqual({ applicable: false, ready: true, items: [], blockedReason: null });
  });
});

describe('a custom league without a format', () => {
  const result = computeReadiness(ready({ attached: null, phaseCount: 0 }));

  it('is applicable, not ready and blocked', () => {
    expect(result.applicable).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.blockedReason).toBe('format_not_attached');
  });

  it('lists the four items in order, the first unmet with a link to the picker and the rest waiting', () => {
    expect(result.items.map((i) => i.id)).toEqual(['format_attached', 'phases_created', 'roster_size', 'rulesets']);
    expect(result.items.map((i) => i.state)).toEqual(['unmet', 'waiting', 'waiting', 'waiting']);
    expect(result.items[0]).toEqual({ id: 'format_attached', state: 'unmet', params: {}, action: PICKER });
    for (const waiting of result.items.slice(1)) expect(waiting.action).toBeNull();
  });
});

describe('a custom league that is ready', () => {
  it('has four met items, no action and no block', () => {
    const result = computeReadiness(ready());
    expect(result.ready).toBe(true);
    expect(result.blockedReason).toBeNull();
    expect(result.items.map((i) => i.state)).toEqual(['met', 'met', 'met', 'met']);
    expect(result.items.every((i) => i.action === null)).toBe(true);
  });

  it('more players and more phases than needed still count as met', () => {
    expect(computeReadiness(ready({ participantCount: 40, phaseCount: 5, manualPhaseCount: 1 })).ready).toBe(true);
  });
});

describe('phases_created', () => {
  it('is unmet when fewer phases exist than the format has stages, and points at the format tab', () => {
    expect(item(ready({ phaseCount: 0 }), 'phases_created')).toEqual({
      id: 'phases_created',
      state: 'unmet',
      params: { have: 0, need: 2, manual: 0 },
      action: { tab: 'format' },
    });
    expect(item(ready({ phaseCount: 1 }), 'phases_created').params).toEqual({ have: 1, need: 2, manual: 0 });
  });

  it('does not count hand-made phases, and then points at the phases tab', () => {
    expect(item(ready({ phaseCount: 2, manualPhaseCount: 1 }), 'phases_created')).toEqual({
      id: 'phases_created',
      state: 'unmet',
      params: { have: 1, need: 2, manual: 1 },
      action: { tab: 'phases' },
    });
  });

  it('never reports a negative count', () => {
    expect(item(ready({ phaseCount: 0, manualPhaseCount: 3 }), 'phases_created').params).toEqual({ have: 0, need: 2, manual: 3 });
  });

  it('does not block the Active status', () => {
    expect(computeReadiness(ready({ phaseCount: 0 })).blockedReason).toBeNull();
  });
});

describe('roster_size', () => {
  it('is unmet below the smallest roster the format can start with', () => {
    // Four groups need two players each.
    const cup = ready({ attached: { version_no: 1, spec: spec('cup') }, participantCount: 5 });
    expect(item(cup, 'roster_size')).toEqual({ id: 'roster_size', state: 'unmet', params: { have: 5, need: 8 }, action: { tab: 'participants' } });
    expect(item({ ...cup, participantCount: 8 }, 'roster_size').state).toBe('met');
  });

  it('needs two players when no stage has groups', () => {
    expect(item(ready({ participantCount: 1 }), 'roster_size').params).toEqual({ have: 1, need: 2 });
    expect(item(ready({ participantCount: 2 }), 'roster_size').state).toBe('met');
  });
});

describe('rulesets', () => {
  it('is met when the league has a ruleset', () => {
    expect(item(ready({ seasonRulesetId: RULESET }), 'rulesets').state).toBe('met');
  });

  it('is unmet when the league has none and a stage falls back on it, and points at the picker', () => {
    expect(item(ready({ seasonRulesetId: null }), 'rulesets')).toEqual({ id: 'rulesets', state: 'unmet', params: { count: 2 }, action: PICKER });
  });

  it('is met without a league ruleset when every stage names its own', () => {
    const named = spec('classic-league');
    named.stages = named.stages.map((s) => ({ ...s, ruleset: { kind: 'ruleset' as const, id: RULESET } }));
    expect(item(ready({ seasonRulesetId: null, attached: { version_no: 1, spec: named } }), 'rulesets')).toMatchObject({ state: 'met', params: { count: 0 } });
  });

  it('is met without a league ruleset when every stage plays a rule preset', () => {
    const presets = spec('classic-league');
    presets.stages = presets.stages.map((s) => ({ ...s, ruleset: { kind: 'preset' as const, preset: 'gen9ou' } }));
    expect(item(ready({ seasonRulesetId: null, attached: { version_no: 1, spec: presets } }), 'rulesets')).toMatchObject({ state: 'met', params: { count: 0 } });
  });

  it('counts only the stages that fall back on the league ruleset', () => {
    const mixed = spec('classic-league');
    mixed.stages[0] = { ...mixed.stages[0], ruleset: { kind: 'ruleset', id: RULESET } };
    expect(item(ready({ seasonRulesetId: null, attached: { version_no: 1, spec: mixed } }), 'rulesets')).toMatchObject({ state: 'unmet', params: { count: 1 } });
  });

  it('does not block the Active status', () => {
    expect(computeReadiness(ready({ seasonRulesetId: null })).blockedReason).toBeNull();
  });
});

describe('started leagues', () => {
  it('keep the states they would have otherwise', () => {
    for (const over of [{}, { participantCount: 1 }, { seasonRulesetId: null }, { phaseCount: 0 }, { attached: null }] as Partial<ReadinessInput>[]) {
      const before = computeReadiness(ready({ ...over, started: false }));
      const after = computeReadiness(ready({ ...over, started: true }));
      expect(after).toEqual(before);
    }
  });
});

describe('table over every combination', () => {
  const combos: Array<{ attached: boolean; phases: 'none' | 'all' | 'manual'; players: 'few' | 'enough'; ruleset: boolean }> = [];
  for (const attached of [false, true]) {
    for (const phases of ['none', 'all', 'manual'] as const) {
      for (const players of ['few', 'enough'] as const) {
        for (const ruleset of [false, true]) combos.push({ attached, phases, players, ruleset });
      }
    }
  }

  it.each(combos.map((c) => [JSON.stringify(c), c] as const))('%s', (_name, c) => {
    const result = computeReadiness(
      ready({
        attached: c.attached ? { version_no: 1, spec: spec('classic-league') } : null,
        phaseCount: c.phases === 'none' ? 0 : 2,
        manualPhaseCount: c.phases === 'manual' ? 2 : 0,
        participantCount: c.players === 'few' ? 1 : 8,
        seasonRulesetId: c.ruleset ? RULESET : null,
      }),
    );
    expect(result.items.map((i) => i.id)).toEqual(['format_attached', 'phases_created', 'roster_size', 'rulesets']);
    expect(result.blockedReason).toBe(c.attached ? null : 'format_not_attached');
    expect(result.items[0].state).toBe(c.attached ? 'met' : 'unmet');
    if (!c.attached) {
      expect(result.items.slice(1).every((i) => i.state === 'waiting')).toBe(true);
    } else {
      expect(result.items[1].state).toBe(c.phases === 'all' ? 'met' : 'unmet');
      expect(result.items[2].state).toBe(c.players === 'enough' ? 'met' : 'unmet');
      expect(result.items[3].state).toBe(c.ruleset ? 'met' : 'unmet');
    }
    expect(result.ready).toBe(result.items.every((i) => i.state === 'met'));
    // Only an unmet item has somewhere to go, and it is always a real league tab.
    for (const entry of result.items) {
      expect(entry.action === null, entry.id).toBe(entry.state !== 'unmet');
      if (entry.action) expect(LEAGUE_ADMIN_TABS).toContain(entry.action.tab);
    }
  });
});

describe('purity', () => {
  it('does not mutate its input', () => {
    const input = deepFreeze(ready({ seasonRulesetId: null }));
    expect(() => computeReadiness(input)).not.toThrow();
  });
});

describe('calendar_start', () => {
  /** The classic league with a calendar on its first stage: a gift window two weeks and twelve hours before round 1. */
  function withCalendar(start: { kind: 'season_start' } | { kind: 'date'; date: string } = { kind: 'season_start' }): FormatDefinition {
    const doc = spec('classic-league');
    doc.stages[0] = {
      ...doc.stages[0],
      calendar: {
        start,
        time: '18:00',
        cadence: 'weekly',
        every: 1,
        round_window_hours: 168,
        marks: [
          { key: 'gifts_open', round: 1, offset_hours: -336 },
          { key: 'gifts_close', round: 1, offset_hours: -12 },
        ],
        deadlines: [],
      },
    };
    return doc;
  }
  const calendar = (over: Partial<ReadinessInput> = {}): ReadinessInput =>
    ready({ attached: { version_no: 1, spec: withCalendar() }, seasonStartDate: '2026-12-01', now: new Date('2026-11-05T12:00:00Z'), ...over });
  const found = (input: ReadinessInput) => computeReadiness(input).items.find((entry) => entry.id === 'calendar_start');

  it('is not judged without a start date input, without a calendar, or for a calendar that names its own date', () => {
    expect(found(ready({ attached: { version_no: 1, spec: withCalendar() } }))).toBeUndefined();
    expect(found(ready({ seasonStartDate: '2026-12-01', now: new Date() }))).toBeUndefined();
    expect(found(calendar({ attached: { version_no: 1, spec: withCalendar({ kind: 'date', date: '2026-12-01' }) }, seasonStartDate: null }))).toBeUndefined();
    expect(computeReadiness(ready()).items.map((entry) => entry.id)).toEqual(['format_attached', 'phases_created', 'roster_size', 'rulesets']);
  });

  it('is not listed while no format is attached', () => {
    expect(found(calendar({ attached: null }))).toBeUndefined();
  });

  it('is met when the start date is far enough ahead that no mark is due', () => {
    expect(found(calendar())).toEqual({ id: 'calendar_start', state: 'met', params: {}, action: null });
    expect(computeReadiness(calendar()).ready).toBe(true);
  });

  it('is unmet without a start date: nothing would ever open or fire, and it points at the settings tab', () => {
    expect(found(calendar({ seasonStartDate: null }))).toEqual({
      id: 'calendar_start',
      state: 'unmet',
      params: { reason: 'missing', count: 0 },
      action: { tab: 'settings' },
    });
    expect(computeReadiness(calendar({ seasonStartDate: null })).ready).toBe(false);
  });

  it('reads a start date that is not a date as missing', () => {
    expect(found(calendar({ seasonStartDate: 'soon' }))?.params).toEqual({ reason: 'missing', count: 0 });
  });

  it('accepts a longer ISO start date', () => {
    expect(found(calendar({ seasonStartDate: '2026-12-01T00:00:00Z' }))?.state).toBe('met');
  });

  it('is unmet when marks are already due: they would all fire in one pass', () => {
    // Round 1 opens 2026-11-17 18:00 local: gifts_open (14 days earlier) is due on 2026-11-05, gifts_close (12 hours earlier) is not.
    expect(found(calendar({ seasonStartDate: '2026-11-17' }))).toEqual({
      id: 'calendar_start',
      state: 'unmet',
      params: { reason: 'marks_past', count: 1 },
      action: { tab: 'settings' },
    });
    expect(found(calendar({ seasonStartDate: '2026-11-17', now: new Date('2026-11-20T00:00:00Z') }))?.params).toEqual({ reason: 'marks_past', count: 2 });
  });

  it('counts marks of every stage that starts with the league', () => {
    const two = withCalendar();
    two.stages[1] = { ...two.stages[1], calendar: { ...two.stages[0].calendar!, marks: [{ key: 'later', round: 1, offset_hours: -336 }] } };
    expect(found(calendar({ attached: { version_no: 1, spec: two }, seasonStartDate: '2026-11-17' }))?.params).toEqual({ reason: 'marks_past', count: 2 });
  });

  it('does not judge due marks of a league that has started, or without a clock', () => {
    expect(found(calendar({ seasonStartDate: '2026-11-17', started: true }))?.state).toBe('met');
    expect(found(calendar({ seasonStartDate: '2026-11-17', now: undefined }))?.state).toBe('met');
  });

  it('still reports a missing start date once the league started', () => {
    expect(found(calendar({ seasonStartDate: null, started: true }))?.params).toEqual({ reason: 'missing', count: 0 });
  });

  it('does not block the Active status', () => {
    expect(computeReadiness(calendar({ seasonStartDate: null })).blockedReason).toBeNull();
  });

  it('does not mutate a frozen input', () => {
    expect(() => computeReadiness(deepFreeze(calendar({ seasonStartDate: '2026-11-17' })))).not.toThrow();
  });
});
