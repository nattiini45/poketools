'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { useEditorContext } from '../editor/EditorContext';
import { useUsageDetail } from '../hooks/useUsageDetail';
import DescFallbackTag from './DescFallbackTag';
import { formatUsagePct } from './usagePercent';

interface AbilityOption {
  /** Canonical English name: the value stored in the set and passed to `onChange`. */
  name: string;
  shortDesc: string;
  /** 'en' when a German UI asked for German text and none exists (pkmn-l10n §3.6). */
  shortDescLang?: Locale;
}

interface AbilityPickerProps {
  value: string;
  species: string;
  generation: number;
  onChange: (ability: string) => void;
  disabled?: boolean;
}

// Cache per species:gen:lang key (descriptions follow the UI language)
const abilityCache = new Map<string, AbilityOption[]>();

export default function AbilityPicker({
  value,
  species,
  generation,
  onChange,
  disabled,
}: AbilityPickerProps) {
  const { state } = useEditorContext();
  const usageDetail = useUsageDetail(species, state.format, state.seasonId);
  const t = useT(teambuilderIntelMessages);
  const locale = useLocale();
  const dl = useDataLocale();

  const key = species ? `${species}:${generation}:${locale}` : '';
  const [abilities, setAbilities] = useState<AbilityOption[]>(() =>
    key && abilityCache.has(key) ? abilityCache.get(key)! : [],
  );
  const [trackedKey, setTrackedKey] = useState(key);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Usage % per ability (lowercased keys for robust matching)
  const abilityUsage = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const [name, pct] of Object.entries(usageDetail?.abilities ?? {})) {
      map[name.toLowerCase()] = pct;
    }
    return map;
  }, [usageDetail]);

  // Most-used abilities first when usage data exists
  const sortedAbilities = useMemo(() => {
    if (Object.keys(abilityUsage).length === 0) return abilities;
    return [...abilities].sort(
      (a, b) =>
        (abilityUsage[b.name.toLowerCase()] ?? -1) - (abilityUsage[a.name.toLowerCase()] ?? -1),
    );
  }, [abilities, abilityUsage]);

  // Adjust cached abilities during render on species/gen/language change
  if (key !== trackedKey) {
    setTrackedKey(key);
    setAbilities(key && abilityCache.has(key) ? abilityCache.get(key)! : []);
  }

  useEffect(() => {
    if (!species) return;
    const k = `${species}:${generation}:${locale}`;
    if (abilityCache.has(k)) return;
    const controller = new AbortController();
    fetch(
      `/api/pkmn/search?type=ability&list=1&gen=${generation}&species=${encodeURIComponent(species)}&lang=${locale}`,
      { signal: controller.signal },
    )
      .then((r) => r.json())
      .then((j) => {
        if (j.success) {
          const opts: AbilityOption[] = (j.data ?? []).map(
            (a: { name: string; shortDesc?: string; shortDescLang?: Locale }) => ({
              name: a.name,
              shortDesc: a.shortDesc ?? '',
              shortDescLang: a.shortDescLang,
            }),
          );
          abilityCache.set(k, opts);
          setAbilities(opts);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [species, generation, locale]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = useCallback(
    (name: string) => {
      onChange(name);
      setOpen(false);
    },
    [onChange],
  );

  const selectedAbility = abilities.find((a) => a.name === value);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        disabled={disabled || abilities.length === 0}
        className="w-full px-2 py-1.5 text-xs bg-poke-surface border border-poke-border rounded text-left disabled:opacity-50 hover:border-poke-blue/40 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {value ? (
          <span className="text-poke-text-primary">{localizeAbility(value, dl)}</span>
        ) : (
          <span className="text-poke-text-muted">{t('common.none')}</span>
        )}
        {selectedAbility?.shortDesc && (
          <span className="ml-1 text-[10px] text-poke-text-muted truncate hidden sm:inline">
            — {selectedAbility.shortDesc}
          </span>
        )}
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute z-20 top-full mt-0.5 left-0 right-0 bg-poke-elevated border border-poke-border rounded shadow-lg max-h-44 overflow-y-auto"
        >
          {sortedAbilities.map((a) => {
            const pct = abilityUsage[a.name.toLowerCase()];
            return (
              <li key={a.name} role="option" aria-selected={value === a.name}>
                <button
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(a.name); }}
                  className={[
                    'w-full px-2 py-1.5 text-left hover:bg-poke-surface transition-colors',
                    value === a.name ? 'bg-poke-blue/10' : '',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-poke-text-primary flex-1">
                      {localizeAbility(a.name, dl)}
                    </span>
                    {pct !== undefined && (
                      <span className="text-[10px] text-poke-text-secondary tabular-nums shrink-0">
                        {formatUsagePct(pct, locale)}
                      </span>
                    )}
                  </div>
                  {a.shortDesc && (
                    <div className="text-[10px] text-poke-text-muted leading-tight">
                      {a.shortDesc}
                      <DescFallbackTag descLang={a.shortDescLang} />
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
