import SectionShell from '@/components/world/SectionShell';
import RosterTable from './RosterTable';
import { PANEL, PANEL_NOTICE } from '@/components/world/panel';
import { createTranslator } from '@/i18n/core';
import { worldEvoligaMessages } from '@/i18n/messages/world/evoliga';
import { worldClientMessages } from '@/i18n/messages/world/client';
import { PRICE_GROUPS, type PointBuyListEntry } from '@/types/point-buy';
import type { EvoligaLocaleProps } from './types';

interface RosterSectionProps extends EvoligaLocaleProps {
  entries: PointBuyListEntry[];
  hasListBound: boolean;
}

/**
 * #roster — the full point-buy list with price groups, costs, kill
 * thresholds and ratings, plus in-section filter/sort (RosterTable), in the
 * viewer's language.
 */
export default function RosterSection({ entries, hasListBound, locale }: RosterSectionProps) {
  const t = createTranslator(worldEvoligaMessages, locale);
  const tc = createTranslator(worldClientMessages, locale);
  return (
    <SectionShell id="roster" heading={t('roster.heading')}>
      {!hasListBound ? (
        <p className={PANEL_NOTICE}>{t('roster.noList')}</p>
      ) : entries.length === 0 ? (
        <p className={PANEL_NOTICE}>{t('roster.emptyList')}</p>
      ) : (
        <div>
          <RosterTable entries={entries} />
          <div className={`mt-4 ${PANEL} p-4`}>
            <h3 className="mb-2 font-heading text-xs font-semibold uppercase tracking-wide text-arena-ink-secondary">
              {t('roster.priceGroups')}
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
              {PRICE_GROUPS.map((key) => (
                <div
                  key={key}
                  className="rounded-lg border border-arena-border bg-arena-elevated px-2 py-1.5 text-center text-arena-ink-secondary"
                >
                  {tc(`rosterTable.priceGroup.${key}`)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </SectionShell>
  );
}
