/**
 * Valid documents (as plain JSON, fresh on every call) shared by the validator tests. Names are
 * generic on purpose. `kitchenSinkDoc` touches every available primitive at least once.
 */

export type Json = Record<string, unknown>;

export function lt(en: string, de?: string): Json {
  const out: Json = { base: 'en', en: { v: en, s: 'human' } };
  if (de !== undefined) out.de = { v: de, s: 'human' };
  return out;
}

/** The smallest valid document: every default is applied by the validators. */
export function minimalDoc(): Json {
  return {
    schema_version: 1,
    identity: { name: lt('Minimal') },
    stages: [
      {
        key: 'main',
        name: lt('Main'),
        participants: { from: 'roster', seeding: 'signup' },
        pairing: { kind: 'round_robin' },
        series: { best_of: 1 },
        scoring: { win: 3 },
      },
    ],
  };
}

/** `minimalDoc()` after validation: all defaults filled in. */
export function minimalDocValidated(): Json {
  return {
    schema_version: 1,
    identity: { name: lt('Minimal') },
    stages: [
      {
        key: 'main',
        name: lt('Main'),
        participants: { from: 'roster', seeding: 'signup' },
        pairing: { kind: 'round_robin', legs: 1, mirror_legs: true },
        series: { best_of: 1, allow_draw: false, overrides: [] },
        ruleset: { kind: 'season_default' },
        doubles: false,
        players_per_match: 2,
        scoring: { win: 3, loss: 0, bye: 0 },
        rank: [],
        columns: [],
      },
    ],
    edges: [],
    views: [],
    rules: [],
    text: { sections: [] },
    theme: { world: 'auto' },
    modules: [],
  };
}

/** A league with a table stage and a play-off fed by an edge. */
export function leagueDoc(): Json {
  return {
    schema_version: 1,
    identity: { name: lt('League', 'Liga'), summary: lt('A season, then play-offs.', 'Eine Saison, danach Play-offs.'), based_on: 'classic-league' },
    stages: [
      {
        key: 'league',
        name: lt('League', 'Liga'),
        participants: { from: 'roster', seeding: 'signup', expected_count: 12 },
        pairing: { kind: 'round_robin', legs: 2, mirror_legs: true },
        series: { best_of: 1 },
        scoring: { win: 3, loss: 0, bye: 0 },
        rank: [
          { kind: 'metric', metric: 'points', direction: 'desc' },
          { kind: 'head_to_head', scope: 'mini_table' },
          { kind: 'metric', metric: 'kill_differential', direction: 'desc' },
          { kind: 'coin_flip' },
        ],
        columns: ['points', 'wins', 'losses'],
      },
      {
        key: 'playoffs',
        name: lt('Play-offs', 'Play-offs'),
        participants: { from: 'edges', seeding: 'edge_order' },
        pairing: { kind: 'single_elim', third_place: false },
        series: { best_of: 3, overrides: [{ round: 1, from: 'end', best_of: 5 }] },
        scoring: { win: 1 },
      },
    ],
    edges: [
      { key: 'to_playoffs', from: 'league', to: 'playoffs', select: [{ kind: 'top_n', n: 4 }], gate: 'admin_confirm' },
    ],
    rules: [
      {
        kind: 'rule.custom',
        id: 'fair_play',
        text: lt('Be kind to each other.', 'Seid nett zueinander.'),
        verify: 'player_attest',
        when: 'per_matchday',
      },
    ],
    text: { sections: [{ id: 'welcome', title: lt('Welcome', 'Willkommen'), body: lt('Have fun.', 'Viel Spaß.') }] },
  };
}

/** A cup: groups, then a bracket. */
export function cupDoc(): Json {
  return {
    schema_version: 1,
    identity: { name: lt('Cup', 'Pokal') },
    stages: [
      {
        key: 'groups',
        name: lt('Groups', 'Gruppen'),
        participants: { from: 'roster', seeding: 'rating' },
        groups: { count: 4, method: 'serpentine' },
        pairing: { kind: 'round_robin', legs: 1 },
        series: { best_of: 1 },
        scoring: { win: 3 },
        rank: [{ kind: 'metric', metric: 'points', direction: 'desc' }, { kind: 'coin_flip' }],
      },
      {
        key: 'knockout',
        name: lt('Knockout', 'K.-o.-Runde'),
        participants: { from: 'edges', seeding: 'rating' },
        pairing: { kind: 'single_elim', third_place: true },
        series: { best_of: 3 },
        scoring: { win: 1 },
      },
    ],
    edges: [{ key: 'advance', from: 'groups', to: 'knockout', select: [{ kind: 'per_group', n: 2 }] }],
  };
}

