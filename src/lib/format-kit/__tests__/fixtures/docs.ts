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

export const VALID_DOCS: ReadonlyArray<{ id: string; build: () => Json }> = [
  { id: 'minimal', build: minimalDoc },
  { id: 'league', build: leagueDoc },
  { id: 'cup', build: cupDoc },
  { id: 'swiss', build: swissDoc },
  { id: 'kitchen-sink', build: kitchenSinkDoc },
  { id: 'degraded-rules', build: degradedRulesDoc },
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
  };
}
