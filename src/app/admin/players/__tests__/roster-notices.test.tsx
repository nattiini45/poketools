/**
 * The roster's notices and status cell, rendered through react-dom/server (vitest 'node' env):
 * a failed row action stays apart from the roster and says which player it was for, a failed
 * load offers Retry, and the status column explains a ban.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import { RosterActionAlert, RosterLoadError, type RosterActionNotice } from '../RosterNotices';
import { RosterStatusCell } from '../RosterStatusCell';

const matchHistory: RosterActionNotice = {
  kind: 'action',
  name: 'Misty',
  error: {
    api: {
      error: 'Cannot delete a player with match history (12 matches)',
      code: 'player_has_match_history',
      params: { count: 12 },
    },
  },
};
const noop = () => {};

describe('RosterActionAlert', () => {
  it('English: an alert naming the player, the match-history reason and a Dismiss button', () => {
    const html = renderWithI18n(<RosterActionAlert notice={matchHistory} onDismiss={noop} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('Action failed for Misty: ');
    expect(html).toContain('Cannot delete a player with match history (12 matches)');
    expect(html).toContain('aria-label="Dismiss"');
    expect(html).toContain('>Dismiss</button>');
  });

  it('German: the reason comes from the players error catalog with the count', () => {
    const html = renderWithI18n(<RosterActionAlert notice={matchHistory} onDismiss={noop} />, { locale: 'de' });

    expect(html).toContain('role="alert"');
    expect(html).toContain('Aktion für Misty fehlgeschlagen: ');
    expect(html).toContain('Ein Spieler mit Spielhistorie (12 Spiele) lässt sich nicht löschen.');
    expect(html).toContain('aria-label="Schließen"');
    expect(html).not.toContain('Cannot delete');
  });

  it('English without the server text: the catalog message', () => {
    const notice: RosterActionNotice = {
      ...matchHistory,
      error: { api: { code: 'player_has_match_history', params: { count: 12 } } },
    };
    const html = renderWithI18n(<RosterActionAlert notice={notice} onDismiss={noop} />);

    expect(html).toContain('Cannot delete a player with match history (12 matches). Suspend or ban them instead.');
  });

  it('an add failure says which player could not be added', () => {
    const notice: RosterActionNotice = {
      kind: 'add',
      name: 'Brock',
      error: { api: { error: 'Discord ID already registered', code: 'discord_id_taken' } },
    };

    expect(renderWithI18n(<RosterActionAlert notice={notice} onDismiss={noop} />)).toContain(
      'Could not add Brock: Discord ID already registered',
    );
    expect(renderWithI18n(<RosterActionAlert notice={notice} onDismiss={noop} />, { locale: 'de' })).toContain(
      'Brock konnte nicht hinzugefügt werden: ',
    );
  });

  it('a network failure uses the local message in the viewer language', () => {
    const notice: RosterActionNotice = { kind: 'action', name: 'Misty', error: { local: 'actionFailed' } };

    expect(renderWithI18n(<RosterActionAlert notice={notice} onDismiss={noop} />)).toContain(
      'Action failed for Misty: The action could not be completed',
    );
    expect(renderWithI18n(<RosterActionAlert notice={notice} onDismiss={noop} />, { locale: 'de' })).toContain(
      'Aktion für Misty fehlgeschlagen: Die Aktion konnte nicht ausgeführt werden',
    );
  });
});

describe('RosterLoadError', () => {
  it('English: the reason and a Retry button', () => {
    const html = renderWithI18n(<RosterLoadError error={{ local: 'loadFailed' }} onRetry={noop} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('Failed to load players');
    expect(html).toContain('>Retry</button>');
  });

  it('German', () => {
    const html = renderWithI18n(<RosterLoadError error={{ local: 'loadFailed' }} onRetry={noop} />, { locale: 'de' });

    expect(html).toContain('>Erneut versuchen</button>');
    expect(html).not.toContain('>Retry<');
  });
});

describe('RosterStatusCell', () => {
  const base = { status: 'active' as const, suspended_until: null, ban_reason: null };

  it('shows the ban reason of a banned player with the full text in the title', () => {
    const reason = 'Repeated harassment of opponents in match chat and on the league Discord server';
    const html = renderWithI18n(<RosterStatusCell player={{ ...base, status: 'banned', ban_reason: reason }} />);

    expect(html).toContain('Banned');
    expect(html).toContain(`title="Reason: ${reason}"`);
    expect(html).toContain('line-clamp-2');
  });

  it('German ban reason line', () => {
    const html = renderWithI18n(<RosterStatusCell player={{ ...base, status: 'banned', ban_reason: 'Cheating' }} />, {
      locale: 'de',
    });

    expect(html).toContain('Grund: Cheating');
  });

  it('shows the end of a suspension and no reason line', () => {
    const html = renderWithI18n(
      <RosterStatusCell
        player={{ ...base, status: 'suspended', suspended_until: '2099-01-15T14:30:00.000Z', ban_reason: 'old' }}
      />,
    );

    expect(html).toContain('Suspended');
    expect(html).toContain('until');
    expect(html).toContain('<time dateTime="2099-01-15T14:30:00.000Z"');
    expect(html).not.toContain('Reason');
  });

  it('an active player gets the badge and nothing else', () => {
    const html = renderToStaticMarkup(<RosterStatusCell player={base} />);

    expect(html).toContain('Active');
    expect(html).not.toContain('Reason');
    expect(html).not.toContain('<time');
    expect(html).not.toContain('title=');
  });

  it('a banned player without a reason gets no reason line', () => {
    const html = renderToStaticMarkup(<RosterStatusCell player={{ ...base, status: 'banned' }} />);

    expect(html).toContain('Banned');
    expect(html).not.toContain('Reason');
  });
});
