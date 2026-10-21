import SectionShell from '@/components/world/SectionShell';
import RosterTable from './RosterTable';
import { PRICE_GROUP_CHIP } from './price-group-chip';
import { PANEL, PANEL_NOTICE } from '@/components/world/panel';
import { createTranslator } from '@/i18n/core';
import { worldEvoligaMessages } from '@/i18n/messages/world/evoliga';
import { worldClientMessages } from '@/i18n/messages/world/client';
import type { PointBuyListEntry } from '@/types/point-buy';
import { priceGroupFilterOptions } from '@/lib/evolution/point-buy-display';
import type { EvoligaLocaleProps } from './types';

interface RosterSectionProps extends EvoligaLocaleProps {
  entries: PointBuyListEntry[];
  hasListBound: boolean;
}

/** Legend columns from `sm` up, by tile count (static class names for Tailwind). */
const LEGEND_COLUMNS: Readonly<Record<number, string>> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
};

/**
 * #roster — the full point-buy list with price groups, costs, kill
 * thresholds and ratings, plus in-section filter/sort (RosterTable), in the
 * viewer's language.
 *
 * The price-group legend shows one tile per distinct label: groups that share
 * a finder tab read the same ('17–8'), so they share one tile and one colour,
 * exactly like the table's filter options and chips (`priceGroupFilterOptions`).
 *
 * The heading names the point-buy list only when one is bound; without a list
 * the section shows just a notice under the neutral roster heading.
 *
 * Deliberately not the themed worlds' rule (`sections/RosterSection.tsx`, which
 * keys on `entries.length > 0`): there the fallback content is a different thing
 * (trainer tiles), so its heading names what is shown. The plaza shows the list
 * or a notice, so a bound but empty list keeps the list heading and says it is
 * empty (`roster.emptyList`). The two headings live in their own namespaces
 * (`world.roster.headingTrainers`, `worldEvoliga.roster.headingNoList`) because
 * the plaza reads `world/evoliga` and `world/client`, never `world`.
 */
export default function RosterSection({ entries, hasListBound, locale }: RosterSectionProps) {
  const t = createTranslator(worldEvoligaMessages, locale);
  const tc = createTranslator(worldClientMessages, locale);
  const legend = priceGroupFilterOptions();
  return (
    <SectionShell id="roster" heading={hasListBound ? t('roster.heading') : t('roster.headingNoList')}>
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
            <ul
              className={`grid grid-cols-2 gap-2 text-xs ${LEGEND_COLUMNS[legend.length] ?? 'sm:grid-cols-5'}`}
            >
              {legend.map((key) => (
                <li
                  key={key}
                  data-price-group={key}
                  className={`rounded-lg px-2 py-1.5 text-center font-medium ${PRICE_GROUP_CHIP[key]}`}
                >
                  {tc(`rosterTable.priceGroup.${key}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </SectionShell>
  );
}
