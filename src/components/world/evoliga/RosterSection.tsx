import SectionShell from '@/components/world/SectionShell';
import RosterTable from './RosterTable';
import { PANEL_NOTICE } from '@/components/world/panel';
import { createTranslator } from '@/i18n/core';
import { worldEvoligaMessages } from '@/i18n/messages/world/evoliga';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { EvoligaLocaleProps } from './types';

interface RosterSectionProps extends EvoligaLocaleProps {
  entries: PointBuyListEntry[];
  hasListBound: boolean;
}

/**
 * #roster — the full point-buy list with price groups, costs, kill
 * thresholds and ratings, plus in-section filter/sort (RosterTable), in the
 * viewer's language.
 *
 * The price groups are the table's filter, not a legend of their own: the pills
 * live in the client RosterTable (`PriceGroupBar`), one per distinct label, since
 * groups that share a finder tab read the same ('17–8') and so share one pill
 * and one colour with the table chips (`priceGroupFilterOptions`).
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
  return (
    <SectionShell id="roster" heading={hasListBound ? t('roster.heading') : t('roster.headingNoList')}>
      {!hasListBound ? (
        <p className={PANEL_NOTICE}>{t('roster.noList')}</p>
      ) : entries.length === 0 ? (
        <p className={PANEL_NOTICE}>{t('roster.emptyList')}</p>
      ) : (
        <RosterTable entries={entries} />
      )}
    </SectionShell>
  );
}
