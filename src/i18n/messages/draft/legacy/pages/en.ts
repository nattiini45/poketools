/**
 * `draft/legacy/pages` (owner DL-UI-1, draft-frontend §8.5): the server pages
 * `/leagues/[id]/point-buy` and `/leagues/[id]/matchup`. `en` is verbatim.
 */
export default {
  pointBuy: {
    notEpb: 'This league does not use the Evolution Point Buy format.',
  },
  matchup: {
    notAvailable: 'Matchup analysis is not available for this league format.',
    title: '{league} — Matchup Analysis',
    intro: 'Compare rosters, type matchups, and team roles.',
    introEpb: 'Compare rosters, type matchups, and team roles. Uses current evolution stages.',
    unsupported: {
      one: 'Full roster matchup comparison is currently supported for Evolution Point Buy leagues. Team role data ({count} entry) is imported and ready when this format is enabled.',
      other:
        'Full roster matchup comparison is currently supported for Evolution Point Buy leagues. Team role data ({count} entries) is imported and ready when this format is enabled.',
    },
  },
} as const;
