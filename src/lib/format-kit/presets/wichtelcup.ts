/**
 * A NEUTRAL Secret Santa cup example (made-up pools). It demonstrates the mechanic the private community tournament
 * builds on: every player gifts two junk Pokémon (different primary roles) and one premium Pokémon to the player they
 * drew; the weeks then demand the gifts in a fixed order, and a surprise pool stays hidden until the organizer opens
 * it. The real tournament's pools, exact levels, six-round structure and playoff live in the private pack, which
 * replaces this example (docs/format-packs.md, "Pack extensions").
 *
 * Nothing in the engine knows the word Wichtelcup: the pools are domains, the gifts are resource items held by the
 * recipient, the Secret Santa is a derangement relation, the gift form is a player action and the weekly obligations
 * are `count` constraints gated on the round. The two junk gifts are told apart by their `ordinal` (the selection
 * order stored on the holding), so week 1 demands junk gift #1 and week 2 junk gift #2.
 *
 * The species tables are transcribed once, in `@/lib/pkmn/preset-data/wichtelcup` (dex-free, no imports), and mapped
 * to dex ids here. The pinned rule preset `gen9natdexwichtelcup` owns the exact-forme allowlist, the item and ability
 * bans, the Species Clause, the Item Clause and the levels. Legality is expressed with `when` on `round`, never with
 * the unlock flag of a domain, so a late audit of a week-1 team does not see the surprise pool as open.
 */
import {
  WICHTELCUP_JUNK,
  WICHTELCUP_JUNK_ROLES,
  WICHTELCUP_NEW_YEAR,
  WICHTELCUP_NORMAL,
  WICHTELCUP_PREMIUM,
} from '@/lib/pkmn/preset-data/wichtelcup';
import { toID } from '@/lib/pkmn/i18n/id';
import { ltext } from '@/lib/studio-core/ltext';
import type { Expr } from '../expr/ast';
import type { DomainDef, DomainEntry, FormatDefinition, TeamConstraint } from '../types';

const entries = (names: readonly string[]): DomainEntry[] => names.map((name) => ({ id: toID(name), attrs: [] }));

const junkEntries = (): DomainEntry[] =>
  WICHTELCUP_JUNK.map((name) => ({ id: toID(name), attrs: [{ key: 'primary_role', value: WICHTELCUP_JUNK_ROLES[name] }] }));

const domains: DomainDef[] = [
  {
    key: 'normal',
    label: ltext('en', 'Normal pool', 'Normaler Pool'),
    entries: entries(WICHTELCUP_NORMAL),
    initially: 'unlocked',
    visibility: 'public',
  },
  {
    key: 'junk',
    label: ltext('en', 'Junk gift pool', 'Schrottgeschenke-Pool'),
    entries: junkEntries(),
    initially: 'unlocked',
    visibility: 'public',
  },
  {
    key: 'premium',
    label: ltext('en', 'Premium gift pool', 'Premiumgeschenke-Pool'),
    entries: entries(WICHTELCUP_PREMIUM),
    initially: 'unlocked',
    visibility: 'public',
  },
  {
    // The surprise: its very existence stays hidden from players until the organizer unlocks it (`when_unlocked`).
    key: 'new_year',
    label: ltext('en', "New Year's pool", 'Silvester-Pool'),
    entries: entries(WICHTELCUP_NEW_YEAR),
    initially: 'locked',
    visibility: 'when_unlocked',
  },
];

/** `round` of the team check. */
const round: Expr = { k: 'ref', name: 'round', t: 'number' };
const roundIs = (op: '==' | '<=' | '>=', n: number): Expr => ({ k: 'cmp', op, a: round, b: { k: 'num', v: n } });

const junkGifts = { kind: 'resource', resource: 'junk_gifts' } as const;
const junkGift1 = { kind: 'resource', resource: 'junk_gifts', ordinal: 1 } as const;
const junkGift2 = { kind: 'resource', resource: 'junk_gifts', ordinal: 2 } as const;
const premiumGift = { kind: 'resource', resource: 'premium_gift' } as const;
const newYear = { kind: 'domain', domain: 'new_year', unlocked_only: true } as const;

