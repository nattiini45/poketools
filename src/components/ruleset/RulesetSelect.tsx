'use client';

import type { SelectHTMLAttributes } from 'react';
import Link from 'next/link';
import Select from '@/components/ui/Select';
import { useT } from '@/i18n/client';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import type { RulesetOption } from '@/lib/ruleset-studio/library-types';
import { groupRulesetOptions } from './ruleset-options';

/** Where rulesets are made and edited. */
const STUDIO_HREF = '/admin/rulesets';

interface RulesetSelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'children' | 'id'> {
  id: string;
  label: string;
  /** The version id the form holds ('' = none). */
  value: string;
  onChange: (versionId: string) => void;
  /** The head of every usable ruleset, plus the versions the form pins that are no longer a head. */
  options: readonly RulesetOption[];
  /** The text of the empty option ("No ruleset", "Select a ruleset"). */
  placeholder: string;
  /** The link to the Ruleset Studio under the select. On by default; a locked select hides it. */
  studioLink?: boolean;
}

/**
 * The ruleset select of the league, phase and tournament forms. A league or phase PINS a published version of a ruleset, so
 * an option is one version: the head of each ruleset ("Name", "Name v2" from the second version on) and, when the form holds
 * an older pin, that version as "Name v1 (older version)", so the select never shows a pinned version as something else.
 * Options are grouped by generation, doubles rulesets in a group of their own. Creating or changing a ruleset happens in the Ruleset Studio, which the link opens.
 */
export default function RulesetSelect({ id, label, value, onChange, options, placeholder, studioLink = true, ...rest }: RulesetSelectProps) {
  const t = useT(rulesetMessages);
  const groups = groupRulesetOptions(options);

  return (
    <div className="space-y-1.5">
      <Select id={id} label={label} value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
        <option value="">{placeholder}</option>
        {groups.map((group) => (
          <optgroup key={`${group.gen}:${group.doubles}`} label={t(group.doubles ? 'select.generationDoubles' : 'select.generation', { gen: group.gen })}>
            {group.options.map(({ option, older }) => (
              <option key={option.id} value={option.id}>
                {older
                  ? t('select.olderVersion', { name: option.name, version: option.version_no })
                  : option.version_no > 1
                    ? t('select.version', { name: option.name, version: option.version_no })
                    : option.name}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      {studioLink && (
        <Link href={STUDIO_HREF} className="inline-flex min-h-11 items-center text-xs font-medium text-poke-blue hover:underline sm:min-h-0">
          {t('select.openStudio')}
        </Link>
      )}
    </div>
  );
}
