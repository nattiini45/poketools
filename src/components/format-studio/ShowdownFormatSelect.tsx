'use client';

import { useId, useState, type AriaAttributes } from 'react';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { filterShowdownGenerations, getShowdownFormat } from '@/lib/format-kit/client';

interface ShowdownFormatSelectProps {
  /** The id of the select (the search box gets `<id>-search`). */
  id: string;
  label: string;
  /** A Showdown format id; `''` means none (only when `noneLabel` is given). */
  value: string;
  onChange: (value: string) => void;
  /** The label of the "no format" option; without it the control always holds a format. */
  noneLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: AriaAttributes['aria-describedby'];
  className?: string;
}

/**
 * Picks one of the Showdown formats the app knows: a search box that narrows the list by generation and tier, above
 * a select grouped by generation (newest first). The labels are the catalog's own ("Gen 9 OU"); the surrounding
 * words are translated. The chosen format stays in the list while a search hides it, and a format id the catalog
 * does not know (a stored document that outlived it) is shown as unknown so it can be replaced.
 */
export default function ShowdownFormatSelect({
  id,
  label,
  value,
  onChange,
  noneLabel,
  disabled = false,
  invalid = false,
  describedBy,
  className,
}: ShowdownFormatSelectProps) {
  const t = useT(formatStudioEditorMessages);
  const [query, setQuery] = useState('');
  const helpId = useId();
  const generations = filterShowdownGenerations(query);
  const chosen = getShowdownFormat(value);
  const listed = chosen !== undefined && generations.some((generation) => generation.formats.some((format) => format.id === chosen.id));
  const noMatch = generations.length === 0;

  return (
    <div className={cn('space-y-2', className)}>
      <Input
        id={`${id}-search`}
        type="search"
        label={t('fields.showdownSearch')}
        value={query}
        autoComplete="off"
        disabled={disabled}
        aria-describedby={helpId}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p id={helpId} className="text-sm text-poke-text-muted">
        {noMatch ? t('fields.showdownNoMatch', { query: query.trim() }) : t('fields.showdownSearchHelp')}
      </p>
      <Select
        id={id}
        label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={cn(invalid && 'border-poke-danger')}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
      >
        {noneLabel !== undefined && <option value="">{noneLabel}</option>}
        {value !== '' && chosen === undefined && <option value={value}>{t('fields.showdownUnknown', { id: value })}</option>}
        {chosen !== undefined && !listed && <option value={chosen.id}>{chosen.name}</option>}
        {generations.map((generation) => (
          <optgroup key={generation.gen} label={generation.label}>
            {generation.formats.map((format) => (
              <option key={format.id} value={format.id}>
                {format.name}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </div>
  );
}
