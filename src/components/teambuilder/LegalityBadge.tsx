'use client';

import type {
  SetIssue,
  TeamIssue,
  TeamValidationResult,
  ValidationIssueCode,
  ValidationIssueParams,
} from '@/types/team';
import { useDataLocale, useT } from '@/i18n/client';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
import { PKMN_LIST_PARAM_KINDS, PKMN_PARAM_KINDS, type PkmnParamLocalizer } from '@/i18n/pkmn-seam';
import { pkmnParamLocalizer } from '@/lib/pkmn/i18n/names';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { DataLocale } from '@/lib/pkmn/i18n/types';

/** Anything with an English `issue` and, from current producers, a `code` + `params`. */
export interface CodedIssue {
  issue: string;
  code?: ValidationIssueCode;
  params?: ValidationIssueParams;
}

/** Localizes the @pkmn params of a validation issue (names, `/`-joined type lists, stat keys). */
function localizeIssueParams(
  params: ValidationIssueParams | undefined,
  pkmn: PkmnParamLocalizer,
): ValidationIssueParams {
  const out: ValidationIssueParams = {};
  for (const [name, value] of Object.entries(params ?? {})) {
    if (typeof value !== 'string') {
      out[name] = value;
    } else if (name in PKMN_PARAM_KINDS) {
      out[name] = pkmn(PKMN_PARAM_KINDS[name as keyof typeof PKMN_PARAM_KINDS], value);
    } else if (name in PKMN_LIST_PARAM_KINDS) {
      const { kind, separator } = PKMN_LIST_PARAM_KINDS[name as keyof typeof PKMN_LIST_PARAM_KINDS];
      out[name] = value
        .split(separator)
        .map((part) => pkmn(kind, part))
        .join(' / ');
    } else if (name === 'stat') {
      out[name] = pkmn('statShort', value);
    } else {
      out[name] = value;
    }
  }
  return out;
}

const localizers = new Map<DataLocale, PkmnParamLocalizer>();
function localizerFor(dl: DataLocale): PkmnParamLocalizer {
  let pkmn = localizers.get(dl);
  if (!pkmn) {
    pkmn = pkmnParamLocalizer(dl);
    localizers.set(dl, pkmn);
  }
  return pkmn;
}

/**
 * Renders a validation issue in the viewer's language through
 * `teambuilder.validation.issue.<code>`; issues without a known code keep
 * their English text.
 */
export function useValidationIssueText(): (issue: CodedIssue) => string {
  const t = useT(teambuilderMessages);
  const dl = useDataLocale();
  return (issue) => {
    if (!issue.code) return issue.issue;
    const key = `validation.issue.${issue.code}`;
    if (!t.has(key)) return issue.issue;
    return t.dynamic(key, localizeIssueParams(issue.params, localizerFor(dl)), issue.issue);
  };
}

/** Team-wide issues with codes when the producer sent aligned details, else the plain English strings. */
export function teamIssuesOf(validation: TeamValidationResult): TeamIssue[] {
  const details = validation.team_issue_details;
  if (details && details.length === validation.team_issues.length) return details;
  return validation.team_issues.map((issue) => ({ issue }));
}

interface LegalityBadgeProps {
  validation: TeamValidationResult | null;
  /** If provided, shows issues only for this Pokémon slot index */
  pokemonIndex?: number;
  className?: string;
}

export default function LegalityBadge({
  validation,
  pokemonIndex,
  className = '',
}: LegalityBadgeProps) {
  const t = useT(teambuilderMessages);
  const dl = useDataLocale();
  const issueText = useValidationIssueText();
  if (!validation) return null;

  // Filter to specific Pokémon or show team-level
  let relevantIssues: SetIssue[];
  let teamIssues: TeamIssue[];

  if (pokemonIndex !== undefined) {
    relevantIssues = validation.issues.filter(i => i.pokemon_index === pokemonIndex);
    teamIssues = [];
  } else {
    relevantIssues = validation.issues;
    teamIssues = teamIssuesOf(validation);
  }

  const hasErrors = relevantIssues.some(i => i.severity === 'error') || teamIssues.length > 0;

  if (relevantIssues.length === 0 && teamIssues.length === 0) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-medium text-poke-green ${className}`}>
        <span className="w-2 h-2 rounded-full bg-poke-green" />
        {t('legality.legal')}
      </span>
    );
  }

  return (
    <div className={className}>
      {/* Summary badge */}
      <span
        className={`inline-flex items-center gap-1 text-xs font-medium ${
          hasErrors ? 'text-poke-danger' : 'text-poke-yellow-ink'
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${hasErrors ? 'bg-poke-danger' : 'bg-poke-yellow'}`} />
        {hasErrors ? t('legality.illegal') : t('legality.warnings')}
      </span>

      {/* Issue list */}
      <ul className="mt-1 space-y-0.5">
        {teamIssues.map((issue, i) => (
          <li key={`team-${i}`} className="text-xs text-poke-danger" lang={issue.code ? undefined : 'en'}>
            {issueText(issue)}
          </li>
        ))}
        {relevantIssues.map((issue, i) => (
          <li
            key={`set-${i}`}
            className={`text-xs ${issue.severity === 'error' ? 'text-poke-danger' : 'text-poke-yellow-ink'}`}
          >
            {pokemonIndex === undefined && <span className="font-medium">{localizeSpecies(issue.species, dl)}: </span>}
            <span lang={issue.code ? undefined : 'en'}>{issueText(issue)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
