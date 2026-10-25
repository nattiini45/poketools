/**
 * The sections of `/admin/matches/[id]` (context header, schedule, dispute,
 * history, reopen) in English and German. Rendered with `renderToStaticMarkup`
 * (vitest 'node' env): effects and the post-hydration state do not run, so the
 * schedule field's own logic is covered through its exported helpers.
 */
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { AdminMatchContext, MatchHistoryEntry, MatchHistoryPage } from '@/lib/admin/match-detail';
import MatchContextHeader, { isDefaultRoundName } from '../MatchContextHeader';
import MatchDisputePanel from '../MatchDisputePanel';
import MatchHistoryPanel, { appendHistoryEntries, canLoadMoreHistory } from '../MatchHistoryPanel';
import MatchReopenSection, { reopenFailureKind } from '../MatchReopenSection';
import MatchSchedulePanel, { isAfterDeadline, scheduleOutcome } from '../MatchSchedulePanel';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const NOW = Date.UTC(2026, 9, 24, 12);
const PAST = '2026-10-20T18:00:00.000Z';
const FUTURE = '2026-11-20T18:00:00.000Z';

const CONTEXT: AdminMatchContext = {
  league_id: 'league-1',
  league_name: 'Spring League',
  phase_id: 'phase-1',
  phase_name: 'Group stage',
  round_id: 'round-1',
  round_name: 'Opening round',
  round_number: 2,
  round_status: 'active',
  best_of: 3,
  round_deadline: PAST,
  submitter_name: 'Mara Feldkamp',
};

function header(over: Partial<ComponentProps<typeof MatchContextHeader>> = {}) {
  return (
    <MatchContextHeader
      matchId="m1"
      tournamentId="t1"
      status="in_progress"
      scheduledAt="2026-10-25T17:00:00.000Z"
      autoConfirmAt={null}
      player1Name="Mara"
      player2Name="Jonas"
      context={CONTEXT}
      now={NOW}
      {...over}
    />
  );
}

describe('MatchContextHeader', () => {
  it('shows league, phase, round, format, players and the links', () => {
    const html = renderWithI18n(header());

    expect(html).toContain('Spring League');
    expect(html).toContain('Group stage');
    expect(html).toContain('Round 2 · Opening round');
    expect(html).toContain('Bo3');
    expect(html).toContain('Mara vs Jonas');
    expect(html).toContain('Mara Feldkamp');
    expect(html).toContain('href="/tournaments/t1/matches/m1"');
    expect(html).toContain('href="/admin/matches?league=league-1"');
    expect(html).toContain('Times are shown in your time zone (UTC).');
  });

  it('links back to the list as the viewer left it when it is given one', () => {
    const html = renderWithI18n(header({ listHref: '/admin/matches?status=disputed&page=2' }));
    expect(html).toContain('href="/admin/matches?status=disputed&amp;page=2"');
    expect(html).not.toContain('href="/admin/matches?league=league-1"');
  });

  it('marks a past deadline as overdue unless the match is completed or the deadline is ahead', () => {
    expect(renderWithI18n(header())).toContain('Overdue');
    expect(renderWithI18n(header({ status: 'completed' }))).not.toContain('Overdue');
    expect(renderWithI18n(header({ context: { ...CONTEXT, round_deadline: FUTURE } }))).not.toContain('Overdue');
  });

  it('uses the empty variants for missing data', () => {
    const html = renderWithI18n(
      header({
        scheduledAt: null,
        context: { ...CONTEXT, league_id: null, league_name: null, round_deadline: null, submitter_name: null },
      }),
    );

    expect(html).toContain('Standalone tournament');
    expect(html).toContain('Not scheduled');
    expect(html).toContain('No deadline set');
    expect(html).toContain('No result reported yet');
    expect(html).toContain('href="/admin/matches"');
  });

  it('shows the auto-confirm line only while a result awaits confirmation', () => {
    const waiting = renderWithI18n(header({ status: 'pending_confirmation', autoConfirmAt: FUTURE }));
    expect(waiting).toContain('Auto-confirms');
    expect(waiting).not.toContain('No auto-confirm');

    const manual = renderWithI18n(header({ status: 'pending_confirmation', autoConfirmAt: null }));
    expect(manual).toContain('No auto-confirm: manual review');

    expect(renderWithI18n(header({ status: 'in_progress', autoConfirmAt: FUTURE }))).not.toContain('Auto-confirms');
  });

  it('shows the round number alone when the round name only repeats it', () => {
    const plain = { ...CONTEXT, round_name: 'Round 2' };
    const html = renderWithI18n(header({ context: plain }));
    expect(html).toContain('Round 2');
    expect(html).not.toContain('Round 2 · Round 2');
    const de = renderWithI18n(header({ context: plain }), { locale: 'de' });
    expect(de).toContain('Runde 2');
    expect(de).not.toContain('Round 2');
  });

  it('tells a default round name from a custom one', () => {
    expect(isDefaultRoundName(2, 'Round 2')).toBe(true);
    expect(isDefaultRoundName(2, ' round  2 ')).toBe(true);
    expect(isDefaultRoundName(2, '')).toBe(true);
    expect(isDefaultRoundName(2, null)).toBe(true);
    expect(isDefaultRoundName(2, 'Round 3')).toBe(false);
    expect(isDefaultRoundName(2, 'Quarterfinals')).toBe(false);
  });

  it('renders German', () => {
    const html = renderWithI18n(header({ status: 'pending_confirmation' }), { locale: 'de' });

    expect(html).toContain('Rundenfrist');
    expect(html).toContain('Überfällig');
    expect(html).toContain('Runde 2 · Opening round');
    expect(html).toContain('Öffentliche Spielseite');
    expect(html).toContain('Zurück zu den Spielen');
    expect(html).toContain('Keine automatische Bestätigung: manuelle Prüfung');
  });
});

