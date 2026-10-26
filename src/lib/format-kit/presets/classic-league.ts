/**
 * Preset: a classic league. A double round robin ranks the table, the top four meet in a best-of-three
 * knockout and the final is a best of five.
 */
import { ltext } from '@/lib/studio-core/ltext';
import type { FormatDefinition } from '../types';

export const classicLeague: FormatDefinition = {
  schema_version: 1,
  identity: {
    name: ltext('en', 'Classic league', 'Klassische Liga'),
    summary: ltext(
      'en',
      'A double round robin, then a knockout for the top four.',
      'Eine doppelte Runde jeder gegen jeden, danach eine K.-o.-Runde für die besten vier.',
    ),
  },
  stages: [
    {
      key: 'league',
      name: ltext('en', 'League phase', 'Ligaphase'),
      participants: { from: 'roster', seeding: 'signup' },
      pairing: { kind: 'round_robin', legs: 2, mirror_legs: true },
      series: { best_of: 1, allow_draw: false, overrides: [] },
      ruleset: { kind: 'season_default' },
      doubles: false,
      players_per_match: 2,
      scoring: { win: 3, loss: 0, bye: 0 },
      rank: [
        { kind: 'metric', metric: 'points', direction: 'desc' },
        { kind: 'head_to_head', scope: 'mini_table' },
        { kind: 'metric', metric: 'kill_differential', direction: 'desc' },
        { kind: 'metric', metric: 'wins', direction: 'desc' },
        { kind: 'coin_flip' },
      ],
      columns: ['points', 'wins', 'losses', 'kill_differential'],
    },
    {
      key: 'playoffs',
      name: ltext('en', 'Playoffs', 'Playoffs'),
      participants: { from: 'edges', seeding: 'edge_order' },
      pairing: { kind: 'single_elim', third_place: false },
      series: { best_of: 3, allow_draw: false, overrides: [{ round: 1, from: 'end', best_of: 5 }] },
      ruleset: { kind: 'season_default' },
      doubles: false,
      players_per_match: 2,
      scoring: { win: 1, loss: 0, bye: 0 },
      rank: [],
      columns: [],
    },
  ],
  edges: [
    {
      key: 'to_playoffs',
      from: 'league',
      to: 'playoffs',
      select: [{ kind: 'top_n', n: 4 }],
      seeding: 'rank',
      gate: 'admin_confirm',
    },
  ],
  views: [],
  rules: [
    {
      kind: 'rule.custom',
      id: 'fair_play',
      text: ltext(
        'en',
        'Players agree on a match date within the week of the round.',
        'Die Spieler vereinbaren innerhalb der Rundenwoche einen Termin für ihr Match.',
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
        title: ltext('en', 'How this league works', 'So funktioniert diese Liga'),
        body: ltext(
          'en',
          'Everyone plays everyone twice. The top four of the table continue in the playoffs.',
          'Jeder spielt zweimal gegen jeden. Die besten vier der Tabelle spielen in den Playoffs weiter.',
        ),
      },
    ],
  },
  theme: { world: 'auto' },
  modules: [],
};