/** Swiss rounds, then a cut. */
export function swissDoc(): Json {
  return {
    schema_version: 1,
    identity: { name: lt('Swiss', 'Schweizer System') },
    stages: [
      {
        key: 'swiss',
        name: lt('Swiss rounds', 'Schweizer Runden'),
        participants: { from: 'roster', seeding: 'random' },
        pairing: { kind: 'swiss', rounds: 'auto', avoid_repeats: true },
        series: { best_of: 1 },
        scoring: { win: 1, loss: 0, bye: 1 },
        rank: [
          { kind: 'metric', metric: 'points', direction: 'desc' },
          { kind: 'metric', metric: 'buchholz', direction: 'desc' },
          { kind: 'decision_match' },
        ],
      },
      {
        key: 'cut',
        name: lt('Top cut', 'Top-Cut'),
        participants: { from: 'edges', seeding: 'edge_order' },
        pairing: { kind: 'double_elim', bracket_reset: true },
        series: { best_of: 3 },
        scoring: { win: 1 },
      },
    ],
    edges: [{ key: 'cut_edge', from: 'swiss', to: 'cut', select: [{ kind: 'top_n', n: 8 }], seeding: 'random', gate: 'auto' }],
  };
}

/** Every available primitive at least once (drafts, threshold expressions, modules, views). */
export function kitchenSinkDoc(): Json {
  return {
    schema_version: 1,
    identity: { name: lt('Everything', 'Alles'), summary: lt('Uses each building block.') },
    stages: [
      {
        key: 'groups',
        name: lt('Groups', 'Gruppen'),
        participants: { from: 'roster', seeding: 'manual', expected_count: 16 },
        groups: { count: 4, method: 'random_seeded' },
        pairing: { kind: 'round_robin', legs: 3, mirror_legs: false },
        series: { best_of: 1, allow_draw: true },
        ruleset: { kind: 'ruleset', id: '123e4567-e89b-42d3-a456-426614174000' },
        doubles: true,
        players_per_match: 2,
        scoring: { win: 3, loss: 0, bye: 1, draw: 1, forfeit: -1 },
        rank: [
          { kind: 'metric', metric: 'wins', direction: 'desc' },
          { kind: 'head_to_head', scope: 'pairwise' },
          { kind: 'manual' },
        ],
        columns: ['points', 'wins'],
      },
      {
        key: 'swiss',
        name: lt('Swiss', 'Schweizer System'),
        participants: { from: 'edges', seeding: 'rating' },
        pairing: { kind: 'swiss', rounds: 5, avoid_repeats: false },
        series: { best_of: 3, overrides: [{ round: 2, best_of: 5 }] },
        scoring: { win: 3 },
      },
      {
        key: 'bracket',
        name: lt('Bracket', 'Turnierbaum'),
        participants: { from: 'edges', seeding: 'manual' },
        pairing: { kind: 'double_elim' },
        series: { best_of: 5 },
        scoring: { win: 1 },
      },
      {
        key: 'hand',
        name: lt('By hand', 'Von Hand'),
        participants: { from: 'edges', seeding: 'random' },
        pairing: { kind: 'manual' },
        series: { best_of: 1 },
        scoring: { win: 1 },
        players_per_match: 4,
      },
    ],
    edges: [
      {
        key: 'e_one',
        from: 'groups',
        to: 'swiss',
        select: [
          { kind: 'per_group', n: 3 },
          { kind: 'wildcard', n: 2 },
          { kind: 'bottom_n', n: 1 },
          { kind: 'manual_list', count: 2 },
        ],
        seeding: 'cross_group',
      },
      {
        key: 'e_two',
        from: 'swiss',
        to: 'bracket',
        select: [
          {
            kind: 'threshold',
            when: {
              k: 'and',
              args: [
                { k: 'cmp', op: '>=', a: { k: 'ref', name: 'points', t: 'number' }, b: { k: 'num', v: 6 } },
                { k: 'cmp', op: '>', a: { k: 'ref', name: 'wins', t: 'number' }, b: { k: 'num', v: 1 } },
              ],
            },
          },
        ],
      },
      { key: 'e_three', from: 'bracket', to: 'hand', select: [{ kind: 'manual_list' }] },
    ],
    views: [
      { key: 'overall', label: lt('Overall', 'Gesamt'), stages: ['groups', 'swiss'], metric: 'points', combine: 'sum' },
    ],
    rules: [
      {
        kind: 'rule.custom',
        id: 'sportsmanship',
        text: lt('Be fair.', 'Spielt fair.'),
        scope: { kind: 'stage', stage: 'swiss' },
        verify: 'none',
        when: 'per_match',
        visible_to_players: false,
      },
    ],
    text: {
      sections: [
        { id: 'intro', title: lt('Intro', 'Einleitung'), body: lt('Read this first.', 'Zuerst lesen.'), stage: 'groups' },
      ],
    },
    theme: { world: 'forest' },
    modules: [
      {
        kind: 'module.legacy',
        adapter: 'epb',
        facts: [
          { key: 'budget', label: lt('Budget', 'Budget'), value: 100 },
          { key: 'note', label: lt('Note', 'Hinweis'), value: 'free text' },
          { key: 'strict', label: lt('Strict', 'Streng'), value: true },
        ],
      },
    ],
  };
}