describe('MatchSchedulePanel', () => {
  function schedule(over: Partial<ComponentProps<typeof MatchSchedulePanel>> = {}) {
    return (
      <MatchSchedulePanel
        matchId="m1"
        status="scheduled"
        scheduledAt="2026-10-25T17:00:00.000Z"
        roundDeadline={FUTURE}
        pendingProposals={0}
        {...over}
      />
    );
  }

  it('is read-only for a completed match', () => {
    const html = renderWithI18n(schedule({ status: 'completed', pendingProposals: 2 }));

    expect(html).toContain('This match is completed, so its time cannot be changed.');
    expect(html).not.toContain('datetime-local');
    expect(html).not.toContain('Save time');
    expect(html).not.toContain('open time proposal');
  });

  it('offers a date field, save, and clear only when a time is set', () => {
    const withTime = renderWithI18n(schedule());
    expect(withTime).toContain('type="datetime-local"');
    expect(withTime).toContain('Save time');
    expect(withTime).toContain('Clear time');
    expect(withTime).toContain('The field uses your browser time zone.');

    expect(renderWithI18n(schedule({ scheduledAt: null }))).not.toContain('Clear time');
  });

  it('warns that open time proposals will be cancelled', () => {
    expect(renderWithI18n(schedule({ pendingProposals: 1 }))).toContain(
      '1 open time proposal from the players will be cancelled when you save.',
    );
    expect(renderWithI18n(schedule({ pendingProposals: 3 }), { locale: 'de' })).toContain(
      '3 offene Terminvorschläge der Spieler werden beim Speichern abgebrochen.',
    );
    expect(renderWithI18n(schedule())).not.toContain('proposal');
  });

  it('judges a time against the round deadline', () => {
    expect(isAfterDeadline('2026-11-21T00:00:00.000Z', FUTURE)).toBe(true);
    expect(isAfterDeadline('2026-11-20T17:59:00.000Z', FUTURE)).toBe(false);
    expect(isAfterDeadline(null, FUTURE)).toBe(false);
    expect(isAfterDeadline('2026-11-21T00:00:00.000Z', null)).toBe(false);
  });

  it('words the outcome of a schedule request', () => {
    expect(scheduleOutcome({ scheduled_at: PAST, unchanged: false })).toBe('saved');
    expect(scheduleOutcome({ scheduled_at: null, unchanged: false })).toBe('cleared');
    expect(scheduleOutcome({ scheduled_at: PAST, unchanged: true })).toBe('unchanged');
  });
});

