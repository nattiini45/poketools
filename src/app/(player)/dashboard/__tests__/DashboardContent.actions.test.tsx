/**
 * The dashboard's "Now" card: which result action each of the viewer's matches offers (match machine,
 * docs/state-machines.md).
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { MatchWithPlayers } from '@/types/match';
import type { Player } from '@/types/player';
import DashboardContent from '../DashboardContent';

function match(status: string, extra: Partial<MatchWithPlayers> = {}): MatchWithPlayers {
  return {
    id: 'm1',
    tournament_id: 't1',
    status,
    round_status: 'active',
    player_1_id: 'p1',
    player_2_id: 'p2',
    player_1_name: 'Misty',
    player_2_name: 'Ash',
    winner_id: null,
    submitter_id: null,
    scheduled_at: null,
    ...extra,
  } as unknown as MatchWithPlayers;
}

function render(m: MatchWithPlayers, player: Partial<Player> | null = null): string {
  return renderWithI18n(
    <DashboardContent
      playerId="p1"
      playerName="Misty"
      initialPlayer={player as Player | null}
      initialMatches={[m]}
      initialTournaments={[]}
      playerRating={null}
      playerStreaks={null}
      leagueStandings={[]}
      teamsUsed={[]}
    />,
    { locale: 'en', timeZone: 'UTC' },
  );
}

const SUBMIT = '/dashboard/submit/m1';
const CONFIRM = '/dashboard/confirm/m1';

describe('DashboardContent: result actions', () => {
  it.each(['scheduled', 'in_progress'])('%s in a live round: submit a result', (status) => {
    const html = render(match(status));
    expect(html).toContain(SUBMIT);
    expect(html).not.toContain(CONFIRM);
  });

  it('a scheduled match of an upcoming round: no submit', () => {
    const html = render(match('scheduled', { round_status: 'pending' } as Partial<MatchWithPlayers>));
    expect(html).not.toContain(SUBMIT);
  });

  it("pending confirmation of the opponent's result: confirm it", () => {
    const html = render(match('pending_confirmation', { winner_id: 'p2', submitter_id: 'p2' }));
    expect(html).toContain(CONFIRM);
    expect(html).not.toContain(SUBMIT);
  });

  it('pending confirmation of the viewer\'s own result: no confirm call to action (the confirm page refuses it)', () => {
    const html = render(match('pending_confirmation', { winner_id: 'p1', submitter_id: 'p1' }));
    expect(html).not.toContain(CONFIRM);
  });

  it('pending confirmation of an admin\'s own result: they may confirm it', () => {
    const html = render(match('pending_confirmation', { winner_id: 'p1', submitter_id: 'p1' }), { is_admin: true });
    expect(html).toContain(CONFIRM);
  });

  it.each(['completed', 'disputed'])('%s: no result action', (status) => {
    const html = render(match(status));
    expect(html).not.toContain(SUBMIT);
    expect(html).not.toContain(CONFIRM);
  });
});
