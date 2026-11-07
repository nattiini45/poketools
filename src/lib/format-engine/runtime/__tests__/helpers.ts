import { compile } from '@/lib/format-kit/compile';
import type { FormatDefinition } from '@/lib/format-kit/types';
import { giftExchangeDoc } from '@/lib/format-kit/__tests__/fixtures/docs';
import { emptyRuntimeState, type KitRuntimeState, type RuntimeItem, type RuntimeLink } from '../types';
import { resolveTunables } from '../tunables';

export const PLAYERS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
export const SEED = 'seed-0123456789';

/** The compiled gift exchange fixture (every Phase 3 kind). */
export function giftDef(): FormatDefinition {
  const result = compile(giftExchangeDoc());
  if (result.definition === null) throw new Error('the gift exchange fixture does not compile');
  return result.definition as FormatDefinition;
}

/** A state with the tunables of `def` resolved from their defaults, plus overrides. */
export function stateFor(def: FormatDefinition, patch: Partial<KitRuntimeState> = {}): KitRuntimeState {
  return { ...emptyRuntimeState(), tunables: resolveTunables(def, undefined).values, ...patch };
}

export const link = (from: string, to: string, relation = 'santa', revealed = false): RuntimeLink => ({ relation, from, to, revealed });

let itemCounter = 0;

export function item(over: Partial<RuntimeItem> & Pick<RuntimeItem, 'resource' | 'player_id'>): RuntimeItem {
  itemCounter += 1;
  return { id: `i-${itemCounter}`, item_id: null, amount: 1, exclusive: false, source: 'event', source_ref: null, ...over };
}

const text = (en: string) => ({ en: { v: en, s: 'human' as const }, base: 'en' as const });

/** A small hand-written format with the names of the Wichtelcup (`new_year`, `santa`, `give_gifts`). */
export function wichtelDef(): FormatDefinition {
  return {
    schema_version: 1,
    identity: { name: text('Wichtel') },
    stages: [
      stage('swiss'),
      stage('finals'),
    ],
    edges: [],
    views: [],
    rules: [
      {
        kind: 'rule.on_event',
        id: 'new_year_opens',
        on: { event: 'round_start', stage: 'swiss', round: 4 },
        effects: [
          { effect: 'unlock_domain', domain: 'new_year' },
          { effect: 'reveal_relation', relation: 'santa' },
        ],
      },
      {
        kind: 'rule.on_event',
        id: 'only_when_cozy',
        on: { event: 'stage_start', stage: 'swiss' },
        when: { k: 'cmp', op: '==', a: { k: 'ref', name: 'tunable.mode', t: 'text' }, b: { k: 'str', v: 'fierce' } },
        effects: [{ effect: 'unlock_domain', domain: 'new_year' }],
      },
      {
        kind: 'player.action',
        id: 'give_gifts',
        label: text('Give gifts'),
        via: 'santa',
        window: { opens_on: { event: 'stage_start', stage: 'finals' }, closes_on: { event: 'stage_start', stage: 'swiss' } },
        steps: [{ resource: 'picks', domain: 'new_year', count: 1 }],
        review: true,
        lock: 'on_submit',
      },
    ],
    text: { sections: [] },
    theme: { world: 'auto' },
    modules: [],
    domains: [
      { key: 'new_year', label: text('New year'), initially: 'locked', visibility: 'when_unlocked', entries: [{ id: 'garchomp', attrs: [] }] },
    ],
    relations: [{ key: 'santa', label: text('Santa'), shape: 'derangement', visibility: { from: 'hidden', to: 'own' } }],
    resources: [{ key: 'picks', label: text('Picks'), holds: { kind: 'domain', domain: 'new_year' }, visibility: 'own', exclusive: 'none' }],
    tunables: [
      { key: 'mode', label: text('Mode'), type: 'enum', default: 'cozy', values: ['cozy', 'fierce'], editable_until: 'start', status: 'experimental' },
    ],
  };
}

function stage(key: string): FormatDefinition['stages'][number] {
  return {
    key,
    name: text(key),
    participants: { from: 'roster', seeding: 'signup' },
    pairing: { kind: 'swiss', rounds: 'auto', avoid_repeats: true },
    series: { best_of: 1, allow_draw: false, overrides: [] },
    ruleset: { kind: 'season_default' },
    doubles: false,
    players_per_match: 2,
    scoring: { win: 3, loss: 0, bye: 0 },
    rank: [],
    columns: [],
  };
}