const constraints: TeamConstraint[] = [
  // Exactly six Pokémon, no Terastallization.
  { kind: 'roster_size', min: 6, max: 6 },
  { kind: 'tera', mode: 'banned' },
  // The allowlist: the normal pool, the player's OWN gifts and the surprise pool; everything else is outside it.
  {
    kind: 'count',
    source: { kind: 'not', source: { kind: 'any_of', sources: [{ kind: 'domain', domain: 'normal', unlocked_only: false }, junkGifts, premiumGift, newYear] } },
    max: 0,
  },
  // Week 1: exactly junk gift #1, and not junk gift #2.
  { kind: 'count', source: junkGift1, min: 1, max: 1, when: roundIs('==', 1) },
  { kind: 'count', source: junkGift2, max: 0, when: roundIs('==', 1) },
  // Week 2: exactly junk gift #2, and not junk gift #1.
  { kind: 'count', source: junkGift2, min: 1, max: 1, when: roundIs('==', 2) },
  { kind: 'count', source: junkGift1, max: 0, when: roundIs('==', 2) },
  // Weeks 3 and 4: both junk gifts.
  { kind: 'count', source: junkGifts, min: 2, max: 2, when: roundIs('>=', 3) },
  // The premium gift is not available before week 4, then mandatory.
  { kind: 'count', source: premiumGift, max: 0, when: roundIs('<=', 3) },
  { kind: 'count', source: premiumGift, min: 1, when: roundIs('>=', 4) },
  // The surprise pool is closed through the December weeks (the example has four rounds).
  { kind: 'count', source: newYear, max: 0, when: roundIs('<=', 4) },
];

