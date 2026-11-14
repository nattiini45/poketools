/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HistoricalStatisticsCoverage from '../HistoricalStatisticsCoverage';
import { withI18n } from '@/test/i18n';
import type { HistoricalStatisticsView } from '@/lib/stats/combined-statistics';

const history: HistoricalStatisticsView = {
  state: 'ready', coverage: [{
    competition: { id: 'sky-cup', name: 'Sky Cup', href: '/archive/sky-cup', parentId: null, kind: 'cup', year: 2020, seasonLabel: null },
    sourceResults: 6, candidateBattles: 5, includedBattles: 3, excludedBattles: 1, withheldBattles: 1,
    unmatchedTeamRows: 2, missingPeriods: ['Final week'],
    periods: [{ period: 'Opening week', sourceResults: 6, includedBattles: 3, excludedBattles: 1, withheldBattles: 1, reasons: {} }],
    metrics: { usage: 'disjoint', kills: 'disjoint', records: 'disjoint', honors: 'disjoint' },
  }],
};

describe('historical coverage disclosure', () => {
  it('keeps detailed coverage mounted but hidden until expanded by keyboard', async () => {
    const user = userEvent.setup();
    render(withI18n(<HistoricalStatisticsCoverage history={history} />));
    const trigger = screen.getByRole('button', { name: 'Competition and period details' });
    const body = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(body?.hidden).toBe(true);
    expect(body?.textContent).toContain('Final week');
    expect(body?.textContent).toContain('Included: 3');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/Usage and win rates cover paired/)).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(trigger);
    await user.keyboard('{Enter}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(body?.hidden).toBe(false);
    expect(screen.getByRole('table', { name: 'Sky Cup — Historical coverage' })).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Sky Cup — Historical coverage' }));
    await user.tab({ shift: true });
    await user.keyboard(' ');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(body?.hidden).toBe(true);
  });

  it.each(['excluded', 'not_ready', 'failed'] as const)('keeps the %s notice outside the disclosure', (state) => {
    render(withI18n(<HistoricalStatisticsCoverage history={{ state, coverage: history.coverage }} />));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('region', { name: 'Historical coverage' }).textContent).toMatch(/excluded|not been activated|could not be loaded/);
  });
});
