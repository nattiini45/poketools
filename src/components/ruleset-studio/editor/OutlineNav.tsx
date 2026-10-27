'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import { useT } from '@/i18n/client';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import type { RulesetDiagnostic } from '@/lib/ruleset-kit/compile';
import { issuesInSection } from '@/lib/ruleset-studio/editor/preview';
import { EDITOR_SECTIONS, type EditorSection } from '@/lib/ruleset-studio/editor/targets';
import type { DraftDocument } from '@/lib/ruleset-studio/editor/document';
import { cn } from '@/lib/utils/cn';

interface OutlineNavProps {
  doc: DraftDocument;
  selected: EditorSection;
  diagnostics: readonly RulesetDiagnostic[];
  onSelect: (section: EditorSection) => void;
}

/** How many own changes a section holds: bans, unbans and allowlist entries, clause switches, team rules, notes. */
export function changeCountOf(doc: DraftDocument, section: EditorSection): number {
  switch (section) {
    case 'clauses': return doc.clauses.add.length + doc.clauses.remove.length;
    case 'pokemon':
    case 'moves':
    case 'items':
    case 'abilities': {
      const rules = doc[section];
      return rules.ban.length + rules.unban.length + (rules.allow?.length ?? 0);
    }
    case 'constraints': return (doc.team_constraints !== null ? 1 : 0) + (doc.min_shared_type_pct > 0 ? 1 : 0);
    case 'notes': return doc.custom_rules.trim() === '' ? 0 : 1;
    default: return 0;
  }
}

/**
 * The section list on the left: Base and basics, Clauses, the four lists, Team rules, Notes. Each entry shows how many
 * changes the section holds and a badge for its problems (a number with a word, never colour alone). Below `lg` the list
 * is a disclosure that shows the open section's name.
 */
export default function OutlineNav({ doc, selected, diagnostics, onSelect }: OutlineNavProps) {
  const t = useT(rulesetStudioSectionsMessages);
  const [open, setOpen] = useState(false);

  return (
    <nav aria-label={t('outline.heading')} className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="rf-outline-list"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between rounded-poke-md border border-poke-border bg-poke-surface px-3 text-sm font-semibold text-poke-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-focus lg:hidden"
      >
        <span>{open ? t('outline.hide') : `${t('outline.show')}: ${t(`outline.${selected}`)}`}</span>
        <ChevronDown className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />
      </button>
      <ul id="rf-outline-list" className={cn('space-y-1', open ? 'block' : 'hidden', 'lg:block')}>
        {EDITOR_SECTIONS.map((section) => {
          const issues = issuesInSection(diagnostics, section);
          const errors = issues.filter((d) => d.severity === 'error').length;
          const warnings = issues.filter((d) => d.severity === 'warning').length;
          const changes = changeCountOf(doc, section);
          const current = section === selected;
          return (
            <li key={section}>
              <button
                type="button"
                aria-current={current ? 'page' : undefined}
                onClick={() => {
                  onSelect(section);
                  setOpen(false);
                }}
                className={cn(
                  'flex min-h-11 w-full items-center justify-between gap-2 rounded-poke-md border px-3 text-left text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-focus sm:min-h-9',
                  current ? 'border-poke-accent bg-poke-accent-light text-poke-text-primary' : 'border-transparent text-poke-text-secondary hover:border-poke-border hover:bg-poke-surface hover:text-poke-text-primary',
                )}
              >
                <span className="min-w-0 truncate">{t(`outline.${section}`)}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {errors > 0 && <Badge variant="red" aria-label={t('outline.issues', { count: errors })}>{errors}</Badge>}
                  {errors === 0 && warnings > 0 && <Badge variant="yellow" aria-label={t('outline.issues', { count: warnings })}>{warnings}</Badge>}
                  {changes > 0 && (
                    <Badge variant="gray" aria-label={t('outline.changes', { count: changes })}>
                      {changes}
                    </Badge>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
