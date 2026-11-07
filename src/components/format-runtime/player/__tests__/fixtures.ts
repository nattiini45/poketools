/**
 * Builders of the view DTOs the player components render. A gift exchange in miniature: one `via` action with one step of
 * two picks from a three-entry list, one hidden-giver relation, a few items and one challenge ladder.
 */
import { ltext } from '@/lib/studio-core/ltext';
import type {
  ActionView,
  ChallengeView,
  DomainEntriesView,
  EntryView,
  ItemView,
  LadderView,
  PlayerFormatView,
  RelationView,
  StepView,
} from '@/lib/format-engine/runtime/view-types';

export const SEASON_ID = '5e150000-0000-4000-8000-000000000001';
export const PHASE_ID = '5e150000-0000-4000-8000-0000000000a1';
export const ME = '5e150000-0000-4000-8000-0000000000b1';
export const ANNA = '5e150000-0000-4000-8000-0000000000b2';
export const BEN = '5e150000-0000-4000-8000-0000000000b3';
export const CARA = '5e150000-0000-4000-8000-0000000000b4';

export const entry = (id: string, attrs: EntryView['attrs'] = []): EntryView => ({ id, attrs });

export const ENTRIES: EntryView[] = [
  entry('pikachu', [{ key: 'tier', value: 'normal' }]),
  entry('charizard', [{ key: 'tier', value: 'premium' }]),
  entry('bulbasaur'),
];

export const DOMAINS: DomainEntriesView[] = [{ key: 'pool', label: ltext('en', 'Gift pool', 'Geschenke'), entries: ENTRIES }];

export const step = (over: Partial<StepView> = {}): StepView => ({
  index: 0,
  resource: 'gift',
  resource_label: ltext('en', 'Gift', 'Geschenk'),
  domain: 'pool',
  domain_label: ltext('en', 'Gift pool', 'Geschenke'),
  count: 2,
  distinct_attr: null,
  unlocked: true,
  blocked: [],
  ...over,
});

export const action = (over: Partial<ActionView> = {}): ActionView => ({
  id: 'gifts',
  label: ltext('en', 'Choose your gifts', 'Wähle deine Geschenke'),
  window: 'open',
  lock: 'on_close',
  accessible: true,
  actionable: true,
  target: { id: ANNA, name: 'Anna' },
  target_hidden: false,
  steps: [step()],
  submission: null,
  ...over,
});

export const challenge = (over: Partial<ChallengeView> = {}): ChallengeView => ({
  id: '5e150000-0000-4000-8000-0000000000c1',
  phase_id: PHASE_ID,
  challenger: { id: ME, name: 'Me' },
  defender: { id: BEN, name: 'Ben' },
  state: 'open',
  lapsed: false,
  round: 2,
  created_at: '2026-10-09T10:00:00.000Z',
  expires_at: '2026-10-11T10:00:00.000Z',
  responded_at: null,
  match_id: null,
  ...over,
});

export const ladder = (over: Partial<LadderView> = {}): LadderView => ({
  phase_id: PHASE_ID,
  stage_key: 'ladder',
  stage_label: ltext('en', 'Challenge ladder', 'Herausforderungsleiter'),
  round: 2,
  config: { rank_range: 3, max_open: 2, cooldown_rounds: 1, accept_window_hours: 48 },
  table: [
    { player: { id: ANNA, name: 'Anna' }, rank: 1 },
    { player: { id: BEN, name: 'Ben' }, rank: 2 },
    { player: { id: ME, name: 'Me' }, rank: 3 },
    { player: { id: CARA, name: null }, rank: 4 },
  ],
  my_rank: 3,
  targets: [ANNA, BEN],
  challenges: [],
  ...over,
});

export const relation = (over: Partial<RelationView> = {}): RelationView => ({
  key: 'santa',
  label: ltext('en', 'Secret santa', 'Wichteln'),
  shape: 'derangement',
  links: [],
  ...over,
});

export const item = (over: Partial<ItemView> = {}): ItemView => ({
  resource: 'gift',
  resource_label: ltext('en', 'Gift', 'Geschenk'),
  item_id: 'pikachu',
  amount: 1,
  holder: null,
  ...over,
});

export function runningView(over: Partial<Extract<PlayerFormatView, { running: true }>> = {}): Extract<PlayerFormatView, { running: true }> {
  return { running: true, actions: [action()], domains: DOMAINS, pools: [], items: [], relations: [], ladders: [], ...over };
}
