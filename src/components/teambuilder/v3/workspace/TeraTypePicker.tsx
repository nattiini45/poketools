'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import TypeBadge from '@/components/shared/TypeBadge';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import { useEditorContext } from '../editor/EditorContext';
import { useUsageDetail } from '../hooks/useUsageDetail';
import { TERA_TYPES } from '../constants';
import { formatUsagePct } from './usagePercent';

interface TeraTypePickerProps {
  value: string | null;
  /** Species for tera usage % sorting (optional) */
  species?: string;
  onChange: (type: string | null) => void;
  disabled?: boolean;
}

/**
 * TeraTypePicker — compact dropdown. The panel lists all tera types sorted by
 * tera usage % for this species in the current meta (when available), with
 * the % shown next to each type.
 */
export default function TeraTypePicker({ value, species, onChange, disabled }: TeraTypePickerProps) {
  const { state } = useEditorContext();
  const usageDetail = useUsageDetail(species, state.format, state.seasonId);
  const t = useT(teambuilderIntelMessages);
  const locale = useLocale();
  const dl = useDataLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const teraUsage = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const [name, pct] of Object.entries(usageDetail?.tera_types ?? {})) {
      map[name.toLowerCase()] = pct;
    }
    return map;
  }, [usageDetail]);

  // Usage-sorted when data exists, dex order otherwise
  const sortedTypes = useMemo(() => {
    if (Object.keys(teraUsage).length === 0) return [...TERA_TYPES];
    return [...TERA_TYPES].sort(
      (a, b) => (teraUsage[b.toLowerCase()] ?? -1) - (teraUsage[a.toLowerCase()] ?? -1),
    );
  }, [teraUsage]);

  const renderBadge = (type: string) =>
    type === 'Stellar' ? (
      <span className="inline-flex items-center justify-center w-10 h-[16px] text-[8px] font-bold text-poke-text-primary bg-poke-surface rounded border border-poke-border">
        ★ {localizeType(type, dl)}
      </span>
    ) : (
      <TypeBadge type={type} className="!text-[8px] !px-1 !py-0 !min-w-[2.5rem]" />
    );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen((p) => !p)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value ? t('teraPicker.current', { type: localizeType(value, dl) }) : t('teraPicker.pick')}
        className="flex items-center gap-1 px-1.5 py-1 bg-poke-surface border border-poke-border rounded text-left disabled:opacity-50 hover:border-poke-blue/40 transition-colors min-w-[4.5rem]"
      >
        {value ? (
          renderBadge(value)
        ) : (
          <span className="text-[10px] text-poke-text-muted">{t('common.none')}</span>
        )}
        <svg
          className={`w-2.5 h-2.5 text-poke-text-muted ml-auto transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && !disabled && (
        <ul
          role="listbox"
          className="absolute z-20 top-full mt-0.5 right-0 w-40 bg-poke-elevated border border-poke-border rounded shadow-lg max-h-64 overflow-y-auto p-1"
        >
          {value && (
            <li>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(null);
                  setOpen(false);
                }}
                className="w-full px-1.5 py-1 text-left text-[10px] text-poke-text-muted hover:bg-poke-surface rounded transition-colors"
              >
                {t('teraPicker.clear')}
              </button>
            </li>
          )}
          {sortedTypes.map((type) => {
            const pct = teraUsage[type.toLowerCase()];
            return (
              <li key={type} role="option" aria-selected={value === type}>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(type);
                    setOpen(false);
                  }}
                  className={[
                    'w-full flex items-center gap-1.5 px-1.5 py-1 rounded transition-colors',
                    value === type ? 'bg-poke-blue/10' : 'hover:bg-poke-surface',
                  ].join(' ')}
                >
                  {renderBadge(type)}
                  <span className="flex-1" />
                  {pct !== undefined && (
                    <span className="text-[9px] text-poke-text-secondary tabular-nums">
                      {formatUsagePct(pct, locale)}
                    </span>
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
