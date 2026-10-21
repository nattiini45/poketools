'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { GENERATIONS, getFormatName, getTiersForGen } from '@/lib/pkmn/format-catalog';
import type { BaseFormat } from '@/types/ruleset';
import { useT } from '@/i18n/client';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';

interface FormatPickerProps {
  currentFormat: string;
  onSelect: (format: string) => void;
  /** Tournament-bound teams can't switch meta */
  disabled?: boolean;
}

/**
 * FormatPicker — meta/format switcher for the teambuilder top bar.
 * Generations newest-first, each collapsible into its tier list.
 * Disabled when the team is bound to a tournament ruleset.
 */
export default function FormatPicker({ currentFormat, onSelect, disabled }: FormatPickerProps) {
  const t = useT(teambuilderMessages);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentGen = useMemo(() => {
    const m = currentFormat.match(/gen(\d)/);
    return m ? parseInt(m[1], 10) : 9;
  }, [currentFormat]);

  const latestGen = GENERATIONS[GENERATIONS.length - 1].num;

  // Latest gen + the gen containing the current format start expanded
  const [expandedGens, setExpandedGens] = useState<Set<number>>(() => {
    const initial = new Set<number>([latestGen]);
    if (currentGen > 0) initial.add(currentGen);
    return initial;
  });
  const visibleExpandedGens = useMemo(() => {
    if (currentGen <= 0 || expandedGens.has(currentGen)) return expandedGens;
    return new Set([...expandedGens, currentGen]);
  }, [expandedGens, currentGen]);

  function toggleGen(genNum: number) {
    setExpandedGens((prev) => {
      const next = new Set(prev);
      if (next.has(genNum)) next.delete(genNum);
      else next.add(genNum);
      return next;
    });
  }

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const displayName = getFormatName(currentFormat as BaseFormat);

  return (
    <div className="relative" ref={ref}>
      <button
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
          disabled
            ? 'bg-poke-surface border-poke-border/50 text-poke-text-muted cursor-not-allowed'
            : 'bg-poke-surface border-poke-border text-poke-text-primary hover:border-poke-blue/40'
        }`}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={disabled ? t('format.lockedTitle') : t('format.changeTitle')}
      >
        <span className="text-poke-text-muted text-[10px]">{t('format.label')}</span>
        <span className="font-medium truncate max-w-[160px]">{displayName}</span>
        {!disabled && (
          <svg
            className={`w-3 h-3 text-poke-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[320px] bg-poke-elevated border border-poke-border rounded-xl p-3 shadow-2xl max-h-[70vh] overflow-y-auto">
          {[...GENERATIONS].reverse().map((gen) => {
            const isExpanded = visibleExpandedGens.has(gen.num);
            const hasActiveTier = currentGen === gen.num;
            const tiers = getTiersForGen(gen.num);
            return (
              <div key={gen.num} className="mb-1 last:mb-0">
                <button
                  type="button"
                  onClick={() => toggleGen(gen.num)}
                  className={`flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md text-left transition-colors ${
                    hasActiveTier ? 'bg-poke-blue/10 hover:bg-poke-blue/15' : 'hover:bg-poke-surface'
                  }`}
                >
                  <svg
                    className={`w-3 h-3 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''} ${
                      hasActiveTier ? 'text-poke-blue' : 'text-poke-text-muted'
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  <span
                    className={`text-[11px] font-medium ${
                      hasActiveTier ? 'text-poke-blue' : 'text-poke-text-secondary'
                    }`}
                  >
                    {t('format.generation', { n: gen.num })}
                  </span>
                  <span
                    className={`text-[10px] ${
                      hasActiveTier ? 'text-poke-blue/60' : 'text-poke-text-muted'
                    }`}
                  >
                    {gen.shortName}
                  </span>
                  <span className="text-[9px] text-poke-text-muted ml-auto">{tiers.length}</span>
                </button>
                {isExpanded && (
                  <div className="flex flex-wrap gap-1.5 mt-1 mb-2 ml-5">
                    {tiers.map(({ formatId, label }) => {
                      const isActive = formatId === currentFormat;
                      return (
                        <button
                          key={formatId}
                          className={`px-2 py-0.5 rounded-md text-[11px] transition-colors ${
                            isActive
                              ? 'bg-poke-blue/20 text-poke-blue ring-1 ring-poke-blue/30'
                              : 'text-poke-text-secondary bg-poke-surface hover:bg-poke-muted'
                          }`}
                          onClick={() => {
                            onSelect(formatId);
                            setOpen(false);
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
