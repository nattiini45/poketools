'use client';

import { useFormatter, useT } from '@/i18n/client';
import CollapsibleSection from '@/components/ui/CollapsibleSection';
import { historicalStatisticsMessages } from '@/i18n/messages/historical-statistics';
import type { HistoricalStatisticsView } from '@/lib/stats/combined-statistics';

export default function HistoricalStatisticsCoverage({ history }: { history: HistoricalStatisticsView }) {
  const t = useT(historicalStatisticsMessages);
  const f = useFormatter();
  const periodLabel = (period: string) => {
    if (period === 'first_half' || period === 'second_half' || period === 'ko' || period === 'playoff' || period === 'single') {
      return t(`periods.${period}`);
    }
    return period;
  };
  if (history.state === 'absent') return null;

  return (
    <section aria-label={t('title')} className="min-w-0 space-y-3 rounded-poke-lg border border-poke-border bg-poke-surface p-4 text-sm text-poke-text-secondary">
      <p className="font-semibold text-poke-text-primary">{t('title')}</p>
      {history.state !== 'ready' ? <p>{t(history.state)}</p> : (
        <>
          <p>{t('provenance')}</p>
          <p className="text-xs">{t('knownResults')}</p>
          {history.coverage.length > 0 && <CollapsibleSection title={t('details')} defaultCollapsed keepMounted>
          <div className="space-y-4">
          {history.coverage.map((coverage) => (
            <section key={coverage.competition.id} aria-label={coverage.competition.name} className="min-w-0 space-y-2">
              <p className="font-semibold text-poke-text-primary">{coverage.competition.name}</p>
              <p className="text-xs">{t('summary', {
                results: f.number(coverage.sourceResults),
                candidates: f.number(coverage.candidateBattles),
                included: f.number(coverage.includedBattles),
                excluded: f.number(coverage.excludedBattles),
                withheld: f.number(coverage.withheldBattles),
                unmatched: f.number(coverage.unmatchedTeamRows),
              })}</p>
              <div role="region" aria-label={`${coverage.competition.name} — ${t('title')}`} tabIndex={0} className="max-w-full overflow-x-auto rounded-poke-lg border border-poke-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-accent">
                <table className="w-full whitespace-nowrap text-left text-xs">
                  <caption className="sr-only">{coverage.competition.name} — {t('title')}</caption>
                  <thead className="bg-poke-elevated text-poke-text-primary">
                    <tr>{(['period', 'status', 'results', 'included', 'excludedBattles', 'withheld'] as const).map((key) => <th key={key} scope="col" className="px-3 py-2">{t(key)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {coverage.periods.map((period) => (
                      <tr key={period.period} className="border-t border-poke-border">
                        <th scope="row" className="sticky left-0 bg-poke-surface px-3 py-2">{periodLabel(period.period)}</th>
                        <td className="px-3 py-2">{t('recorded')}</td>
                        {(['sourceResults', 'includedBattles', 'excludedBattles', 'withheldBattles'] as const).map((key) => <td key={key} className="px-3 py-2 tabular-nums">{f.number(period[key])}</td>)}
                      </tr>
                    ))}
                    {coverage.missingPeriods.map((period) => (
                      <tr key={`missing-${period}`} className="border-t border-poke-border">
                        <th scope="row" className="sticky left-0 bg-poke-surface px-3 py-2">{periodLabel(period)}</th>
                        <td className="px-3 py-2">{t('missing')}</td>
                        <td colSpan={4} className="px-3 py-2">{t('notRecorded')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {coverage.periods.length === 0 && <p>{t('noPeriods')}</p>}
            </section>
          ))}
          </div>
          </CollapsibleSection>}
        </>
      )}
    </section>
  );
}
