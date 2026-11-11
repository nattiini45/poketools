'use client';

import SkewChip from '@/components/ui/SkewChip';
import { useT } from '@/i18n/client';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { ItemView } from '@/lib/format-engine/runtime/view-types';
import { EntrySprite, PLAYER_CARD, PlayerSection } from './parts';
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
    <PlayerSection title={t('items.heading')} icon="amulet-coin">
      <div className="flex flex-col gap-4">
        {[...groups.entries()].map(([resource, rows]) => (
          <div key={resource} className={PLAYER_CARD}>
            <h3 className="text-subtitle font-[550] text-fg">{labelOf(rows[0].resource_label)}</h3>
            <ul className="flex flex-wrap gap-2">
              {rows.map((row, index) => (
                <li
                  key={`${row.item_id ?? 'counter'}-${row.holder?.id ?? 'own'}-${index}`}
                  className="flex min-w-0 items-center gap-2 rounded-poke-md border border-hairline bg-elevated py-1 pl-1.5 pr-3 text-body text-fg"
                >
                  {row.item_id !== null ? (
                    <>
                      <EntrySprite id={row.item_id} />
                      <span className="font-[550]">
                        <SpeciesLabel id={row.item_id} />
                      </span>
                      {row.amount !== 1 && <SkewChip tone="tier-1">{t('items.count', { count: row.amount })}</SkewChip>}
                    </>
                  ) : (
                    <span className="py-1.5 pl-1.5 font-heading text-title tabular-nums">{t('items.count', { count: row.amount })}</span>
                  )}
                  {row.holder !== null && <span className="text-fg-muted">({t('items.heldBy', { name: nameOf(row.holder) })})</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </PlayerSection>
  );
}
