'use client';

import { ShieldCheck, Info } from 'lucide-react';
import { useT } from '@/i18n/client';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import { CLAUSES } from '@/lib/pkmn/clauses';
import type { PresetRules } from '@/lib/pkmn/preset-rules';
import type { DraftDocument } from '@/lib/ruleset-studio/editor/document';
import { fieldId } from '@/lib/ruleset-studio/editor/targets';
import { cn } from '@/lib/utils/cn';

interface ClausesSectionProps {
  doc: DraftDocument;
  preset: PresetRules | null;
  generation: number;
  onToggle: (id: string, on: boolean) => void;
}

/**
 * The clause list: every clause the catalog knows, switched on or off relative to the preset. The team validator checks
 * two of them (the Species Clause and the Item Clause); every other clause is marked as informational, because it applies
 * in the battle on Showdown and the app shows it without enforcing it. Nothing here pretends otherwise.
 */
export default function ClausesSection({ doc, preset, generation, onToggle }: ClausesSectionProps) {
  const t = useT(rulesetStudioSectionsMessages);
  const inPreset = new Set(preset?.clauses ?? []);
  const added = new Set(doc.clauses.add);
  const removed = new Set(doc.clauses.remove);

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">{t('clauses.intro')}</p>
      <ul className="grid gap-2 lg:grid-cols-2" id={fieldId('/clauses')}>
        {CLAUSES.map((clause) => {
          const on = (inPreset.has(clause.id) || added.has(clause.id)) && !removed.has(clause.id);
          const origin = removed.has(clause.id) ? t('clauses.removedByYou') : added.has(clause.id) ? t('clauses.addedByYou') : inPreset.has(clause.id) ? t('clauses.fromPreset') : null;
          const validator = clause.enforcement === 'validator';
          const wrongGen = clause.gen !== undefined && clause.gen !== generation;
          return (
            <li key={clause.id}>
              <label
                className={cn(
                  'flex min-h-11 cursor-pointer items-start gap-3 rounded-poke-md border p-3 transition-colors',
                  on ? '' : 'border-hairline bg-surface hover:bg-sunken',
                  wrongGen && 'opacity-70',
                )}
              >
                <input
                  id={fieldId(`/clauses/${clause.id}`)}
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0 accent-accent-fill"
                  checked={on}
                  onChange={(event) => onToggle(clause.id, event.target.checked)}
                  aria-label={t('clauses.toggle', { name: clause.name })}
                />
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-sm font-semibold text-fg">{clause.name}</span>
                    {origin !== null && <span className="rounded-full border border-hairline bg-surface px-2 text-[11px] font-semibold text-fg-muted">{origin}</span>}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-fg-muted">
                    {validator ? <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-win" aria-hidden="true" /> : <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                    {validator ? t('clauses.validator') : t('clauses.informational')}
                  </span>
                  {wrongGen && clause.gen !== undefined && <span className="block text-xs text-fg-muted">{t('clauses.onlyGen', { gen: clause.gen })}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
