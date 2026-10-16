'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useDataLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeNature, localizeStat } from '@/lib/pkmn/i18n/names/misc';
import type { StatKey } from '@/lib/pkmn/i18n/types';
import { NATURE_DATA } from '../constants';

/** Groups by boosted stat ('' = neutral natures); labels are built from the localized stat names. */
const GROUPS: readonly (StatKey | '')[] = ['atk', 'def', 'spa', 'spd', 'spe', ''];

interface NaturePickerProps {
  value: string;
  onChange: (nature: string) => void;
  disabled?: boolean;
}

export default function NaturePicker({ value, onChange, disabled }: NaturePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT(teambuilderIntelMessages);
  const dl = useDataLocale();

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

  const stat = (s: StatKey) => localizeStat(s, dl, 'short');

  const natureEntry = NATURE_DATA.find(([n]) => n === value);
  const desc = natureEntry
    ? natureEntry[1] && natureEntry[2]
      ? `+${stat(natureEntry[1])} -${stat(natureEntry[2])}`
      : t('naturePicker.neutral')
    : '';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        disabled={disabled}
        className="w-full px-2 py-1.5 text-xs bg-poke-surface border border-poke-border rounded text-left disabled:opacity-50 hover:border-poke-blue/40 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {value ? (
          <>
            <span className="text-poke-text-primary">{localizeNature(value, dl)}</span>
            {desc && <span className="ml-2 text-poke-text-muted text-[10px]">{desc}</span>}
          </>
        ) : (
          <span className="text-poke-text-muted">{t('common.none')}</span>
        )}
      </button>
      {open && (
        <div className="absolute z-20 top-full mt-0.5 left-0 bg-poke-elevated border border-poke-border rounded shadow-lg p-2 w-52 max-h-72 overflow-y-auto">
          {GROUPS.map((g) => {
            const natures = NATURE_DATA.filter(([, plus]) => plus === g);
            if (natures.length === 0) return null;
            return (
              <div key={g || 'neutral'} className="mb-2 last:mb-0">
                <div className="text-[9px] text-poke-text-muted uppercase tracking-wide mb-0.5">
                  {g ? `+${stat(g)}` : t('naturePicker.neutral')}
                </div>
                <div className="flex flex-wrap gap-0.5">
                  {natures.map(([name, plus, minus]) => (
                    <button
                      key={name}
                      onMouseDown={(e) => { e.preventDefault(); handleSelect(name); }}
                      title={
                        plus && minus
                          ? `+${stat(plus)} / -${stat(minus)}`
                          : t('naturePicker.neutral')
                      }
                      className={[
                        'px-1.5 py-0.5 text-[10px] rounded transition-colors',
                        value === name
                          ? 'bg-poke-blue/20 text-poke-blue'
                          : 'bg-poke-surface hover:bg-poke-muted text-poke-text-secondary',
                      ].join(' ')}
                    >
                      {localizeNature(name, dl)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