/** A document with an unknown rule kind that degrades to a manual card, and one with its own text. */
export function degradedRulesDoc(): Json {
  const doc = minimalDoc();
  doc.rules = [
    { kind: 'rule.unknown_one', id: 'first' },
    { kind: 'rule.unknown_two', id: 'second', text: lt('Keep me', 'Behalte mich'), extra: { deep: true } },
  ];
  return doc;
}

const ref = (name: string, t: 'number' | 'boolean' | 'text'): Json => ({ k: 'ref', name, t });
const num = (v: number): Json => ({ k: 'num', v });
const cmp = (op: string, a: Json, b: Json): Json => ({ k: 'cmp', op, a, b });

/**
 * A gift exchange: every Phase 3 section and every Phase 3 kind. Players get a house, a secret recipient and picks from
 * a locked list that opens when the stage starts. Defaults are left out, as an author would write it.
 */
export function giftExchangeDoc(): Json {
  return {
    schema_version: 1,
    identity: { name: lt('Gift Exchange', 'Wichtelcup') },
    stages: [
      {
        key: 'main',
        name: lt('Exchange', 'Wichteln'),
        participants: { from: 'roster', seeding: 'signup' },
        pairing: { kind: 'round_robin' },
        series: { best_of: 1 },
        scoring: { win: 3 },
        rank: [
          { kind: 'metric', metric: 'points', direction: 'desc' },
          { kind: 'metric', metric: 'gift_score', direction: 'desc' },
          { kind: 'coin_flip' },
        ],
        columns: ['points', 'gift_score'],
      },
    ],
    attributes: [
      {
        key: 'house',
        label: lt('House', 'Haus'),
        on: 'player',
        type: 'enum',
        values: ['ember', 'tide', 'grove'],
        assign: { kind: 'random_seeded' },
      },
      {
        key: 'level',
        label: lt('Level', 'Stufe'),
        on: 'player',
        type: 'number',
        assign: { kind: 'expr', expr: ref('tunable.base_level', 'number') },
      },
      { key: 'veteran', label: lt('Veteran', 'Veteran'), on: 'player', type: 'bool', assign: { kind: 'manual' } },
      { key: 'nick', label: lt('Nickname', 'Spitzname'), on: 'player', type: 'text' },
      { key: 'role', label: lt('Role', 'Rolle'), on: 'entry', type: 'enum', values: ['attacker', 'support', 'tank'] },
      { key: 'tags', label: lt('Tags', 'Tags'), on: 'entry', type: 'enum', values: ['fast', 'bulky'], multi: true },
      { key: 'bonus', label: lt('Bonus', 'Bonus'), on: 'entry', type: 'number' },
    ],
    domains: [
      {
        key: 'pool',
        label: lt('Gift pool', 'Geschenkepool'),
        initially: 'locked',
        visibility: 'when_unlocked',
        entries: [
          {
            id: 'garchomp',
            attrs: [
              { key: 'role', value: 'attacker' },
              { key: 'tags', value: ['fast', 'bulky'] },
              { key: 'bonus', value: 2 },
            ],
          },
          { id: 'blissey', attrs: [{ key: 'role', value: 'support' }, { key: 'bonus', value: 1 }] },
          { id: 'corviknight', attrs: [{ key: 'role', value: 'tank' }, { key: 'bonus', value: 3 }] },
        ],
      },
    ],
    relations: [
      {
        key: 'santa',
        label: lt('Secret recipient', 'Geheimer Beschenkter'),
        shape: 'derangement',
        reveal_on: { event: 'action_locked', action: 'choose_gift' },
      },
    ],
    resources: [
      { key: 'picks', label: lt('Picks', 'Picks'), holds: { kind: 'domain', domain: 'pool' }, capacity: 2, exclusive: 'global' },
      { key: 'coins', label: lt('Coins', 'Münzen'), holds: { kind: 'counter' }, capacity: 10, visibility: 'all' },
    ],
    metrics: [
      {
        kind: 'metric.define',
        key: 'gift_score',
        label: lt('Gift score', 'Geschenkwertung'),
        of: 'player',
        expr: { k: 'arith', op: '*', a: ref('wins', 'number'), b: ref('tunable.bonus_factor', 'number') },
      },
      {
        kind: 'track.progression',
        key: 'milestones',
        label: lt('Milestones', 'Meilensteine'),
        stage: 'main',
        steps: [
          { label: lt('First win', 'Erster Sieg'), when: ref('won', 'boolean') },
          { label: lt('Round three', 'Runde drei'), when: cmp('>=', ref('round', 'number'), num(3)) },
        ],
      },
      { kind: 'score.placement', key: 'placement_points', label: lt('Placement', 'Platzierung'), stage: 'main', points: [5, 3, 1] },
    ],
    tunables: [
      { key: 'base_level', label: lt('Base level', 'Grundstufe'), type: 'number', default: 1, min: 0, max: 10 },
      { key: 'bonus_factor', label: lt('Bonus factor', 'Bonusfaktor'), type: 'number', default: 2 },
      { key: 'mode', label: lt('Mode', 'Modus'), type: 'enum', default: 'cozy', values: ['cozy', 'fierce'], editable_until: 'lock' },
      { key: 'curve', label: lt('Curve', 'Kurve'), type: 'table', default: [3, 2, 1], status: 'approved' },
      { key: 'open', label: lt('Open', 'Offen'), type: 'bool', default: true, editable_until: 'always' },
    ],
    rules: [
      {
        kind: 'rule.on_event',
        id: 'kickoff',
        on: { event: 'stage_start', stage: 'main' },
        effects: [
          { effect: 'unlock_domain', domain: 'pool' },
          { effect: 'generate_relation', relation: 'santa' },
          { effect: 'grant_resource', resource: 'coins', amount: 3 },
          { effect: 'open_action', action: 'choose_gift' },
          { effect: 'notify', message: lt('The pool is open.', 'Der Pool ist offen.') },
        ],
      },
      {
        kind: 'rule.on_event',
        id: 'midway',
        on: { event: 'round_end', stage: 'main', round: 2 },
        when: cmp('>=', ref('round', 'number'), num(2)),
        effects: [
          {
            effect: 'adjust_points',
            stage: 'main',
            to: { who: 'event_players', where: cmp('>=', ref('wins', 'number'), num(1)) },
            points: 1,
          },
          { effect: 'set_attr', attr: 'veteran', to: { who: 'event_players' }, value: true },
          { effect: 'revoke_resource', resource: 'coins', amount: 1 },
          { effect: 'grant_resource', resource: 'picks', item: 'blissey' },
          { effect: 'reveal_relation', relation: 'santa' },
          { effect: 'lock_action', action: 'choose_gift' },
          { effect: 'lock_domain', domain: 'pool' },
        ],
      },
      {
        kind: 'rule.on_event',
        id: 'deadline',
        on: { event: 'time', mark: 'gift_deadline' },
        effects: [{ effect: 'lock_action', action: 'choose_gift' }],
      },
      {
        kind: 'rule.on_event',
        id: 'after_match',
        on: { event: 'match_completed', stage: 'main' },
        effects: [{ effect: 'notify', message: lt('A match is done.') }],
      },
      {
        kind: 'rule.on_event',
        id: 'wrap_up',
        on: { event: 'stage_end', stage: 'main' },
        effects: [{ effect: 'reveal_relation', relation: 'santa' }],
      },
      {
        kind: 'rule.on_event',
        id: 'new_round',
        on: { event: 'round_start', stage: 'main' },
        effects: [{ effect: 'notify', message: lt('Round starts.') }],
      },
      {
        kind: 'player.action',
        id: 'choose_gift',
        label: lt('Choose a gift', 'Geschenk wählen'),
        via: 'santa',
        window: {
          opens_on: { event: 'stage_start', stage: 'main' },
          closes_on: { event: 'round_start', stage: 'main', round: 2 },
        },
        steps: [
          {
            resource: 'picks',
            domain: 'pool',
            count: 2,
            where: cmp('>=', ref('attr.bonus', 'number'), num(1)),
            distinct_attr: 'role',
          },
        ],
        lock: 'on_close',
      },
      { kind: 'check.assisted', id: 'unresolved', source: { kind: 'unresolved_outcome' } },
      { kind: 'check.assisted', id: 'ties', label: lt('Ties', 'Gleichstände'), source: { kind: 'standings_tie', stage: 'main' } },
      { kind: 'check.assisted', id: 'rematches', source: { kind: 'pairing_rematch' } },
      {
        kind: 'check.assisted',
        id: 'vets',
        source: { kind: 'expr', of: 'player', when: ref('attr.veteran', 'boolean') },
      },
      { kind: 'adjust.manual', id: 'admin_tools', allow: ['points', 'resource', 'relation', 'outcome', 'action', 'domain', 'rank'] },
      { kind: 'rule.custom', id: 'be_kind', text: lt('Be kind.', 'Seid nett.') },
    ],
  };
}

