/**
 * Preset: a cup. Four groups play a single round robin, the best two of each group advance to an
 * eight-player knockout bracket; the final is a best of five.
 */
import { ltext } from '@/lib/studio-core/ltext';
import type { FormatDefinition } from '../types';

export const cup: FormatDefinition = {
  schema_version: 1,
  identity: {
    name: ltext('en', 'Cup', 'Pokal'),
    summary: ltext('en', 'Group stage, then a knockout bracket.', 'Gruppenphase, danach ein K.-o.-Turnier für die Gruppenbesten.'),
  },
  stages: [
    {
      key: 'groups',
      name: ltext('en', 'Group stage', 'Gruppenphase'),
      participants: { from: 'roster', seeding: 'rating' },
      groups: { count: 4, method: 'serpentine' },
      pairing: { kind: 'round_robin', legs: 1, mirror_legs: true },
      series: { best_of: 1, allow_draw: false, overrides: [] },
      ruleset: { kind: 'season_default' },
      doubles: false,
      players_per_match: 2,
      scoring: { win: 3, loss: 0, bye: 0 },
      rank: [
        { kind: 'metric', metric: 'points', direction: 'desc' },
        { kind: 'head_to_head', scope: 'pairwise' },
        { kind: 'metric', metric: 'wins', direction: 'desc' },
        { kind: 'coin_flip' },
      ],
      columns: ['points', 'wins', 'losses'],
    },
    {
      key: 'knockout',
      name: ltext('en', 'Knockout', 'K.-o.-Runde'),
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
      key: 'to_knockout',
      from: 'groups',
      to: 'knockout',
      select: [{ kind: 'per_group', n: 2 }],
      seeding: 'cross_group',
      gate: 'admin_confirm',
    },
  ],
  views: [],
  rules: [],
  text: {
    sections: [
      {
        id: 'overview',
        title: ltext('en', 'How the cup works', 'So funktioniert der Pokal'),
        body: ltext(
          'en',
          'Four groups play one round robin each. The best two of every group reach the knockout bracket.',
          'Vier Gruppen spielen je eine Runde jeder gegen jeden. Die besten zwei jeder Gruppe erreichen das K.-o.-Turnier.',
        ),
      },
    ],
  },
  theme: { world: 'auto' },
  modules: [],
};
