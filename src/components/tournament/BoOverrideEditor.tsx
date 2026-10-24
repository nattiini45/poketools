'use client';

import type { BracketType, BoOverrides } from '@/types/tournament';
import Card from '@/components/ui/Card';
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
      <label className="block text-sm font-heading font-semibold text-poke-text-primary">
        {t('boOverrides.title')}
      </label>
      <p className="text-xs text-poke-text-muted mt-1">
        {t('boOverrides.hint', { bo: defaultBo })}
      </p>
      <div className="space-y-1.5 mt-2">
        {roundNames.map((name) => (
          <div key={name} className="flex items-center gap-3">
            <span className="text-sm text-poke-text-primary w-28">{translateEngineLabel('round', name, locale)}</span>
            <select
              value={overrides[name] ?? 0}
              onChange={(e) => handleChange(name, Number(e.target.value))}
              className="border border-poke-border rounded-poke-md px-2 py-1 text-sm bg-poke-surface text-poke-text-primary focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
            >
              <option value={0}>{t('boOverrides.defaultOption', { bo: defaultBo })}</option>
              {bestOfChoices(overrides[name]).filter((v) => v !== defaultBo).map((v) => (
                <option key={v} value={v}>
                  {tCommon('bestOf', { count: v })}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </Card>
  );
}