describe('MatchDisputePanel', () => {
  const dispute = {
    actor_id: 'p2',
    actor_name: 'Jonas Reed',
    disputed_at: '2026-10-22T09:30:00.000Z',
    reason: 'The score was entered wrong.\nGame 2 went to me.',
    by_admin: false,
  };

  it('shows who disputed, when and why, with the reported winner and reporter', () => {
    const html = renderWithI18n(
      <MatchDisputePanel dispute={dispute} reportedWinnerName="Mara" reporterName="Mara Feldkamp" />,
    );

    expect(html).toContain('Jonas Reed');
    expect(html).toContain('The score was entered wrong.');
    expect(html).toContain('whitespace-pre-line');
    expect(html).toContain('Mara Feldkamp');
    expect(html).not.toContain('>Admin<');
  });

  it('badges a dispute raised by an admin and says when no reason was given', () => {
    const html = renderWithI18n(
      <MatchDisputePanel
        dispute={{ ...dispute, by_admin: true, reason: null }}
        reportedWinnerName={null}
        reporterName={null}
      />,
    );

    expect(html).toContain('>Admin<');
    expect(html).toContain('No reason given');
    expect(html).toContain('No winner reported');
    expect(html).toContain('No result reported yet');
  });

  it('does not name a reporter when no result was reported, even if the dispute set a submitter', () => {
    const html = renderWithI18n(
      <MatchDisputePanel
        dispute={{ ...dispute, actor_name: 'Site Admin', by_admin: true }}
        reportedWinnerName={null}
        reporterName="Site Admin"
      />,
    );
    expect(html).toContain('Site Admin');
    expect(html).toContain('No winner reported');
    expect(html).toContain('No result reported yet');
    expect(html.match(/Site Admin/g)).toHaveLength(1);
  });

  it('explains a dispute without recorded details', () => {
    const html = renderWithI18n(<MatchDisputePanel dispute={null} reportedWinnerName="Mara" reporterName={null} />);
    expect(html).toContain('The details of this dispute were not recorded.');
    expect(html).not.toContain('No reason given');
  });

  it('gives every definition a term, also without recorded details', () => {
    for (const shown of [null, dispute]) {
      const html = renderWithI18n(<MatchDisputePanel dispute={shown} reportedWinnerName="Mara" reporterName={null} />);
      const terms = html.match(/<dt\b/g)?.length ?? 0;
      const definitions = html.match(/<dd\b/g)?.length ?? 0;
      expect(definitions).toBeGreaterThan(0);
      expect(terms).toBe(definitions);
    }
    expect(renderWithI18n(<MatchDisputePanel dispute={null} reportedWinnerName={null} reporterName={null} />)).toContain(
      'Dispute details'
    );
  });

  it('renders German', () => {
    const html = renderWithI18n(<MatchDisputePanel dispute={null} reportedWinnerName={null} reporterName={null} />, {
      locale: 'de',
    });
    expect(html).toContain('Einspruch');
    expect(html).toContain('Die Details dieses Einspruchs wurden nicht erfasst.');
  });
});

