'use client';

import { useDataLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { teamIssuesOf, useValidationIssueText } from '@/components/teambuilder/LegalityBadge';
import type { TeamValidationResult, SetIssue } from '@/types/team';

/**
 * ValidationPanel — right-column panel showing team + per-slot issues.
 *
 * Features:
 * - Team-level issue list (Species Clause, etc.)
 * - Per-slot issue list grouped by Pokémon
 * - Clickable issues that trigger JUMP_TO_ISSUE
 * - Error/warning counts summary
 */

interface ValidationPanelProps {
  validation: TeamValidationResult | null;
  onJumpToIssue?: (issueId: string) => void;
}

export default function ValidationPanel({
  validation,
  onJumpToIssue,
}: ValidationPanelProps) {
  const t = useT(teambuilderIntelMessages);
  const dl = useDataLocale();
  const issueText = useValidationIssueText();

  if (!validation) {
    return (
      <div className="p-3">
        <p className="text-xs text-poke-text-muted mb-2">{t('validation.title')}</p>
        <p className="text-[11px] text-poke-text-muted/60">
          {t('validation.idle')}
        </p>
      </div>
    );
  }

  const errorCount = validation.issues.filter((i) => i.severity === 'error').length;
  const warningCount = validation.issues.filter((i) => i.severity === 'warning').length;
  const teamIssues = teamIssuesOf(validation);

  return (
    <div className="p-3">
      <p className="text-xs text-poke-text-muted mb-2">{t('validation.title')}</p>

      {/* Summary */}
      <div className="flex items-center gap-2 mb-3">
        {validation.valid ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            {t('validation.valid')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            {t('validation.errors', { count: errorCount })}
            {warningCount > 0 && (
              <span className="text-yellow-400 ml-1">
                {t('validation.warnings', { count: warningCount })}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Team-level issues (by code; English text when the API sent none) */}
      {teamIssues.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase text-poke-text-muted/60 mb-1 tracking-wider">
            {t('validation.teamIssues')}
          </p>
          <ul className="space-y-1">
            {teamIssues.map((issue, i) => (
              <li
                key={`team-${i}`}
                className="text-[11px] text-red-400 bg-red-500/5 px-2 py-1 rounded"
                lang={issue.code ? undefined : 'en'}
              >
                {issueText(issue)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Per-slot issues grouped */}
      {getSlotsWithIssues(validation).map(({ pokemonIndex, species, issues }) => (
        <div key={pokemonIndex} className="mb-3">
          <p className="text-[10px] uppercase text-poke-text-muted/60 mb-1 tracking-wider">
            {t('validation.slot', { n: pokemonIndex + 1, species: localizeSpecies(species, dl) })}
          </p>
          <ul className="space-y-0.5">
            {issues.map((issue) => (
              <li key={issue.issue_id ?? `${pokemonIndex}-${issue.issue}`}>
                <button
                  onClick={() => {
                    if (issue.issue_id && onJumpToIssue) {
                      onJumpToIssue(issue.issue_id);
                    }
                  }}
                  className={`w-full text-left text-[11px] px-2 py-1 rounded transition-colors hover:bg-poke-elevated ${
                    issue.severity === 'error'
                      ? 'text-red-400'
                      : 'text-yellow-400'
                  }`}
                >
                  <span lang={issue.code ? undefined : 'en'}>{issueText(issue)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* No issues at all */}
      {validation.valid && teamIssues.length === 0 && (
        <p className="text-[11px] text-poke-text-muted/60">
          {t('validation.noIssues')}
        </p>
      )}
    </div>
  );
}

// ── Helper ──────────────────────────────────────────────────────────

interface SlotGroup {
  pokemonIndex: number;
  species: string;
  issues: SetIssue[];
}

function getSlotsWithIssues(validation: TeamValidationResult): SlotGroup[] {
  const map = new Map<number, SlotGroup>();
  for (const issue of validation.issues) {
    let group = map.get(issue.pokemon_index);
    if (!group) {
      group = { pokemonIndex: issue.pokemon_index, species: issue.species, issues: [] };
      map.set(issue.pokemon_index, group);
    }
    group.issues.push(issue);
  }
  return Array.from(map.values()).sort((a, b) => a.pokemonIndex - b.pokemonIndex);
}
