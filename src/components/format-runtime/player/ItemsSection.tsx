'use client';

import Section from '@/components/ui/Section';
import { useT } from '@/i18n/client';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { ItemView } from '@/lib/format-engine/runtime/view-types';
import SpeciesLabel from './SpeciesLabel';
import { useLText, usePlayerName } from './useLabels';

export interface ItemsSectionProps {
  items: readonly ItemView[];
}

/** What the viewer holds, per resource: a domain item by name, a counter by its amount. */
export default function ItemsSection({ items }: ItemsSectionProps) {
  const t = useT(formatRuntimePlayerMessages);
  const labelOf = useLText();
  const nameOf = usePlayerName();

  const groups = new Map<string, ItemView[]>();
  for (const item of items) groups.set(item.resource, [...(groups.get(item.resource) ?? []), item]);

  return (
    <Section title={t('items.heading')}>
      <div className="space-y-4">
        {[...groups.entries()].map(([resource, rows]) => (
          <div key={resource} className="space-y-1">
            <h3 className="font-heading text-base font-bold text-poke-text-primary">{labelOf(rows[0].resource_label)}</h3>
            <ul className="space-y-0.5 text-sm text-poke-text-primary">
              {rows.map((row, index) => (
                <li key={`${row.item_id ?? 'counter'}-${row.holder?.id ?? 'own'}-${index}`}>
                  {row.item_id !== null ? (
                    <>
                      <SpeciesLabel id={row.item_id} />
                      {row.amount !== 1 && <> {t('items.count', { count: row.amount })}</>}
                    </>
                  ) : (
                    t('items.count', { count: row.amount })
                  )}
                  {row.holder !== null && (
                    <span className="text-poke-text-secondary"> ({t('items.heldBy', { name: nameOf(row.holder) })})</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}
