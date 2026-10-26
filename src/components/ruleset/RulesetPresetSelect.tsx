'use client';

import { useId, useState, type AriaAttributes } from 'react';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/i18n/client';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import {
  filterRulesetPresets,
  getRulesetPreset,
  groupRulesetPresets,
  type PresetFamily,
  type PresetSource,
} from '@/lib/format-kit/client';

/** The `presetSelect.family` key of each family (the catalog's family ids have hyphens). */
const FAMILY_KEY: Readonly<Record<PresetFamily, string>> = {
  singles: 'singles',
  doubles: 'doubles',
  national: 'national',
  other: 'moreFormats',
  draft: 'draft',
  'draft-national': 'draftNational',
  'draft-doubles': 'draftDoubles',
  'draft-champions': 'draftChampions',
};

const SOURCE_KEY: Readonly<Record<PresetSource, string>> = {
  showdown: 'showdown',
  'smogon-draft': 'smogonDraft',
};

interface RulesetPresetSelectProps {
  /** The id of the select (the search box gets `<id>-search`). */
  id: string;
  label: string;
  /** A rule preset id; `''` means none (only when `noneLabel` is given). */
  value: string;
  onChange: (value: string) => void;
  /** The label of the "no preset" option; without it the control always holds a preset. */
  noneLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: AriaAttributes['aria-describedby'];
  className?: string;
}

/**
 * Picks one of the rule presets of the catalog (Showdown's ladder formats and the Smogon draft formats): a search box
 * that narrows the list by generation, tier, family or source, above a select grouped by source, generation (newest
 * first) and family. The preset names are the catalog's own ("Gen 9 OU"); the surrounding words are translated. The
 * chosen preset stays in the list while a search hides it, and a preset id the catalog does not know (a stored
 * document that outlived it) is shown as unknown so it can be replaced.
 */
export default function RulesetPresetSelect({
  id,
  label,
  value,
  onChange,
  noneLabel,
  disabled = false,
  invalid = false,
  describedBy,
  className,
}: RulesetPresetSelectProps) {
  const t = useT(rulesetMessages);
  const [query, setQuery] = useState('');
  const helpId = useId();
  const matches = filterRulesetPresets(query);
  const groups = groupRulesetPresets(matches);
  const chosen = getRulesetPreset(value);
  const listed = chosen !== undefined && matches.some((preset) => preset.id === chosen.id);
  const noMatch = matches.length === 0;

  return (
    <div className={cn('space-y-2', className)}>
      <Input
        id={`${id}-search`}
        type="search"
        label={t('presetSelect.search')}
        value={query}
        autoComplete="off"
        disabled={disabled}
        aria-describedby={helpId}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p id={helpId} className="text-sm text-poke-text-muted">
        {noMatch ? t('presetSelect.noMatch', { query: query.trim() }) : t('presetSelect.searchHelp')}
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
        {value !== '' && chosen === undefined && <option value={value}>{t('presetSelect.unknown', { id: value })}</option>}
        {chosen !== undefined && !listed && <option value={chosen.id}>{chosen.name}</option>}
        {groups.map((group) => (
          <optgroup
            key={group.key}
            label={t('presetSelect.group', {
              source: t.dynamic(`presetSelect.source.${SOURCE_KEY[group.source]}`),
              generation: group.genLabel,
              family: t.dynamic(`presetSelect.family.${FAMILY_KEY[group.family]}`),
            })}
          >
            {group.presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </div>
  );
}
