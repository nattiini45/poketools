/**
 * `AdminMatchActions` renders its chrome from the `admin-core` namespace
 * (T08, i18n-core §11.3): English verbatim by default, German under
 * `locale: 'de'`. Rendered with `renderToStaticMarkup` (vitest 'node' env).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import type { GameSummary } from '@/types/match';
import AdminMatchActions, {
  DeleteGameImpactNotice,
  ResetImpact,
  deleteGameImpact,
  errorNeedsRefresh,
} from '../AdminMatchActions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const P1 = { id: 'p1', name: 'Ash' };
const P2 = { id: 'p2', name: 'Gary' };

function game(n: number, winner: string | null): GameSummary {
  return {
    id: `g${n}`,
    game_number: n,
    winner_id: winner,
    replay_url: `https://replay.pokemonshowdown.com/x-${n}`,
    source: 'ps_replay',
    stats_locked: false,
  };
}

function ui(status: 'in_progress' | 'completed', backSuffix?: string) {
  return (
    <AdminMatchActions
      matchId="m1"
      currentStatus={status}
      player1={P1}
      player2={P2}
      currentWinnerId={null}
      games={[game(1, 'p1'), game(2, null)]}
      tournamentId="t1"
      bestOf={3}
      isSiteAdmin
      backSuffix={backSuffix}
    />
  );
}

describe('AdminMatchActions i18n', () => {
  it('renders the English chrome verbatim without a provider', () => {
    const html = renderToStaticMarkup(ui('in_progress'));
    expect(html).toContain('Reset / Manage Games');
    expect(html).toContain('Game 1');
    expect(html).toContain('Winner: Ash');
    expect(html).toContain('Admin Override');
    expect(html).toContain('Reason for override...');
    expect(html).toContain('Mark Disputed');
  });

  it('renders German in a de provider', () => {
    const html = renderWithI18n(ui('in_progress'), { locale: 'de' });
    expect(html).toContain('Zurücksetzen / Partien verwalten');
    expect(html).toContain('Partie 1');
    expect(html).toContain('Sieger: Ash');
    expect(html).toContain('Admin-Eingriff');
    expect(html).toContain('Als strittig markieren');
    expect(html).not.toContain('Reset Match');
  });

  it('shows the recorded tally and tags the player the games favour', () => {
    const html = renderToStaticMarkup(ui('in_progress'));
    expect(html).toContain('Recorded games');
    expect(html).toContain('Ash 1 – 0 Gary from 2 games');
    expect(html).toContain('Best of 3: first to 2');
    expect(html).toContain('leads on games');
  });

  it('shows the tally in German', () => {
    const html = renderWithI18n(ui('in_progress'), { locale: 'de' });
    expect(html).toContain('Eingetragene Partien');
    expect(html).toContain('Ash 1 – 0 Gary aus 2 Partien');
    expect(html).toContain('führt nach Partien');
  });

  it('completed matches show only the reset hint, in German', () => {
    const html = renderWithI18n(ui('completed'), { locale: 'de' });
    expect(html).toContain('Admin-Aktionen');
    expect(html).toContain('Dieses Spiel ist abgeschlossen.');
    expect(html).not.toContain('Sieger festlegen');
  });

  it('offers one reset button: in the Admin Actions card for a completed match, in the games card otherwise', () => {
    const count = (html: string) => html.split('Reset Match').length - 1;
    const completed = renderToStaticMarkup(ui('completed'));
    expect(count(completed)).toBe(1);
    // The games card keeps the per-game actions, the single reset sits under the Admin Actions heading.
    expect(completed).toContain('Reset / Manage Games');
    expect(completed).toContain('href="/admin/matches/m1/games/g1/edit"');
    expect(completed.indexOf('Reset Match')).toBeGreaterThan(completed.indexOf('Admin Actions'));
    expect(count(renderToStaticMarkup(ui('in_progress')))).toBe(1);
  });

  it('keeps the list query on the game edit links', () => {
    const suffix = `?back=${encodeURIComponent('status=disputed')}`;
    expect(renderToStaticMarkup(ui('in_progress', suffix))).toContain(`href="/admin/matches/m1/games/g1/edit${suffix}"`);
    expect(renderToStaticMarkup(ui('in_progress'))).toContain('href="/admin/matches/m1/games/g1/edit"');
  });
});

describe('deleteGameImpact', () => {
  const games = (...winners: (string | null)[]) => winners.map((winner, i) => game(i + 1, winner));

  it('Bo1: deleting the only game leaves a scheduled match', () => {
    expect(deleteGameImpact(games('p1'), 'g1', 'p1', 'p2', 1)).toEqual({
      remainingGames: 0,
      nextStatus: 'scheduled',
    });
  });

  it('Bo3: a series at 2-0 loses a game and is back in progress; at 2-1 it is still decided', () => {
    expect(deleteGameImpact(games('p1', 'p1'), 'g2', 'p1', 'p2', 3)).toEqual({
      remainingGames: 1,
      nextStatus: 'in_progress',
    });
    expect(deleteGameImpact(games('p1', 'p2', 'p1'), 'g2', 'p1', 'p2', 3)).toEqual({
      remainingGames: 2,
      nextStatus: 'pending_confirmation',
    });
  });

  it('Bo5: three wins decide the series, two do not', () => {
    const series = games('p2', 'p1', 'p1', 'p1', 'p2');
    expect(deleteGameImpact(series, 'g1', 'p1', 'p2', 5)).toMatchObject({ remainingGames: 4, nextStatus: 'pending_confirmation' });
    expect(deleteGameImpact(series, 'g2', 'p1', 'p2', 5)).toMatchObject({ remainingGames: 4, nextStatus: 'in_progress' });
  });

  it('ignores games without a winner when counting wins', () => {
    expect(deleteGameImpact(games('p1', null, 'p1'), 'g2', 'p1', 'p2', 3).nextStatus).toBe('pending_confirmation');
    expect(deleteGameImpact(games('p1', null, null), 'g3', 'p1', 'p2', 3).nextStatus).toBe('in_progress');
  });
});

describe('errorNeedsRefresh', () => {
  it('reloads at once only after the match changed under the admin', () => {
    expect(errorNeedsRefresh('match_state_changed')).toBe(true);
    expect(errorNeedsRefresh('match_reopen_incomplete')).toBe(true);
    expect(errorNeedsRefresh('match_complete_no_winner')).toBe(false);
    expect(errorNeedsRefresh(undefined)).toBe(false);
    expect(errorNeedsRefresh(null)).toBe(false);
  });
});

describe('reset and delete impact text', () => {
  const preview = {
    games_to_delete: 2,
    was_completed: true,
    downstream: [
      { id: 'm2', player_1_name: 'Ash', player_2_name: 'Gary', status: 'completed' as const, round_name: 'Finals' },
    ],
  };

  it('lists games, the rating rebuild and the later matches in English', () => {
    const html = renderWithI18n(<ResetImpact state={{ status: 'ready', preview }} />);
    expect(html).toContain('2 games and their stats will be deleted.');
    expect(html).toContain('Ratings, streaks and signatures of both players are rebuilt.');
    expect(html).toContain('Ash vs Gary (Finals, Completed)');
  });

  it('words the reset impact in German', () => {
    const html = renderWithI18n(<ResetImpact state={{ status: 'ready', preview }} />, { locale: 'de' });
    expect(html).toContain('2 Partien und ihre Statistiken werden gelöscht.');
    expect(html).toContain('Ratings, Serien und Signaturen beider Spieler werden neu berechnet.');
    expect(html).toContain('Ash vs Gary (Finals, Beendet)');
  });

  it('a scheduled match has no rebuild line; loading and failed read states have their own notices', () => {
    const scheduled = renderWithI18n(
      <ResetImpact state={{ status: 'ready', preview: { games_to_delete: 0, was_completed: false, downstream: [] } }} />,
    );
    expect(scheduled).not.toContain('rebuilt');
    expect(renderWithI18n(<ResetImpact state={{ status: 'loading' }} />)).toContain('Checking what this will change');
    expect(renderWithI18n(<ResetImpact state={{ status: 'failed' }} />, { locale: 'de' })).toContain(
      'konnte nicht geprüft werden',
    );
  });

  it('words the delete impact for a completed match in English and German', () => {
    const impact = { remainingGames: 1, nextStatus: 'in_progress' as const };
    const en = renderWithI18n(<DeleteGameImpactNotice impact={impact} ratingsRebuilt />);
    expect(en).toContain('1 game remains afterwards.');
    expect(en).toContain('The match stays in progress.');
    expect(en).toContain('Ratings, streaks and signatures');

    const de = renderWithI18n(<DeleteGameImpactNotice impact={{ remainingGames: 0, nextStatus: 'scheduled' }} ratingsRebuilt={false} />, {
      locale: 'de',
    });
    expect(de).toContain('Danach bleiben 0 Partien übrig.');
    expect(de).toContain('geht das Spiel zurück auf „Angesetzt“');
    expect(de).not.toContain('Ratings');
  });
});
