'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { GENERATIONS, getFormatName, getTiersForGen } from '@/lib/pkmn/format-catalog';
import { generationOrDefault } from '@/lib/pkmn/format-id';
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

  const currentGen = useMemo(() => generationOrDefault(currentFormat), [currentFormat]);

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
        className={`flex h-9 items-center gap-1.5 rounded-lg border border-hairline px-3 text-body transition-[background-color,border-color] duration-80 ease-out pointer-coarse:h-11 ${
          disabled
            ? 'cursor-not-allowed bg-surface text-fg-muted'
            : 'bg-surface text-fg hover:border-hairline-strong hover:bg-hover'
        }`}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={disabled ? t('format.lockedTitle') : t('format.changeTitle')}
      >
        <span className="hidden text-caption text-fg-muted sm:inline">{t('format.label')}</span>
        <span className="max-w-[10rem] truncate font-[550]">{displayName}</span>
        {!disabled && (
          <svg
            className={`h-3.5 w-3.5 text-fg-muted transition-transform duration-80 ease-out ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
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
        <div className="absolute left-0 top-full z-50 mt-1 max-h-[70vh] w-[min(22rem,calc(100vw-3rem))] overflow-y-auto rounded-xl border border-hairline-strong bg-surface p-2 shadow-poke-lg">
          {[...GENERATIONS].reverse().map((gen) => {
            const isExpanded = visibleExpandedGens.has(gen.num);
            const hasActiveTier = currentGen === gen.num;
            const tiers = getTiersForGen(gen.num);
            return (
              <div key={gen.num} className="mb-1 last:mb-0">
                <button
                  type="button"
                  onClick={() => toggleGen(gen.num)}
                  aria-expanded={isExpanded}
                  className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-80 ease-out pointer-coarse:min-h-11 ${
                    hasActiveTier ? 'bg-accent-subtle' : 'hover:bg-hover'
                  }`}
                >
                  <svg
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 shrink-0 transition-transform duration-80 ease-out ${isExpanded ? 'rotate-90' : ''} ${
                      hasActiveTier ? 'text-accent-ink' : 'text-fg-muted'
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  <span
                    className={`text-body font-[550] ${
                      hasActiveTier ? 'text-accent-ink' : 'text-fg'
                    }`}
                  >
                    {t('format.generation', { n: gen.num })}
                  </span>
                  <span
                    className="text-caption text-fg-muted"
                  >
                    {gen.shortName}
                  </span>
                  <span className="ml-auto font-mono text-caption text-fg-muted">{tiers.length}</span>
                </button>
                {isExpanded && (
                  <div className="mb-2 ml-6 mt-1.5 flex flex-wrap gap-1.5">
                    {tiers.map(({ formatId, label }) => {
                      const isActive = formatId === currentFormat;
                      return (
                        <button
                          key={formatId}
                          aria-pressed={isActive}
                          className={`rounded-md border px-2 py-1 text-caption transition-colors duration-80 ease-out pointer-coarse:min-h-11 pointer-coarse:px-3 ${
                            isActive
                              ? 'border-accent-ink bg-accent-subtle font-[550] text-accent-ink'
                              : 'border-hairline bg-elevated text-fg hover:border-hairline-strong hover:bg-hover'
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
