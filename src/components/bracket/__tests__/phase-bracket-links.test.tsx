/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { PublicMatch } from '@/lib/match/public-match';
import { withI18n } from '@/test/i18n';
import type { PhaseRound } from '@/types/league-phase';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';
import ElimBracketView from '../ElimBracketView';

vi.mock('@/lib/supabase/client', () => ({
  get supabase(): never {
    throw new Error('bracket render must not reach Supabase');
  },
}));

const stamp = '2026-01-01T00:00:00Z';
const round: PhaseRound = {
  id: 'phase-round',
  phase_id: 'playoffs',
  name: 'Round 1',
  round_number: 1,
  best_of: 3,
  status: 'active',
  pairings_generated: true,
  deadline: null,
  bracket_side: 'winners',
  bye_player_ids: [],
  created_at: stamp,
  updated_at: stamp,
};

const match: Pick<PhaseMatchWithPlayers, 'phase_id' | Exclude<keyof PublicMatch, 'tournament_id'>> = {
  id: 'phase-match',
  phase_id: round.phase_id,
  round_id: round.id,
  player_1_id: 'seed-one',
  player_2_id: 'seed-two',
  winner_id: null,
  status: 'scheduled',
  date_played: null,
  scheduled_at: null,
  social_image_url: null,
  bracket_side: 'winners',
  bracket_pos: 0,
  created_at: stamp,
  updated_at: stamp,
  player_1_name: 'Aster',
  player_2_name: 'Birch',
  player_1_avatar_url: null,
  player_2_avatar_url: null,
  winner_name: null,
  round_status: 'active',
  games: [],
};

it.each(['single_elim', 'double_elim'] as const)('links a native %s match from the bracket', async (bracketType) => {
  const { container } = render(withI18n(
    <ElimBracketView
      bracketType={bracketType}
      matchHrefPrefix="/leagues/fixture-league/phases/playoffs/matches"
      rounds={[round]}
      matches={[match]}
      participants={[
        { id: match.player_1_id, seed: 1, starting_bracket: 'winners' },
        { id: match.player_2_id, seed: 2, starting_bracket: 'winners' },
      ]}
      matchRecords={[]}
    />,
  ));
  const destination = vi.fn();
  container.addEventListener('click', (event) => {
    event.preventDefault();
    if (event.target instanceof Element) {
      destination(event.target.closest('a')?.getAttribute('href'));
    }
  });

  expect(round).not.toHaveProperty('tournament_id');
  expect(match).not.toHaveProperty('tournament_id');
  await userEvent.setup().click(screen.getByRole('link', { name: /Aster.*Birch/ }));
  expect(destination).toHaveBeenCalledExactlyOnceWith('/leagues/fixture-league/phases/playoffs/matches/phase-match');
});
