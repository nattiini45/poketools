import { describe, expect, it } from 'vitest';
import type { FormatDefinition } from '@/lib/format-kit/types';
import { planEffects } from '../effects';
import { item, PLAYERS, SEED, stateFor, wichtelDef } from './helpers';

const text = (en: string) => ({ en: { v: en, s: 'human' as const }, base: 'en' as const });

/** The Wichtel format with a global exclusive `picks` resource of the given capacity, granted by a stage_start rule. */
function defWith(capacity: number | undefined, items: string[]): FormatDefinition {
  const def = wichtelDef();
  return {
    ...def,
    resources: [
      {
        key: 'picks',
        label: text('Picks'),
        holds: { kind: 'domain', domain: 'new_year' },
        visibility: 'own',
        exclusive: 'global',
        ...(capacity !== undefined ? { capacity } : {}),
      },
    ],
    rules: [
      {
        kind: 'rule.on_event',
        id: 'grant_all',
        on: { event: 'stage_start', stage: 'swiss' },
        effects: items.map((id) => ({ effect: 'grant_resource' as const, resource: 'picks', item: id, amount: 1, to: { who: 'all' as const } })),
      },
    ],
  };
}

const START = { event: 'stage_start', stage: 'swiss' } as const;

describe('an exclusive grant respects the resource capacity', () => {
  it('stops granting once a player holds `capacity` units', () => {
    const plan = planEffects(defWith(1, ['garchomp', 'rotom']), START, stateFor(wichtelDef()), ['p1'], SEED);
    expect(plan.ops.filter((op) => op.op === 'grant_item')).toHaveLength(1);
    expect(plan.issues).toEqual([{ code: 'capacity_reached', rule: 'grant_all', detail: 'picks:p1' }]);
  });

  it('counts the units a player already holds', () => {
    const state = stateFor(wichtelDef(), { items: [item({ resource: 'picks', player_id: 'p1', item_id: 'pikachu', exclusive: true })] });
    const plan = planEffects(defWith(1, ['garchomp']), START, state, ['p1', 'p2'], SEED);
    const granted = plan.ops.filter((op) => op.op === 'grant_item').map((op) => (op.op === 'grant_item' ? op.player_id : ''));
    expect(granted).toEqual(['p2']);
    expect(plan.issues.map((i) => i.code)).toContain('capacity_reached');
  });

  it('grants every exclusive item while the capacity has room or the resource has none', () => {
    const roomy = planEffects(defWith(2, ['garchomp', 'rotom']), START, stateFor(wichtelDef()), ['p1'], SEED);
    expect(roomy.ops.filter((op) => op.op === 'grant_item')).toHaveLength(2);
    const unlimited = planEffects(defWith(undefined, ['garchomp', 'rotom']), START, stateFor(wichtelDef()), PLAYERS.slice(0, 1), SEED);
    expect(unlimited.ops.filter((op) => op.op === 'grant_item')).toHaveLength(2);
    expect(unlimited.issues).toEqual([]);
  });
});
