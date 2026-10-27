/**
 * The league trash page body: the table of trashed leagues, the pending rebuilds, the notices that stay after a
 * restore or a rebuild. Rendered as static markup in English and German (no DOM): the presentation
 * (`LeagueTrashView`) takes its state as props, the interaction logic is `leagueTrashReducer`
 * (`src/lib/league-trash/__tests__/client.test.ts`).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { renderWithI18n } from '@/test/i18n';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { LeagueTrashView, restoreBusyKey, rebuildBusyKey } from '../LeagueTrashPanel';
import {
  INITIAL_LEAGUE_TRASH_STATE,
  leagueTrashReducer,
  type LeagueTrashPageState,
  type LeagueTrashPendingView,
  type LeagueTrashRowView,
} from '@/lib/league-trash/client';

function row(over: Partial<LeagueTrashRowView> = {}): LeagueTrashRowView {
  return {
    id: 't1',
    seasonId: 's1',
    name: 'Summer League S3',
    formatLabel: 'Draft',
    deletedAt: '2026-10-20T09:30:00Z',
    deletedByName: 'Ash',
    purgeAfter: '2027-01-18T09:30:00Z',
    counts: { players: 12, phases: 1, matches: 40, games: 88, draftPools: 2 },
    rebuildPending: false,
    schemaChanged: false,
    ...over,
  };
}

function pendingItem(over: Partial<LeagueTrashPendingView> = {}): LeagueTrashPendingView {
  return { kind: 'delete', trashId: 't2', seasonId: 's2', name: 'Winter Cup', at: '2026-10-21T10:00:00Z', ...over };
}

function render(props: Partial<ComponentProps<typeof LeagueTrashView>> = {}, locale: 'en' | 'de' = 'en') {
  return renderWithI18n(
    <LeagueTrashView
      rows={[row()]}
      pending={[]}
      state={INITIAL_LEAGUE_TRASH_STATE}
      busy={null}
      confirming={null}
      onAskRestore={() => {}}
      onConfirmRestore={() => {}}
      onCancelRestore={() => {}}
      onRunRebuild={() => {}}
      onDismiss={() => {}}
      {...props}
    />,
    { locale },
  );
}

const withNotices = (...events: Parameters<typeof leagueTrashReducer>[1][]): LeagueTrashPageState =>
  events.reduce(leagueTrashReducer, INITIAL_LEAGUE_TRASH_STATE);

describe('the trashed leagues table', () => {
  it('lists name, format, deleted by, both dates, the counts and a Restore button', () => {
    const html = render();
    for (const part of [
      'Summer League S3',
      'Draft',
      'Ash',
      'Deleted by',
      'Restorable until',
      '12 players',
      '1 phase',
      '40 matches',
      '88 games',
      '2 draft pools',
      'Ready to restore',
      '>Restore<',
      'aria-label="Restore league Summer League S3"',
    ])
      expect(html).toContain(part);
    // Instants render as <time> (the viewer's zone), never a server-formatted string.
    expect(html).toContain('<time dateTime="2026-10-20T09:30:00.000Z"');
    expect(html).toContain('<time dateTime="2027-01-18T09:30:00.000Z"');
  });

  it('German: Papierkorb wording and Wiederherstellen', () => {
    const html = render({}, 'de');
    for (const part of ['Gelöscht von', 'Wiederherstellbar bis', '12 Spieler', '1 Phase', '40 Matches', '88 Spiele', '>Wiederherstellen<', 'Bereit zur Wiederherstellung']) {
      expect(html).toContain(part);
    }
    expect(html).not.toContain('Restore');
  });

  it('a delete without a known actor says so; zero counts are left out', () => {
    const html = render({ rows: [row({ deletedByName: null, counts: { players: 0, phases: 0, matches: 0, games: 0, draftPools: 0 } })] });
    expect(html).toContain('Unknown');
    expect(html).not.toContain('0 players');
  });

  it('marks a league whose schema changed since the delete, with the explanation under the table', () => {
    const html = render({ rows: [row({ schemaChanged: true })] });
    expect(html).toContain('Schema changed since delete');
    expect(html).toContain('A restore checks the saved copy against the current tables');
    expect(html).not.toContain('Ready to restore');
    expect(render({ rows: [row()] })).not.toContain('Schema changed since delete');
    expect(render({ rows: [row({ schemaChanged: true })] }, 'de')).toContain('Schema seit dem Löschen geändert');
  });

  it('a league with a pending delete rebuild shows the badge and cannot be restored', () => {
    const html = render({ rows: [row({ rebuildPending: true })] });
    expect(html).toContain('Rebuild pending');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Restore league Summer League S3"|<button[^>]*aria-label="Restore league Summer League S3"[^>]*disabled=""/);
    expect(html).toContain('Run the pending rebuild of this delete first.');
    expect(html).not.toContain('Ready to restore');
  });

  it('every button is disabled while an action runs, the running one shows its spinner', () => {
    const html = render({ rows: [row(), row({ id: 't9', name: 'Other' })], busy: restoreBusyKey('t1') });
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('animate-spin');
  });

  it('an empty trash says so and renders no table', () => {
    const html = render({ rows: [] });
    expect(html).toContain('The trash is empty.');
    expect(html).not.toContain('<table');
    expect(render({ rows: [] }, 'de')).toContain('Der Papierkorb ist leer.');
  });

  it('table semantics: a caption, column headers with scope and a row header per league', () => {
    const html = render();
    expect(html).toContain('<caption class="sr-only">Deleted leagues</caption>');
    expect(html.match(/<th scope="col"/g)).toHaveLength(8);
    expect(html).toContain('<th scope="row"');
  });

  it('a restored league leaves the table at once; a rebuilt one loses its pending badge', () => {
    const restored = withNotices({
      type: 'restored',
      trashId: 't1',
      restore: { seasonId: 's1', seasonName: 'Summer League S3', pausedPools: 0, warnings: [], rebuildWarning: null },
    });
    expect(render({ state: restored })).not.toContain('data-trash-row="t1"');

    const rebuilt = withNotices({ type: 'rebuilt', trashId: 't1', name: 'Summer League S3', rebuild: { kind: 'delete', rebuildWarning: null } });
    const html = render({ rows: [row({ rebuildPending: true })], state: rebuilt });
    expect(html).not.toContain('Rebuild pending');
    expect(html).toContain('Ready to restore');
  });
});

describe('the pending rebuilds', () => {
  it('lists each with its kind, the time and a Run rebuild button; none when nothing is pending', () => {
    const html = render({ pending: [pendingItem(), pendingItem({ kind: 'restore', trashId: 't3', name: 'Spring Open' })] });
    for (const part of [
      'Pending rebuilds',
      'Winter Cup',
      'After the delete',
      'Spring Open',
      'After the restore',
      'Run rebuild',
      'aria-label="Run the rebuild of league Winter Cup"',
    ])
      expect(html).toContain(part);
    expect(render()).not.toContain('Pending rebuilds');
    const de = render({ pending: [pendingItem()] }, 'de');
    expect(de).toContain('Ausstehende Neuaufbauten');
    expect(de).toContain('Neuaufbau starten');
  });

  it('a finished rebuild leaves the list; one that came back with a warning stays', () => {
    const finished = withNotices({ type: 'rebuilt', trashId: 't2', name: 'Winter Cup', rebuild: { kind: 'delete', rebuildWarning: null } });
    expect(render({ pending: [pendingItem()], state: finished })).not.toContain('Pending rebuilds');
    const warned = withNotices({
      type: 'rebuilt',
      trashId: 't2',
      name: 'Winter Cup',
      rebuild: { kind: 'delete', rebuildWarning: { code: 'derived_data_rebuild_failed' } },
    });
    expect(render({ pending: [pendingItem()], state: warned })).toContain('Pending rebuilds');
  });

  it('the running rebuild is marked busy and every button is disabled', () => {
    const html = render({ pending: [pendingItem()], busy: rebuildBusyKey('delete', 't2') });
    expect(html).toContain('animate-spin');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the notices', () => {
  const restoreEvent = (over: Partial<{ pausedPools: number | null; warnings: never[] | object[]; rebuildWarning: object | null }> = {}) =>
    ({
      type: 'restored',
      trashId: 't1',
      restore: { seasonId: 's1', seasonName: 'Summer League S3', pausedPools: 0, warnings: [], rebuildWarning: null, ...over },
    }) as Parameters<typeof leagueTrashReducer>[1];

  it('a clean restore: a success notice with a link to the league', () => {
    const html = render({ rows: [], state: withNotices(restoreEvent()) });
    expect(html).toContain('League &quot;Summer League S3&quot; was restored.');
    expect(html).toContain('href="/admin/leagues/s1"');
    expect(html).toContain('Open league');
    expect(html).toContain('data-trash-notice="restored"');
    expect(html).toContain('Dismiss');
  });

  it('a restore settled after a request deadline: a warning that its details are unknown', () => {
    const state = withNotices(restoreEvent({ pausedPools: null }));
    const en = render({ rows: [], state });
    expect(en).toContain('data-trash-notice="restored"');
    expect(en).toContain('The restore answered after the request deadline, so its details are unknown');
    expect(en).not.toMatch(/\d+ running drafts? came back paused/);
    expect(en).toContain('bg-poke-yellow-light');
    expect(render({ rows: [], state }, 'de')).toContain('ihre Details sind daher unbekannt');
  });

  it('shows the paused drafts and every kind of restore warning, in English and German', () => {
    const state = withNotices(
      restoreEvent({
        pausedPools: 2,
        warnings: [
          { code: 'parent_missing_nulled', rel: 'teams', column: 'ruleset_id', count: 3 },
          { code: 'replay_hash_released', count: 1 },
          { code: 'columns_ignored', rel: 'games', columns: ['legacy_a', 'legacy_b'] },
        ],
      }),
    );
    const en = render({ rows: [], state });
    for (const part of [
      '2 running drafts came back paused.',
      'Please read',
      '3 records in teams referred to something that was deleted while the league was in the trash. The reference ruleset_id was cleared.',
      '1 restored game used a replay that another game uses now.',
      'The table games no longer has the columns legacy_a and legacy_b.',
    ])
      expect(en).toContain(part);
    const de = render({ rows: [], state }, 'de');
    for (const part of [
      '2 laufende Drafts kamen pausiert zurück.',
      'Bitte lesen',
      '3 Einträge in teams verwiesen auf etwas, das gelöscht wurde',
      'Die Tabelle games hat die Spalten legacy_a und legacy_b nicht mehr.',
      'Liga „Summer League S3“ wurde wiederhergestellt.',
    ])
      expect(de).toContain(part);
  });

  it('singular forms: one paused draft, one cleared record, one column', () => {
    expect(render({ rows: [], state: withNotices(restoreEvent({ pausedPools: 1 })) })).toContain('1 running draft came back paused.');
    const state = withNotices(
      restoreEvent({
        warnings: [
          { code: 'parent_missing_nulled', rel: 'teams', column: 'ruleset_id', count: 1 },
          { code: 'columns_ignored', rel: 'games', columns: ['legacy_a'] },
        ],
      }),
    );
    const en = render({ rows: [], state });
    expect(en).toContain('1 record in teams referred to something');
    expect(en).toContain('The table games no longer has the column legacy_a.');
    const de = render({ rows: [], state }, 'de');
    expect(de).toContain('1 Eintrag in teams verwies auf etwas');
    expect(de).toContain('Die Tabelle games hat die Spalte legacy_a nicht mehr.');
  });

  it('a rebuild warning of the restore is rendered from the catalogue by code (German too)', () => {
    const state = withNotices(
      restoreEvent({ rebuildWarning: { code: 'restore_rebuild_ratings_failed', error: 'The league was restored, but rebuilding the ratings afterwards failed.' } }),
    );
    expect(render({ rows: [], state })).toContain('The rebuild did not finish: The league was restored, but rebuilding the ratings afterwards failed.');
    expect(render({ rows: [], state }, 'de')).toContain('Der Neuaufbau wurde nicht abgeschlossen: Die Liga wurde wiederhergestellt');
  });

  it('a failed restore shows the catalogued error', () => {
    const state = withNotices({ type: 'failed', action: 'restore', name: 'Summer League S3', error: { code: 'LEAGUE_TRASH_EXPIRED' } });
    const en = render({ state });
    expect(en).toContain('data-trash-notice="error"');
    expect(en).toContain('Could not restore league &quot;Summer League S3&quot;.');
    expect(en).toContain('The restore window of this league has ended');
    expect(render({ state }, 'de')).toContain('Die Frist zum Wiederherstellen');
  });

  it('a failure with no readable error falls back to the generic text', () => {
    const state = withNotices({ type: 'failed', action: 'rebuild', name: 'Winter Cup', error: null });
    expect(render({ state })).toContain('The request failed.');
  });

  it('a finished rebuild says so; with a warning it shows the problem', () => {
    const done = withNotices({ type: 'rebuilt', trashId: 't2', name: 'Winter Cup', rebuild: { kind: 'delete', rebuildWarning: null } });
    expect(render({ state: done })).toContain('The rebuild of league &quot;Winter Cup&quot; finished.');
    const warned = withNotices({
      type: 'rebuilt',
      trashId: 't2',
      name: 'Winter Cup',
      rebuild: { kind: 'delete', rebuildWarning: { code: 'rating_history_incomplete', error: 'Rating history has gaps.' } },
    });
    expect(render({ state: warned })).toContain('The rebuild did not finish: Rating history has gaps.');
  });

  it('notices are announced as alerts (the Alert primitive carries role="alert")', () => {
    const html = render({ rows: [], state: withNotices(restoreEvent()) });
    expect(html).toMatch(/<div role="alert"[^>]*data-trash-notice="restored"/);
  });
});
