'use client';

import { useId } from 'react';
import type { BracketType, BoOverrides } from '@/types/tournament';
import Card from '@/components/ui/Card';
import Select from '@/components/ui/Select';
import { useLocale, useT } from '@/i18n/client';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { commonMessages } from '@/i18n/messages/common';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import { bestOfChoices } from '@/lib/tournament/best-of';

interface BoOverrideEditorProps {
  bracketType: BracketType;
  defaultBo: number;
  overrides: BoOverrides;
  onChange: (overrides: BoOverrides) => void;
}

/** Round names that can have Bo overrides, by bracket type: the engine's stored English names (the override keys). */
function getRoundNames(bracketType: BracketType): string[] {
  switch (bracketType) {
    case 'single_elim':
      return ['Quarterfinals', 'Semifinals', 'Finals'];
    case 'double_elim':
      return ['Semifinals', 'Grand Finals'];
    default:
      // Swiss and Round Robin use numbered rounds — overrides don't apply
      return [];
  }
}

export default function BoOverrideEditor({
  bracketType,
  defaultBo,
  overrides,
  onChange,
}: BoOverrideEditorProps) {
  const locale = useLocale();
  const t = useT(tournamentsAdminMessages);
  const tCommon = useT(commonMessages);
  const idPrefix = useId();
  const roundNames = getRoundNames(bracketType);

  if (roundNames.length === 0) return null;

  function handleChange(roundName: string, value: number) {
    const next = { ...overrides };
    if (value === 0) {
      delete next[roundName];
    } else {
      next[roundName] = value;
    }
    onChange(next);
  }

  return (
    <Card variant="outlined" padding="sm">
      <p className="text-subtitle font-[550] text-fg">
        {t('boOverrides.title')}
      </p>
      <p className="text-caption text-fg-muted mt-1">
        {t('boOverrides.hint', { bo: defaultBo })}
      </p>
      <div className="space-y-1.5 mt-2">
        {roundNames.map((name, index) => (
          <div key={name} className="flex flex-wrap items-center gap-3">
            <label htmlFor={`${idPrefix}-${index}`} className="text-body text-fg w-28">
              {translateEngineLabel('round', name, locale)}
            </label>
            <div className="w-48 max-w-full">
            <Select
              id={`${idPrefix}-${index}`}
              value={overrides[name] ?? 0}
              onChange={(e) => handleChange(name, Number(e.target.value))}
              className="h-11 py-1 sm:h-9"
            >
              <option value={0}>{t('boOverrides.defaultOption', { bo: defaultBo })}</option>
              {bestOfChoices(overrides[name]).filter((v) => v !== defaultBo).map((v) => (
                <option key={v} value={v}>
                  {tCommon('bestOf', { count: v })}
                </option>
              ))}
            </Select>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
