'use client';

import { useState, useEffect } from 'react';
import type { BaseFormat } from '@/types/ruleset';
import { GENERATIONS, getTiersForGen, getFormatSummary } from '@/lib/pkmn/format-catalog';
import { useT } from '@/i18n/client';
import { rulesetMessages } from '@/i18n/messages/ruleset';

interface FormatSelectorProps {
  value: BaseFormat;
  onChange: (format: BaseFormat) => void;
}

/** Extract generation number from a format ID like 'gen9ou' → 9 */
function genFromFormatId(formatId: string): number {
  if (formatId === 'blank') return 0;
  const match = formatId.match(/^gen(\d)/);
  return match ? parseInt(match[1], 10) : 9;
}

/** Generation and tier names are Showdown format names and stay English. */
export default function FormatSelector({ value, onChange }: FormatSelectorProps) {
  const t = useT(rulesetMessages);
  const isCustom = value === 'blank';
  const [selectedGen, setSelectedGen] = useState<number>(isCustom ? 0 : genFromFormatId(value));

  // When value changes externally (e.g. editing an existing ruleset), sync gen
  useEffect(() => {
    if (value === 'blank') {
      setSelectedGen(0);
    } else {
      const gen = genFromFormatId(value);
      if (gen !== selectedGen && gen > 0) setSelectedGen(gen);
    }
    // Only run when value changes, not selectedGen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const tiers = selectedGen > 0 ? getTiersForGen(selectedGen) : [];

  const handleGenChange = (gen: number) => {
    setSelectedGen(gen);
    if (gen === 0) {
      onChange('blank');
    } else {
      const firstTier = getTiersForGen(gen);
      if (firstTier.length > 0) {
        onChange(firstTier[0].formatId);
      }
    }
  };

  const handleTierChange = (formatId: string) => {
    onChange(formatId);
  };

  const currentFormat = getFormatSummary(value);

  return (
    <div className="space-y-3">
      <label className="block text-sm font-heading font-semibold text-poke-text-primary">{t('format.baseFormat')}</label>

      {/* Generation picker */}
      <div>
        <label className="block text-xs text-poke-text-muted mb-1">{t('format.generation')}</label>
        <div className="flex flex-wrap gap-1.5">
          {GENERATIONS.map(g => (
            <button
              key={g.num}
              type="button"
              onClick={() => handleGenChange(g.num)}
              className={`px-3 py-1.5 rounded-poke-md text-sm font-medium transition-colors ${
                selectedGen === g.num
                  ? 'bg-poke-accent text-poke-surface shadow-poke-sm'
                  : 'bg-poke-muted text-poke-text-secondary hover:bg-poke-elevated'
              }`}
              title={g.label}
            >
              {g.num}
              <span className="hidden sm:inline ml-1 text-xs opacity-70">{g.shortName}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleGenChange(0)}
            className={`px-3 py-1.5 rounded-poke-md text-sm font-medium transition-colors ${
              selectedGen === 0
                ? 'bg-poke-accent text-poke-surface shadow-poke-sm'
                : 'bg-poke-muted text-poke-text-secondary hover:bg-poke-elevated'
            }`}
          >
            {t('format.custom')}
          </button>
        </div>
      </div>

      {/* Tier picker — only shown when a generation is selected */}
      {selectedGen > 0 && tiers.length > 0 && (
        <div>
          <label className="block text-xs text-poke-text-muted mb-1">{t('format.tier')}</label>
          <div className="flex flex-wrap gap-1.5">
            {tiers.map(tier => (
              <button
                key={tier.formatId}
                type="button"
                onClick={() => handleTierChange(tier.formatId)}
                className={`px-3 py-1.5 rounded-poke-md text-sm font-medium transition-colors ${
                  value === tier.formatId
                    ? 'bg-poke-accent text-poke-surface shadow-poke-sm'
                    : 'bg-poke-muted text-poke-text-secondary hover:bg-poke-elevated'
                }`}
              >
                {tier.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Current selection summary */}
      {currentFormat && value !== 'blank' && (
        <p className="text-xs text-poke-text-muted">
          {t.rich('format.selected', {
            format: currentFormat.name,
            name: (chunks) => <span className="text-poke-text-primary font-medium">{chunks}</span>,
          })}
          {currentFormat.is_doubles && <span className="ml-1 text-purple-600">{t('format.doubles')}</span>}
        </p>
      )}
      {value === 'blank' && (
        <p className="text-xs text-poke-text-muted">
          {t('format.customHint')}
        </p>
      )}
    </div>
  );
}
