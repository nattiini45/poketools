'use client';

import { useId, useState } from 'react';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import { useT } from '@/i18n/client';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { EntryView, StepView } from '@/lib/format-engine/runtime/view-types';
import { entryMatchesSearch } from './entry-names';
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
 * is a radio group, a step that wants more is a list of checkboxes that disables the rest once the count is reached.
 * Rows the view flags (`blocked`) or that the last answer said were taken are disabled with the reason written next to
 * them and tied to the control with `aria-describedby`; nothing depends on hover.
 */
export default function StepPicker({ step, entries, selected, onChange, takenIds, disabled = false }: StepPickerProps) {
  const t = useT(formatRuntimePlayerMessages);
  const labelOf = useLText();
  const groupName = useId();
  const [query, setQuery] = useState('');

  const single = step.count === 1;
  const full = selected.length >= step.count;
  const blocked = new Map(step.blocked.map((entry) => [entry.id, entry.reason]));
  const visible = entries.filter((entry) => entryMatchesSearch(entry.id, query));

  function toggle(id: string) {
    if (single) onChange([id]);
    else onChange(selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id]);
  }

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="font-heading text-sm font-semibold text-poke-text-primary">
        {t('step.heading', { number: step.index + 1, resource: labelOf(step.resource_label) })}
      </legend>
      <p className="text-xs text-poke-text-secondary" data-step-counter>
        {t('step.counter', { picked: selected.length, count: step.count })}
      </p>
      {step.distinct_attr !== null && <p className="text-xs text-poke-text-secondary">{t('step.distinct', { attr: step.distinct_attr })}</p>}
      {!step.unlocked ? (
        <p className="text-sm text-poke-text-muted">{t('step.locked')}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-poke-text-muted">{t('step.noEntries')}</p>
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
            <p className="text-sm text-poke-text-muted">{t('step.noMatches')}</p>
          ) : (
            <ul className="max-h-80 divide-y divide-poke-border overflow-y-auto rounded-poke-md border border-poke-border bg-poke-surface">
              {visible.map((entry) => {
                const checked = selected.includes(entry.id);
                const reason = takenIds?.has(entry.id) ? 'taken' : blocked.get(entry.id);
                const rowDisabled = !checked && (reason !== undefined || (!single && full));
                const inputId = `${groupName}-${entry.id}`;
                const noteId = `${inputId}-note`;
                const attrs = entry.attrs.map(attrText).filter((text): text is string => text !== null);
                return (
                  <li key={entry.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:min-h-0">
                    <input
                      id={inputId}
                      type={single ? 'radio' : 'checkbox'}
                      name={groupName}
                      checked={checked}
                      disabled={rowDisabled}
                      aria-describedby={attrs.length > 0 || reason !== undefined ? noteId : undefined}
                      onChange={() => toggle(entry.id)}
                      className="h-4 w-4 cursor-pointer accent-poke-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-poke-border-focus"
                    />
                    <label htmlFor={inputId} className={`text-sm ${rowDisabled ? 'text-poke-text-muted' : 'text-poke-text-primary'}`}>
                      <SpeciesLabel id={entry.id} />
                    </label>
                    <span id={noteId} className="flex flex-wrap items-center gap-1">
                      {attrs.map((text) => (
                        <Badge key={text} variant="gray" size="xs">
                          {text}
                        </Badge>
                      ))}
                      {reason !== undefined && (
                        <span className="text-xs text-poke-text-muted">
                          {reason === 'taken' ? t('step.taken') : t('step.notEligible')}
                        </span>
                      )}
                    </span>
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
