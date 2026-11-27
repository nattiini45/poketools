'use client';

import { useId, useState } from 'react';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import SkewChip from '@/components/ui/SkewChip';
import { PANEL_INSET } from '@/components/ui/panel';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/i18n/client';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import { distinctAttrKey, selectedDistinctAttrKeys } from '@/lib/format-engine/runtime/domains';
import type { EntryView, StepView } from '@/lib/format-engine/runtime/view-types';
import { entryMatchesSearch } from './entry-names';
import { EntrySprite } from './parts';
import SpeciesLabel from './SpeciesLabel';
import { useLText } from './useLabels';

export interface StepPickerProps {
  step: StepView;
  /** The entries of the step's domain the viewer may see (`[]` for a locked list). */
  entries: readonly EntryView[];
  /** The entry ids chosen for this step. */
  selected: readonly string[];
  onChange: (next: string[]) => void;
  /** Entries the last answer said someone else took (`resource_item_taken`). */
  takenIds?: ReadonlySet<string>;
  disabled?: boolean;
}

function attrText(attr: EntryView['attrs'][number]): string | null {
  if (attr.value === false) return null;
  if (attr.value === true) return attr.key;
  const value = Array.isArray(attr.value) ? attr.value.join(', ') : String(attr.value);
  return `${attr.key}: ${value}`;
}

/**
 * One step of an action: a labelled group with `step.count` choices out of the step's list. A step that wants one entry
 * is a radio group, a step that wants more is a grid of checkboxes. The whole sprite tile is the label, so it can be
 * picked by touch or keyboard. Unavailable entries keep their reason in the accessible description.
 */
export default function StepPicker({ step, entries, selected, onChange, takenIds, disabled = false }: StepPickerProps) {
  const t = useT(formatRuntimePlayerMessages);
  const labelOf = useLText();
  const groupName = useId();
  const [query, setQuery] = useState('');

  const single = step.count === 1;
  const full = selected.length >= step.count;
  const chosenValues = selectedDistinctAttrKeys(entries, step.distinct_attr, selected);
  const distinctValues = new Set(chosenValues);
  const hasConflict = distinctValues.size < chosenValues.length;
  const blocked = new Map(step.blocked.map((entry) => [entry.id, entry.reason]));
  const visible = entries.filter((entry) => entryMatchesSearch(entry.id, query));

  function toggle(id: string) {
    if (single) onChange([id]);
    else onChange(selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id]);
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
      <legend className="float-left w-full text-body font-[550] text-fg">
        {t('step.heading', { number: step.index + 1, resource: labelOf(step.resource_label) })}
      </legend>
      <div className="clear-both flex flex-wrap items-center gap-x-3 gap-y-1" data-step-counter>
        <SkewChip tone={full && !hasConflict ? 'win' : 'neutral'}>{t('step.counter', { picked: selected.length, count: step.count })}</SkewChip>
        {step.distinct_attr !== null && (
          <p className="text-caption text-fg-muted">
            {t('step.distinct', { attr: step.distinct_attr_label ? labelOf(step.distinct_attr_label) : step.distinct_attr })}
          </p>
        )}
      </div>
      {hasConflict && <p className="text-caption text-loss">{t('issue.distinct_attr_duplicate')}</p>}
      {!step.unlocked ? (
        <p className="text-body text-fg-muted">{t('step.locked')}</p>
      ) : entries.length === 0 ? (
        <p className="text-body text-fg-muted">{t('step.noEntries')}</p>
      ) : (
        <>
          <Input
            type="search"
            label={t('step.search', { domain: labelOf(step.domain_label) })}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />
          {visible.length === 0 ? (
            <p className="text-body text-fg-muted">{t('step.noMatches')}</p>
          ) : (
            <ul className="grid max-h-96 w-full grid-cols-[repeat(auto-fill,minmax(min(100%,7rem),1fr))] gap-2 overflow-y-auto p-1">
              {visible.map((entry) => {
                const checked = selected.includes(entry.id);
                const reason = takenIds?.has(entry.id) ? 'taken' : blocked.get(entry.id);
                const value = step.distinct_attr === null ? undefined : distinctAttrKey(entry, step.distinct_attr);
                const sameValue = !checked && !single && value !== undefined && distinctValues.has(value);
                const rowDisabled = !checked && (reason !== undefined || (!single && full) || sameValue);
                const note = reason === 'taken' ? t('step.taken') : reason === 'not_eligible' ? t('step.notEligible') : sameValue ? t('step.sameValue') : null;
                const inputId = `${groupName}-${entry.id}`;
                const nameId = `${inputId}-name`;
                const noteId = `${inputId}-note`;
                const attrs = entry.attrs
                  .filter(({ key }) => entry.detail === undefined || key !== step.distinct_attr)
                  .map(attrText)
                  .filter((text): text is string => text !== null);
                if (entry.detail !== undefined) attrs.unshift(labelOf(entry.detail));
                return (
                  <li key={entry.id} className="min-w-0">
                    <label
                      className={cn(
                        PANEL_INSET,
                        'relative flex h-full min-h-11 flex-col items-center gap-1 p-2 text-center text-fg',
                        'has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-poke-focus',
                        rowDisabled || disabled ? 'cursor-not-allowed text-fg-muted' : 'cursor-pointer hover:bg-hover',
                        checked && 'border-accent-fill bg-accent-subtle',
                      )}
                    >
                      <input
                        id={inputId}
                        type={single ? 'radio' : 'checkbox'}
                        name={groupName}
                        checked={checked}
                        disabled={rowDisabled}
                        aria-labelledby={nameId}
                        aria-describedby={attrs.length > 0 || note !== null ? noteId : undefined}
                        onChange={() => { if (!rowDisabled) toggle(entry.id); }}
                        className="absolute left-2 top-2 size-4 cursor-inherit accent-accent-fill"
                      />
                      <EntrySprite id={entry.id} size={48} className={rowDisabled ? 'opacity-50' : undefined} />
                      <span id={nameId} className="text-body font-[550] [overflow-wrap:anywhere]">
                        <SpeciesLabel id={entry.id} />
                      </span>
                      <span id={noteId} className="flex flex-wrap justify-center gap-1">
                        {attrs.map((text) => (
                          <Badge key={text} variant="gray" size="xs" className="max-w-full whitespace-normal [overflow-wrap:anywhere]">
                            {text}
                          </Badge>
                        ))}
                        {note !== null && (
                          <span className={reason === undefined ? 'sr-only' : 'text-caption text-fg-muted'}>
                            {note}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </fieldset>
  );
}
