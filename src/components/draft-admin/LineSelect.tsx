'use client';

/**
 * Line chooser for "assign a line" and "correct line": the free lines of the
 * catalog in list order, labelled through the pkmn name layer
 * (`useLineText`, data locale) with their price. The server re-checks the
 * choice.
 */
import { useId, useMemo } from 'react';
import { useT } from '@/i18n/client';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { LineId } from '@/types/draft-queue';
import { useLineText } from '@/components/draft-tokens/use-line-text';
import { FIELD, LABEL } from './admin-ui';

export interface LineSelectProps {
  catalog: DraftLineCatalog;
  lineIds: readonly LineId[];
  value: LineId | '';
  onChange(next: LineId | ''): void;
  label: string;
  disabled?: boolean;
}

export default function LineSelect({ catalog, lineIds, value, onChange, label, disabled = false }: LineSelectProps) {
  const t = useT(draftAdminMessages);
  const text = useLineText(catalog);
  const id = useId();
  const prices = useMemo(() => new Map(catalog.lines.map((l) => [l.lineId, l.price])), [catalog]);
  const allowed = useMemo(() => new Set<string>(lineIds), [lineIds]);

  return (
    <div className="space-y-1">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          onChange(allowed.has(next) ? (next as LineId) : '');
        }}
        className={FIELD}
      >
        <option value="">{t('blocked.chooseLine')}</option>
        {lineIds.map((lineId) => (
          <option key={lineId} value={lineId}>
            {t('blocked.lineOption', {
              line: text.label(lineId),
              price: t('corrections.priceValue', { n: prices.get(lineId) ?? 0 }),
            })}
          </option>
        ))}
      </select>
    </div>
  );
}