export const wichtelcup: FormatDefinition = {
  schema_version: 1,
  identity: {
    name: ltext('en', 'Wichtelcup (example)', 'Wichtelcup (Beispiel)'),
    summary: ltext(
      'en',
      'A made-up Secret Santa cup example: every player gifts three Pokémon to another player, and the gifts decide which team you may bring each week. A maintainer pack replaces it with the real tournament.',
      'Ein erfundenes Wichtel-Cup-Beispiel: Jeder beschenkt einen anderen Spieler mit drei Pokémon, und die Geschenke bestimmen, welches Team du in welcher Woche spielen darfst. Ein Maintainer-Pack ersetzt es durch das echte Turnier.',
    ),
  },
  stages: [
    {
      key: 'cup',
      name: ltext('en', 'Cup', 'Cup'),
      participants: { from: 'roster', seeding: 'random' },
      pairing: { kind: 'swiss', rounds: 4, avoid_repeats: true },
      series: { best_of: 1, allow_draw: false, overrides: [] },
      ruleset: { kind: 'preset', preset: 'gen9natdexwichtelcup' },
      doubles: false,
      players_per_match: 2,
      scoring: {
        win: 30,
        loss: 10,
        bye: 0,
        per_opponent_faint: 1,
        forfeit: { win: 30, loss: 0, faint_bonus: false },
      },
      rank: [
        { kind: 'metric', metric: 'points', direction: 'desc' },
        { kind: 'decision_match' },
      ],
      columns: ['points', 'wins', 'losses', 'faints_dealt'],
      constraints,
      calendar: {
        start: { kind: 'season_start' },
        time: '18:00',
        cadence: 'weekly',
        every: 1,
        round_window_hours: 168,
        marks: [
          { key: 'gifts_open', round: 1, offset_hours: -336 },
          { key: 'gifts_close', round: 1, offset_hours: -12 },
        ],
        deadlines: [
          { applies: 'action', action: 'choose_gifts', offset_hours: 0, on_miss: 'admin_review' },
          { applies: 'team', offset_hours: -24, on_miss: 'admin_review' },
          { applies: 'match', offset_hours: 0, on_miss: 'admin_review' },
        ],
      },
      end_when: { kind: 'rounds', rounds: 4 },
    },
  ],
  edges: [],
  views: [],
  attributes: [
    {
      key: 'primary_role',
      label: ltext('en', 'Primary role', 'Hauptrolle'),
      on: 'entry',
      type: 'enum',
      values: ['hazard_removal', 'hazard_setter', 'wall_stall', 'support', 'weather_setter', 'attacker'],
    },
  ],
  domains,
  relations: [
    {
      key: 'santa',
      label: ltext('en', 'Secret Santa', 'Wichtel'),
      shape: 'derangement',
      visibility: { from: 'hidden', to: 'own' },
    },
  ],
  resources: [
    {
      key: 'junk_gifts',
      label: ltext('en', 'Junk gifts', 'Schrottgeschenke'),
      holds: { kind: 'domain', domain: 'junk' },
      capacity: 2,
      visibility: 'own',
      exclusive: 'none',
    },
    {
      key: 'premium_gift',
      label: ltext('en', 'Premium gift', 'Premiumgeschenk'),
      holds: { kind: 'domain', domain: 'premium' },
      capacity: 1,
      visibility: 'own',
      exclusive: 'global',
    },
  ],
  rules: [
    {
      kind: 'rule.on_event',
      id: 'gifts_open_note',
      on: { event: 'time', mark: 'gifts_open' },
      effects: [
        {
          effect: 'notify',
          message: ltext(
            'en',
            'Gift selection is open. Choose two junk gifts with different roles and one premium gift for your recipient.',
            'Die Geschenkauswahl ist geöffnet. Wähle zwei Schrottgeschenke mit verschiedenen Rollen und ein Premiumgeschenk für deinen Beschenkten.',
          ),
          to: { who: 'all' },
        },
      ],
    },
    {
      // Each recipient's giver is revealed to that recipient alone, right after their own week-4 match — never the
      // whole field at once. The organizer opens the surprise pool separately, by hand.
      kind: 'rule.on_event',
      id: 'christmas_reveal',
      on: { event: 'match_completed', stage: 'cup' },
      when: roundIs('==', 4),
      effects: [{ effect: 'reveal_relation', relation: 'santa', to: { who: 'event_players' } }],
    },
    {
      kind: 'player.action',
      id: 'choose_gifts',
      label: ltext('en', 'Choose gifts', 'Geschenke wählen'),
      via: 'santa',
      window: {
        opens_on: { event: 'time', mark: 'gifts_open' },
        closes_on: { event: 'time', mark: 'gifts_close' },
      },
      steps: [
        { resource: 'junk_gifts', domain: 'junk', count: 2, distinct_attr: 'primary_role' },
        { resource: 'premium_gift', domain: 'premium', count: 1 },
      ],
      lock: 'on_submit',
    },
    { kind: 'check.assisted', id: 'tied_standings', source: { kind: 'standings_tie', stage: 'cup' } },
    { kind: 'check.assisted', id: 'unresolved_result', source: { kind: 'unresolved_outcome' } },
    { kind: 'check.assisted', id: 'repeat_pairing', source: { kind: 'pairing_rematch', stage: 'cup' } },
    {
      kind: 'adjust.manual',
      id: 'organizer_tools',
      allow: ['points', 'resource', 'relation', 'outcome', 'action', 'domain', 'rank'],
    },
    {
      kind: 'rule.custom',
      id: 'tiebreak_matches',
      text: ltext(
        'en',
        'Ties in the standings are settled by extra matches that the organizer arranges; the procedure for three or more tied players is decided by the organizer.',
        'Gleichstände in der Tabelle werden durch Zusatzspiele entschieden, die der Organisator ansetzt; das Verfahren bei drei oder mehr punktgleichen Spielern legt der Organisator fest.',
      ),
      scope: { kind: 'season' },
      verify: 'admin_checklist',
      when: 'once',
      visible_to_players: true,
    },
  ],
  text: {
    sections: [
      {
        id: 'overview',
        title: ltext('en', 'How the example works', 'So funktioniert das Beispiel'),
        body: ltext(
          'en',
          'A made-up example of the Secret Santa cup mechanic. A small field plays four weekly Swiss rounds, one best-of-one match per player per week, six against six. A win is worth 30 points, a loss 10, and every fainted opposing Pokémon adds 1 point. Everyone gives three Pokémon to one other player and receives three from another one. What you may bring in a week depends on those gifts. Terastallization is not allowed. The real community tournament ships in a maintainer pack.',
          'Ein erfundenes Beispiel der Wichtel-Cup-Mechanik. Ein kleines Feld spielt vier wöchentliche Schweizer Runden, pro Woche ein Match im Best-of-One, sechs gegen sechs. Ein Sieg zählt 30 Punkte, eine Niederlage 10, und jedes besiegte gegnerische Pokémon bringt 1 Punkt. Jeder schenkt einem anderen Spieler drei Pokémon und bekommt drei von einem anderen. Was du in einer Woche mitbringen darfst, hängt von diesen Geschenken ab. Terakristallisierung ist nicht erlaubt. Das echte Community-Turnier wird in einem Maintainer-Pack ausgeliefert.',
        ),
      },
      {
        id: 'weekly_requirements',
        title: ltext('en', 'What you bring each week', 'Was du jede Woche mitbringst'),
        body: ltext(
          'en',
          'Every match uses exactly six Pokémon. Week 1: your junk gift #1, the rest from the normal pool. Week 2: your junk gift #2, the rest from the normal pool. Week 3: both junk gifts, the rest from the normal pool. Week 4: both junk gifts and your premium gift, the rest from the normal pool. A gift is not available to other players. The Species Clause and the Item Clause apply every week.',
          'Jedes Match verwendet genau sechs Pokémon. Woche 1: dein Schrottgeschenk #1, der Rest aus dem normalen Pool. Woche 2: dein Schrottgeschenk #2, der Rest aus dem normalen Pool. Woche 3: beide Schrottgeschenke, der Rest aus dem normalen Pool. Woche 4: beide Schrottgeschenke und dein Premiumgeschenk, der Rest aus dem normalen Pool. Ein Geschenk steht anderen Spielern nicht zur Verfügung. Spezies-Klausel und Item-Klausel gelten jede Woche.',
        ),
      },
    ],
  },
  theme: { world: 'auto' },
  modules: [],
};
