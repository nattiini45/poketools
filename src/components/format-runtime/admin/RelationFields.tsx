'use client';

import { useId } from 'react';
import Select from '@/components/ui/Select';
import { useLocale, useT } from '@/i18n/client';
import { formatRuntimeAdminMessages } from '@/i18n/messages/format-runtime/admin';
import type { AdjustmentTargets } from '@/lib/format-engine/runtime/view-types';
import { BUTTON_TOUCH, labelText } from './admin-shared';
import type { RelationDraft } from './adjust-form';

interface RelationFieldsProps {
  targets: AdjustmentTargets;
  value: RelationDraft;
  onChange: (next: RelationDraft) => void;
  disabled: boolean;
}

/** Reveal a relation: both sides of its links become visible to everyone. (Setting links is available through the API.) */
export default function RelationFields({ targets, value, onChange, disabled }: RelationFieldsProps) {
  const t = useT(formatRuntimeAdminMessages);
  const locale = useLocale();
  const revealId = useId();
  const hintId = useId();

  return (
    <div className="space-y-3">
      <Select
        label={t('adjust.fields.relation')}
        value={value.relation}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, relation: event.target.value })}
      >
        <option value="">{t('adjust.fields.choose')}</option>
        {targets.relations.map((candidate) => (
          <option key={candidate.key} value={candidate.key}>
            {labelText(candidate.label, locale, candidate.key)}
          </option>
        ))}
      </Select>
      <div className="space-y-1">
        <label htmlFor={revealId} className={`inline-flex items-center gap-2 text-sm text-poke-text-primary ${BUTTON_TOUCH}`}>
          <input
            id={revealId}
            type="checkbox"
            checked={value.reveal}
            disabled={disabled}
            aria-describedby={hintId}
            onChange={(event) => onChange({ ...value, reveal: event.target.checked })}
            className="h-4 w-4 accent-poke-accent"
          />
          {t('adjust.fields.reveal')}
        </label>
        <p id={hintId} className="text-xs text-poke-text-muted">
          {t('adjust.fields.revealHint')}
        </p>
      </div>
    </div>
  );
}
