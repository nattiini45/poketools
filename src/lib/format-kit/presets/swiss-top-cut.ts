/**
 * Preset: Swiss with a top cut. The number of Swiss rounds follows the field size; the best eight play a
 * single-elimination cut with a third-place match.
 */
import { ltext } from '@/lib/studio-core/ltext';
import type { FormatDefinition } from '../types';

export const swissTopCut: FormatDefinition = {
  schema_version: 1,
  identity: {
    name: ltext('en', 'Swiss with top cut', 'Schweizer System mit Top-Cut'),
    summary: ltext(
      'en',
      'Swiss rounds for everyone, then a knockout for the best eight.',
      'Schweizer Runden für alle, danach eine K.-o.-Runde für die besten acht.',
    ),
  },
  stages: [
    {
      key: 'swiss',
      name: ltext('en', 'Swiss rounds', 'Schweizer Runden'),
      participants: { from: 'roster', seeding: 'random' },
      pairing: { kind: 'swiss', rounds: 'auto', avoid_repeats: true },
      series: { best_of: 1, allow_draw: false, overrides: [] },
      ruleset: { kind: 'season_default' },
      doubles: false,
      players_per_match: 2,
      scoring: { win: 1, loss: 0, bye: 1 },
      rank: [
        { kind: 'metric', metric: 'points', direction: 'desc' },
        { kind: 'metric', metric: 'buchholz', direction: 'desc' },
        { kind: 'metric', metric: 'wins', direction: 'desc' },
        { kind: 'coin_flip' },
      ],
      columns: ['points', 'wins', 'losses', 'buchholz'],
    },
    {
      key: 'cut',
      name: ltext('en', 'Top cut', 'Top-Cut'),
      participants: { from: 'edges', seeding: 'edge_order' },
      pairing: { kind: 'single_elim', third_place: true },
      series: { best_of: 3, allow_draw: false, overrides: [] },
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
      key: 'to_cut',
      from: 'swiss',
      to: 'cut',
      select: [{ kind: 'top_n', n: 8 }],
      seeding: 'rank',
      gate: 'admin_confirm',
    },
  ],
  views: [],
  rules: [],
  text: {
    sections: [
      {
        id: 'overview',
        title: ltext('en', 'How the tournament works', 'So funktioniert das Turnier'),
        body: ltext(
          'en',
          'Everyone plays the Swiss rounds. The best eight continue in the top cut.',
          'Alle spielen die Schweizer Runden. Die besten acht spielen im Top-Cut weiter.',
        ),
      },
    ],
  },
  theme: { world: 'auto' },
  modules: [],
};