export const VALID_DOCS: ReadonlyArray<{ id: string; build: () => Json }> = [
  { id: 'minimal', build: minimalDoc },
  { id: 'league', build: leagueDoc },
  { id: 'cup', build: cupDoc },
  { id: 'swiss', build: swissDoc },
  { id: 'kitchen-sink', build: kitchenSinkDoc },
  { id: 'degraded-rules', build: degradedRulesDoc },
  { id: 'gift-exchange', build: giftExchangeDoc },
];

/** One valid node per available primitive kind (values are what the validators produce, defaults included). */
export function sampleNodes(): Record<string, unknown> {
  const league = leagueDoc();
  const sink = kitchenSinkDoc();
  const stages = league.stages as Json[];
  const edges = sink.edges as Json[];
  return {
    'stage.define': {
      ...stages[0],
      ruleset: { kind: 'season_default' },
      doubles: false,
      players_per_match: 2,
      scoring: { win: 3, loss: 0, bye: 0 },
      pairing: { kind: 'round_robin', legs: 2, mirror_legs: true },
      series: { best_of: 1, allow_draw: false, overrides: [] },
    },
    'group.form': { count: 4, method: 'serpentine' },
    'pairing.round_robin': { kind: 'round_robin', legs: 2, mirror_legs: true },
    'pairing.swiss': { kind: 'swiss', rounds: 5, avoid_repeats: true },
    'pairing.single_elim': { kind: 'single_elim', third_place: true },
    'pairing.double_elim': { kind: 'double_elim', bracket_reset: false },
    'pairing.manual': { kind: 'manual' },
    'series.rule': { best_of: 3, allow_draw: false, overrides: [{ round: 1, from: 'end', best_of: 5 }] },
    'team.ruleset': { kind: 'season_default' },
    'score.match': { win: 3, loss: 0, bye: 1 },
    'rank.metric': { kind: 'metric', metric: 'points', direction: 'desc' },
    'rank.head_to_head': { kind: 'head_to_head', scope: 'mini_table' },
    'rank.coin_flip': { kind: 'coin_flip' },
    'rank.decision_match': { kind: 'decision_match' },
    'rank.manual': { kind: 'manual' },
    'standings.view': (sink.views as Json[])[0],
    'advance.rule': {
      key: 'to_next',
      from: 'groups',
      to: 'swiss',
      select: [{ kind: 'top_n', n: 4 }, { kind: 'wildcard', n: 2 }],
      seeding: 'rank',
      gate: 'admin_confirm',
    },
    'advance.top_n': { kind: 'top_n', n: 4 },
    'advance.per_group': { kind: 'per_group', n: 2 },
    'advance.wildcard': { kind: 'wildcard', n: 2 },
    'advance.threshold': (edges[1].select as Json[])[0],
    'advance.bottom_n': { kind: 'bottom_n', n: 1 },
    'advance.manual_list': { kind: 'manual_list', count: 2 },
    'rule.custom': {
      kind: 'rule.custom',
      id: 'fair_play',
      text: lt('Be kind to each other.', 'Seid nett zueinander.'),
      scope: { kind: 'season' },
      verify: 'admin_checklist',
      when: 'once',
      visible_to_players: true,
    },
    'text.rules': (sink.text as { sections: Json[] }).sections[0],
    'theme.hint': { world: 'forest' },
    'module.legacy': (sink.modules as Json[])[0],
    'attr.define': {
      key: 'house',
      label: lt('House', 'Haus'),
      on: 'player',
      type: 'enum',
      values: ['ember', 'tide'],
      assign: { kind: 'random_seeded' },
    },
    'attr.assign': { kind: 'expr', expr: ref('tunable.base_level', 'number') },
    'domain.define': {
      key: 'pool',
      label: lt('Gift pool', 'Geschenkepool'),
      entries: [
        { id: 'garchomp', attrs: [{ key: 'role', value: 'attacker' }, { key: 'tags', value: ['fast'] }] },
        { id: 'blissey', attrs: [] },
      ],
      initially: 'locked',
      visibility: 'when_unlocked',
    },
    'relation.define': {
      key: 'santa',
      label: lt('Secret recipient', 'Geheimer Beschenkter'),
      shape: 'derangement',
      visibility: { from: 'hidden', to: 'own' },
      reveal_on: { event: 'round_end', stage: 'main', round: 2 },
    },
    'resource.define': {
      key: 'picks',
      label: lt('Picks', 'Picks'),
      holds: { kind: 'domain', domain: 'pool' },
      capacity: 2,
      visibility: 'own',
      exclusive: 'global',
    },
    'metric.define': {
      kind: 'metric.define',
      key: 'gift_score',
      label: lt('Gift score', 'Geschenkwertung'),
      of: 'player',
      expr: { k: 'arith', op: '*', a: ref('wins', 'number'), b: num(2) },
    },
    'rule.on_event': {
      kind: 'rule.on_event',
      id: 'kickoff',
      on: { event: 'stage_start', stage: 'main' },
      when: cmp('>=', ref('round', 'number'), num(0)),
      effects: [
        { effect: 'unlock_domain', domain: 'pool' },
        { effect: 'grant_resource', resource: 'coins', to: { who: 'all' }, amount: 3 },
      ],
    },
    'effect.apply': { effect: 'grant_resource', resource: 'coins', to: { who: 'event_players' }, amount: 2 },
    'player.action': {
      kind: 'player.action',
      id: 'choose_gift',
      label: lt('Choose a gift', 'Geschenk wählen'),
      via: 'santa',
      window: { opens_on: { event: 'stage_start', stage: 'main' } },
      steps: [{ resource: 'picks', domain: 'pool', count: 2, distinct_attr: 'role' }],
      review: true,
      lock: 'on_submit',
    },
    'track.progression': {
      kind: 'track.progression',
      key: 'milestones',
      label: lt('Milestones', 'Meilensteine'),
      stage: 'main',
      steps: [{ label: lt('First win', 'Erster Sieg'), when: ref('won', 'boolean') }],
    },
    'score.placement': {
      kind: 'score.placement',
      key: 'placement_points',
      label: lt('Placement', 'Platzierung'),
      stage: 'main',
      points: [5, 3, 1],
    },
    'check.assisted': { kind: 'check.assisted', id: 'ties', label: lt('Ties', 'Gleichstände'), source: { kind: 'standings_tie', stage: 'main' } },
    'adjust.manual': { kind: 'adjust.manual', id: 'admin_tools', allow: ['points', 'resource'] },
  };
}
