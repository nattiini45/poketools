/**
 * `AdminMatchActions` renders its chrome from the `admin-core` namespace
 * (T08, i18n-core §11.3): English verbatim by default, German under
 * `locale: 'de'`. Rendered with `renderToStaticMarkup` (vitest 'node' env).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import type { GameSummary } from '@/types/match';
import AdminMatchActions from '../AdminMatchActions';

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

function ui(status: 'in_progress' | 'completed') {
  return (
    <AdminMatchActions
      matchId="m1"
      currentStatus={status}
      player1={P1}
      player2={P2}
      currentWinnerId={null}
      games={[game(1, 'p1'), game(2, null)]}
      tournamentId="t1"
      isSiteAdmin
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

  it('completed matches show only the reset hint, in German', () => {
    const html = renderWithI18n(ui('completed'), { locale: 'de' });
    expect(html).toContain('Admin-Aktionen');
    expect(html).toContain('Dieses Spiel ist abgeschlossen.');
    expect(html).not.toContain('Sieger festlegen');
  });
});
