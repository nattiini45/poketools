/**
 * Which admin match actions show for each match status (match machine, docs/state-machines.md). Rendered with
 * `renderToStaticMarkup` (vitest 'node' env).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameSummary, MatchStatus } from '@/types/match';
import AdminMatchActions from '../AdminMatchActions';
import { buttonsIn } from '@/test/button-markup';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function game(n: number): GameSummary {
  return {
    id: `g${n}`,
    game_number: n,
    winner_id: 'p1',
    replay_url: `https://replay.pokemonshowdown.com/x-${n}`,
    source: 'ps_replay',
    stats_locked: false,
  };
}

function render(status: MatchStatus, games: GameSummary[]): string {
  return renderToStaticMarkup(
    <AdminMatchActions
      matchId="m1"
      currentStatus={status}
      player1={{ id: 'p1', name: 'Ash' }}
      player2={{ id: 'p2', name: 'Gary' }}
      currentWinnerId={null}
      games={games}
      tournamentId="t1"
      bestOf={3}
      isSiteAdmin
    />,
  );
}

function shown(html: string) {
  return {
    manageGames: html.includes('Reset / Manage Games'),
    resetButtons: buttonsIn(html).filter((button) => button.label === 'Reset Match').length,
    override: html.includes('Admin Override'),
    complete: html.includes('Complete Match'),
    markDisputed: html.includes('Mark Disputed'),
    settle: html.includes('Record result'),
    completedCard: html.includes('Admin Actions'),
  };
}

describe('AdminMatchActions: the actions offered per status', () => {
  it('scheduled: only the direct result', () => {
    expect(shown(render('scheduled', []))).toEqual({
      manageGames: false,
      resetButtons: 0,
      override: false,
      complete: false,
      markDisputed: false,
      settle: true,
      completedCard: false,
    });
  });

  it.each(['in_progress', 'pending_confirmation'] as const)('%s: games, reset, complete and dispute', (status) => {
    expect(shown(render(status, [game(1)]))).toEqual({
      manageGames: true,
      resetButtons: 1,
      override: true,
      complete: true,
      markDisputed: true,
      settle: false,
      completedCard: false,
    });
  });

  it('disputed: games, reset and complete, no second dispute', () => {
    expect(shown(render('disputed', [game(1)]))).toEqual({
      manageGames: true,
      resetButtons: 1,
      override: true,
      complete: true,
      markDisputed: false,
      settle: false,
      completedCard: false,
    });
  });

  it('completed with games: the games and the completed card with its reset', () => {
    expect(shown(render('completed', [game(1), game(2)]))).toEqual({
      manageGames: true,
      resetButtons: 1,
      override: false,
      complete: false,
      markDisputed: false,
      settle: false,
      completedCard: true,
    });
  });

  it('completed without games: only the completed card with its reset', () => {
    expect(shown(render('completed', []))).toEqual({
      manageGames: false,
      resetButtons: 1,
      override: false,
      complete: false,
      markDisputed: false,
      settle: false,
      completedCard: true,
    });
  });
});
