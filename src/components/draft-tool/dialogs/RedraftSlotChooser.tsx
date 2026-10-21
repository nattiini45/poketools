'use client';

/**
 * Which redraft slot a pick fills (draft-frontend §5.5, §6.1): a radio group,
 * "Slot A – replaces {line} · 3 real KOs transfer".
 */
import { useId } from 'react';
import { useDataLocale, useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { pkmnNameResolver } from '@/lib/draft-finder/names-port';
import type { RedraftSlotVM } from '@/lib/draft-ui/snapshot-adapter';
import type { LineId } from '@/lib/draft-ui/snapshot-types';
import styles from '../draft-tool.module.css';

export interface RedraftSlotChooserProps {
  slots: RedraftSlotVM[];
  value: string | null;
  onChange(redraftSlotId: string): void;
  /** Resolves the dropped line for its label. */
  entryOf(lineId: LineId): DraftLineCatalogEntry | undefined;
  disabled?: boolean;
}

export default function RedraftSlotChooser({ slots, value, onChange, entryOf, disabled = false }: RedraftSlotChooserProps) {
  const t = useT(draftScreenMessages);
  const dl = useDataLocale();
  const name = useId();
  const hintId = `${name}-hint`;

  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" aria-describedby={hintId} disabled={disabled}>
      <legend className="text-sm font-semibold">{t('confirm.slot')}</legend>
      <p id={hintId} className="text-xs text-poke-text-secondary">
        {t('confirm.slotHint')}
      </p>
      {slots.map((slot) => {
        const entry = entryOf(slot.droppedLineId);
        const line = entry
          ? pkmnNameResolver.lineLabel(entry.stages[0].name, entry.stages[2]?.name ?? null, dl)
          : slot.droppedLineId;
        return (
          <label
            key={slot.redraftSlotId}
            className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-poke-border px-3 py-2 text-sm has-[:checked]:border-poke-accent"
          >
            <input
              type="radio"
              name={name}
              value={slot.redraftSlotId}
              checked={value === slot.redraftSlotId}
              onChange={() => onChange(slot.redraftSlotId)}
              className={styles.focusable}
            />
            <span>{t('confirm.slotOption', { label: slot.label, line, count: slot.transferredRealKills })}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