describe('MatchHistoryPanel', () => {
  const players = [
    { id: 'p1', name: 'Mara' },
    { id: 'p2', name: 'Jonas' },
  ];
  const entry = (id: string, over: Partial<MatchHistoryEntry> = {}): MatchHistoryEntry => ({
    id,
    action: 'match.reset',
    actor_id: 'admin-1',
    actor_name: 'Admin Anna',
    created_at: '2026-10-22T09:30:00.000Z',
    reason: null,
    changes: null,
    ...over,
  });
  const page = (entries: MatchHistoryEntry[], total = entries.length): MatchHistoryPage => ({
    entries,
    total,
    offset: 0,
    limit: 20,
  });

  it('lists the events with action, actor, reason and the changed fields', () => {
    const html = renderWithI18n(
      <MatchHistoryPanel
        matchId="m1"
        players={players}
        initialPage={page([
          entry('a', {
            reason: 'Replay was for the wrong match',
            changes: {
              status: { before: 'completed', after: 'scheduled' },
              winner_id: { before: 'p1', after: null },
            },
          }),
          entry('b', { action: 'match.override', actor_name: '' }),
        ])}
      />,
    );

    expect(html).toContain('Match reset');
    expect(html).toContain('Admin Anna');
    expect(html).toContain('Replay was for the wrong match');
    expect(html).toContain('Completed');
    expect(html).toContain('Scheduled');
    expect(html).toContain('Mara');
    expect(html).toContain('none');
    expect(html).toContain('Match overridden');
    expect(html).toContain('Unknown');
    expect(html).toContain('Showing 2 of 2');
    expect(html).not.toContain('Load more');
  });

  it('offers Load more while entries are unseen', () => {
    const html = renderWithI18n(<MatchHistoryPanel matchId="m1" players={players} initialPage={page([entry('a')], 41)} />);
    expect(html).toContain('Showing 1 of 41');
    expect(html).toContain('Load more');
  });

  it('shows an empty state', () => {
    const html = renderWithI18n(<MatchHistoryPanel matchId="m1" players={players} initialPage={page([])} />);
    expect(html).toContain('Nothing has been recorded for this match yet.');
    expect(html).not.toContain('Load more');
  });

  it('shows the load-failed notice with Retry when the first page could not be read', () => {
    const html = renderWithI18n(
      <MatchHistoryPanel matchId="m1" players={players} initialPage={page([])} loadFailed />,
    );
    expect(html).toContain('Retry');
    expect(html).not.toContain('Nothing has been recorded for this match yet.');
  });

  it('renders German', () => {
    const html = renderWithI18n(<MatchHistoryPanel matchId="m1" players={players} initialPage={page([entry('a')], 30)} />, {
      locale: 'de',
    });
    expect(html).toContain('Verlauf');
    expect(html).toContain('Mehr laden');
    expect(html).toContain('1 von 30 angezeigt');
  });

  it('pages only while entries are unseen and the route serves the offset', () => {
    expect(canLoadMoreHistory(20, 41)).toBe(true);
    expect(canLoadMoreHistory(41, 41)).toBe(false);
    expect(canLoadMoreHistory(1001, 5000)).toBe(false);
  });

  it('appends a page without repeating an entry a new event pushed onto it', () => {
    const merged = appendHistoryEntries([entry('a'), entry('b')], [entry('b'), entry('c')]);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('MatchReopenSection', () => {
  it.each(['completed', 'pending_confirmation', 'disputed'] as const)('is offered for a %s match', (status) => {
    const html = renderWithI18n(<MatchReopenSection matchId="m1" status={status} />);
    expect(html).toContain('Reopen match');
    expect(html).toContain('use the Admin Override form or edit a game');
  });

  it.each(['scheduled', 'in_progress'] as const)('is absent for a %s match', (status) => {
    expect(renderWithI18n(<MatchReopenSection matchId="m1" status={status} />)).toBe('');
  });

  it('reloads the page after a committed or stale reopen, and only warns when follow-up steps failed', () => {
    expect(reopenFailureKind('match_reopen_incomplete')).toBe('incomplete');
    expect(reopenFailureKind('match_state_changed')).toBe('stale');
    expect(reopenFailureKind('validation_failed')).toBe('error');
    expect(reopenFailureKind(undefined)).toBe('error');
  });

  it('renders German', () => {
    const html = renderWithI18n(<MatchReopenSection matchId="m1" status="completed" />, { locale: 'de' });
    expect(html).toContain('Spiel wieder öffnen');
    expect(html).toContain('bearbeite eine Partie');
  });
});
