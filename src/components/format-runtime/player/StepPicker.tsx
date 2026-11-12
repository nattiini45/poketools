'use client';

import { useId, useState } from 'react';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import SkewChip from '@/components/ui/SkewChip';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/i18n/client';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
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
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
      <legend className="float-left w-full text-body font-[550] text-fg">
        {t('step.heading', { number: step.index + 1, resource: labelOf(step.resource_label) })}
      </legend>
      <p className="clear-both self-start" data-step-counter>
        <SkewChip tone={full ? 'win' : 'neutral'}>{t('step.counter', { picked: selected.length, count: step.count })}</SkewChip>
      </p>
      {step.distinct_attr !== null && <p className="text-caption text-fg-muted">{t('step.distinct', { attr: step.distinct_attr })}</p>}
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
            <ul className="max-h-80 divide-y divide-hairline overflow-y-auto rounded-poke-md border border-hairline bg-elevated">
              {visible.map((entry) => {
                const checked = selected.includes(entry.id);
                const reason = takenIds?.has(entry.id) ? 'taken' : blocked.get(entry.id);
                const rowDisabled = !checked && (reason !== undefined || (!single && full));
                const inputId = `${groupName}-${entry.id}`;
                const noteId = `${inputId}-note`;
                const attrs = entry.attrs.map(attrText).filter((text): text is string => text !== null);
                return (
                  <li key={entry.id} className={cn('flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5', checked && 'bg-accent-subtle')}>
                    <input
                      id={inputId}
                      type={single ? 'radio' : 'checkbox'}
                      name={groupName}
                      checked={checked}
                      disabled={rowDisabled}
                      aria-describedby={attrs.length > 0 || reason !== undefined ? noteId : undefined}
                      onChange={() => toggle(entry.id)}
                      className="size-4 shrink-0 cursor-pointer accent-accent-fill disabled:cursor-not-allowed"
                    />
                    <EntrySprite id={entry.id} size={32} className={rowDisabled ? 'opacity-50' : undefined} />
                    <label htmlFor={inputId} className={cn('cursor-pointer text-body', checked && 'font-[550]', rowDisabled ? 'cursor-not-allowed text-fg-muted' : 'text-fg')}>
                      <SpeciesLabel id={entry.id} />
                    </label>
                    <span id={noteId} className="flex flex-wrap items-center gap-1.5">
                      {attrs.map((text) => (
                        <Badge key={text} variant="gray" size="xs">
                          {text}
                        </Badge>
                      ))}
                      {reason !== undefined && (
                        <span className="text-caption text-fg-muted">
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
