/**
 * T09 (i18n-core §11.3): the admin tools under `/admin/{data,meta-data,
 * audit,achievements,wiki}` render from the `admin-tools` namespace in both
 * languages. Effects do not run under `renderToStaticMarkup`, so each tool
 * renders its initial (loading) state without fetching.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import { createTranslator } from '@/i18n/core';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';
import type { ReconcileReport } from '@/lib/reconcile/reconcile-season';
import AdminDataTools, { AllSeasonsReconcileView, SingleSeasonReconcileView } from '../AdminDataTools';
import MetaDataConsole from '../../meta-data/MetaDataConsole';
import AuditLogBrowser from '../../audit/AuditLogBrowser';
import AchievementDefinitionsManager from '../../achievements/AchievementDefinitionsManager';
import WikiModerationPanel, { reportReasonKey } from '../../wiki/WikiModerationPanel';

type Integrity = ReconcileReport['ratings']['integrity'];

function report(
  overrides: { seasonId?: string; totalMismatches?: number; repaired?: boolean; integrity?: Partial<Integrity> } = {},
): ReconcileReport {
  return {
    seasonId: overrides.seasonId ?? 'season-1',
    dryRun: !(overrides.repaired ?? false),
    summary: { totalMismatches: overrides.totalMismatches ?? 0, repaired: overrides.repaired ?? false },
    evolution: { checked: true, mismatches: [], impossibleLineups: [] },
    ratings: {
      checked: true,
      mismatches: [],
      integrity: { gaps: [], unratedMatchIds: [], repairRefusal: null, ...overrides.integrity },
    },
    aggregates: {},
    streaks: {},
    playersAffected: [],
  } as unknown as ReconcileReport;
}

describe('admin-tools messages', () => {
  it('turn the old "(s)" pseudo-plurals into real plurals in both languages', () => {
    const en = createTranslator(adminToolsMessages, 'en');
    const de = createTranslator(adminToolsMessages, 'de');
    expect(en('data.reconcile.seasonCount', { count: 3 })).toBe('3 seasons');
    expect(en('data.reconcile.seasonCount', { count: 1 })).toBe('1 season');
    expect(de('data.reconcile.seasonCount', { count: 2 })).toBe('2 Saisons');
    expect(de('data.export.remaining', { count: 1 })).toBe('Heute noch 1 Export möglich');
  });

  it('keeps the English literals verbatim', () => {
    const en = createTranslator(adminToolsMessages, 'en');
    expect(en('data.reconcile.confirmRepair')).toBe(
      'Repair will rewrite derived records (EPB progression, ratings, league aggregates, streaks) for this scope. Continue?',
    );
    expect(en('achievements.confirmDelete', { key: 'first_win' })).toBe('Delete achievement "first_win"?');
    expect(en('data.import.result', { imported: 2, updated: 1, skipped: 0 })).toBe('2 imported, 1 updated, 0 skipped');
  });

  it('formats numbers per locale inside messages', () => {
    const de = createTranslator(adminToolsMessages, 'de');
    expect(de('data.import.result', { imported: 12345, updated: 0, skipped: 0 })).toContain('12.345 importiert');
    expect(de('achievements.confirmDelete', { key: 'first_win' })).toBe('Erfolg „first_win“ löschen?');
  });
});

describe('AdminDataTools', () => {
  it('renders English without a provider', () => {
    const html = renderToStaticMarkup(<AdminDataTools />);
    expect(html).toContain('Aggregate Jobs');
    expect(html).toContain('Loading job stats…');
    expect(html).toContain('Record Reconciliation');
    expect(html).toContain('Battle Stats');
  });

  it('renders German', () => {
    const html = renderWithI18n(<AdminDataTools />, { locale: 'de' });
    expect(html).toContain('Aggregat-Jobs');
    expect(html).toContain('Job-Statistiken werden geladen …');
    expect(html).toContain('Datenabgleich');
    expect(html).toContain('Spielerimport');
    expect(html).toContain('Kampfstatistiken');
    expect(html).toContain('Gesamter Zeitraum');
    expect(html).not.toContain('Aggregate Jobs');
  });

  it('renders reconcile results with plurals in both languages', () => {
    const consistent = [report(), report({ seasonId: 'season-2' })];
    expect(renderWithI18n(<AllSeasonsReconcileView reports={consistent} />)).toContain(
      'All records consistent — 0 mismatches found across 2 seasons.',
    );
    expect(renderWithI18n(<AllSeasonsReconcileView reports={consistent} />, { locale: 'de' })).toContain(
      'Alle Daten stimmen – 0 Abweichungen in 2 Saisons gefunden.',
    );

    const drift = [report({ totalMismatches: 1, repaired: true }), report({ seasonId: 'season-2' })];
    const deHtml = renderWithI18n(<AllSeasonsReconcileView reports={drift} />, { locale: 'de' });
    expect(deHtml).toContain('2 Saisons – 1 Abweichung insgesamt');
    expect(deHtml).toContain('1 Abweichung · repariert');

    const single = renderWithI18n(<SingleSeasonReconcileView report={report({ totalMismatches: 3 })} />, {
      locale: 'de',
    });
    expect(single).toContain('Abweichungen gesamt');
    expect(single).toContain('Nein');
  });

  it('never calls a report with rating-history gaps consistent, and says the repair heals them', () => {
    const gappy = report({
      integrity: { gaps: [{ matchId: 'm1', playerId: 'p1', missingPlayerId: 'p2' }], unratedMatchIds: ['m2'] },
    });

    const en = renderWithI18n(<SingleSeasonReconcileView report={gappy} />);
    expect(en).not.toContain('All records consistent');
    expect(en).toContain('Rating-history gaps');
    expect(en).toContain('Never-rated matches');
    expect(en).toContain('The repair rebuilds the player whose row is missing first');

    const de = renderWithI18n(<SingleSeasonReconcileView report={gappy} />, { locale: 'de' });
    expect(de).toContain('Lücken im Rating-Verlauf');
    expect(de).toContain('Die Reparatur baut zuerst den Spieler neu auf');

    const all = renderWithI18n(<AllSeasonsReconcileView reports={[gappy]} />);
    expect(all).not.toContain('All records consistent');
    expect(all).toContain('0 mismatches · 1 rating-history gap');
  });

  it('shows the refusal a repair would answer, translated from its catalogue code', () => {
    const refused = report({
      integrity: {
        gaps: [
          { matchId: 'm1', playerId: 'p1', missingPlayerId: 'p2' },
          { matchId: 'm1', playerId: 'p2', missingPlayerId: 'p1' },
        ],
        repairRefusal: {
          code: 'rating_history_incomplete',
          error:
            'Rating history has gaps that no rebuild order can fill for 1 completed match (players: Ash, Gary). Those players were not rebuilt; a developer must restore the missing rating history rows.',
          params: { count: 1, players: 'Ash, Gary' },
        },
      },
    });

    const en = renderWithI18n(<SingleSeasonReconcileView report={refused} />);
    expect(en).toContain('The repair would refuse the ratings step: Rating history has gaps');
    expect(en).not.toContain('The repair rebuilds the player');

    const de = renderWithI18n(<SingleSeasonReconcileView report={refused} />, { locale: 'de' });
    expect(de).toContain('Die Reparatur würde den Rating-Schritt ablehnen:');
    expect(de).toContain('Ash, Gary');
    expect(de).not.toContain('Rating history has gaps');

    expect(renderWithI18n(<AllSeasonsReconcileView reports={[refused]} />)).toContain('repair would refuse the ratings');
  });
});

describe('MetaDataConsole', () => {
  it('renders the cron note as rich text with the path in <code>', () => {
    const en = renderWithI18n(<MetaDataConsole />);
    expect(en).toContain('Usage Statistics');
    expect(en).toContain('<code>/api/cron/refresh-usage-stats</code>');

    const de = renderWithI18n(<MetaDataConsole />, { locale: 'de' });
    expect(de).toContain('Nutzungsstatistiken');
    expect(de).toContain('Abdeckung wird geladen …');
    expect(de).toContain('Ein Vercel-Cronjob aktualisiert');
    expect(de).toContain('<code>/api/cron/refresh-usage-stats</code>');
  });
});

describe('AuditLogBrowser', () => {
  it('renders filters and the loading state in both languages', () => {
    const en = renderWithI18n(<AuditLogBrowser />);
    expect(en).toContain('Audit Events');
    expect(en).toContain('Resource Type');
    expect(en).toContain('Loading...');

    const de = renderWithI18n(<AuditLogBrowser />, { locale: 'de' });
    expect(de).toContain('Protokolleinträge');
    expect(de).toContain('Ressourcentyp');
    expect(de).toContain('Anwenden');
    expect(de).toContain('Wird geladen …');
    // Stored codes stay as they are: the placeholder is an example action code.
    expect(de).toContain('placeholder="match.override"');
  });
});

describe('AchievementDefinitionsManager', () => {
  it('labels the category and tier ids instead of printing them raw', () => {
    const en = renderWithI18n(<AchievementDefinitionsManager />);
    expect(en).toContain('Create Definition');
    expect(en).toContain('>Platinum</option>');
    expect(en).toContain('value="platinum"');

    const de = renderWithI18n(<AchievementDefinitionsManager />, { locale: 'de' });
    expect(de).toContain('Definition anlegen');
    expect(de).toContain('>Silber</option>');
    expect(de).toContain('>Meilenstein</option>');
    expect(de).toContain('Definitionen werden geladen …');
    expect(de).toContain('Übersetzungskatalog');
  });
});

describe('WikiModerationPanel', () => {
  it('renders the queue headings in both languages', () => {
    const en = renderWithI18n(<WikiModerationPanel />);
    expect(en).toContain('Pending Notes');
    expect(en).toContain('Open Reports');

    const de = renderWithI18n(<WikiModerationPanel />, { locale: 'de' });
    expect(de).toContain('Offene Notizen');
    expect(de).toContain('Offene Meldungen');
    expect(de).toContain('Aktualisieren');
  });

  it('labels every report reason, including the reserved "other"', () => {
    const de = createTranslator(adminToolsMessages, 'de');
    const label = (reason: string) => de.dynamic(`wiki.reportReasons.${reportReasonKey(reason)}`, undefined, reason);
    expect(label('other')).toBe('Sonstiges');
    expect(label('off_topic')).toBe('Themenfremd');
    expect(label('something_new')).toBe('something_new');
  });
});
