/**
 * The rules text: the effective rules of a ruleset (`ResolvedRules`) in plain sentences, in English or German. The
 * editor's Rules text tab reads it; the public rules page can render the same sections. Pure: it needs no dex, so the
 * names of entries come from a callback the caller supplies (the editor looks them up in its catalog index and localizes
 * them, a server page resolves them from the name layer); without one the sentence shows the id.
 *
 * It is NOT part of the kit's client barrel (`./client.ts`): it reads a translation namespace and the type names, which the
 * kit's import closure test keeps out of the compile path. It is client-safe all the same (the editor imports it).
 *
 * The honest note about clauses is part of the text: the team validator checks the Species Clause and the Item Clause, the
 * other clauses are shown but apply in the battle, and the text says so.
 */
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { rulesetStudioDescribeMessages } from '@/i18n/messages/ruleset-studio/describe';
import { clauseName, getClause, isEnforcedClause } from '@/lib/pkmn/clauses';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import { RULESET_CATEGORIES, type ResolvedList, type ResolvedRules, type RulesetCategory } from './types';

export type DescribedSectionId = 'base' | 'clauses' | RulesetCategory | 'constraints' | 'notes';

export interface DescribedSection {
  id: DescribedSectionId;
  heading: string;
  lines: string[];
}

export interface DescribedRuleset {
  sections: DescribedSection[];
  /** "12 bans, 3 clauses". */
  coverage: string;
  /** Total number of banned (block mode) or allowed (allow mode) entries across the four lists. */
  entryCount: number;
}

export interface DescribeOptions {
  /** The display name of the preset the ruleset is based on; null for a blank base. */
  presetName: string | null;
  /** Display name of an entry id in the reader's language; default: the id itself. */
  nameOf?: (category: RulesetCategory, id: string) => string;
  /** The most names a list sentence spells out before "and N more". Default 12. */
  maxNames?: number;
  /** The reader's data locale for type names; defaults to `locale`. */
  dataLocale?: Locale;
}

const DEFAULT_MAX_NAMES = 12;

function nameList(
  category: RulesetCategory,
  list: ResolvedList,
  max: number,
  nameOf: (category: RulesetCategory, id: string) => string,
  more: (names: string, count: number) => string,
): string {
  const names = list.ids.map((id) => nameOf(category, id)).sort((a, b) => a.localeCompare(b));
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? more(shown, names.length - max) : shown;
}

/**
 * The team rules of a ruleset in plain sentences: the shared-type rule, type quotas, Tera matching, the evolution-stage rule
 * and the Eviolite cap. Empty when the ruleset has none. The public rules view prints these lines under its own heading,
 * so it passes `min_shared_type_pct: 0` when it already shows the shared-type rule on its own.
 */
export function describeTeamRules(
  rules: Pick<ResolvedRules, 'min_shared_type_pct' | 'team_constraints'>,
  locale: Locale,
  dataLocale: Locale = locale,
): string[] {
  const t = createTranslator(rulesetStudioDescribeMessages, locale);
  const rule: string[] = [];
  if (rules.min_shared_type_pct > 0) rule.push(t('constraints.sharedType', { percent: rules.min_shared_type_pct }));
  const constraints = rules.team_constraints;
  if (constraints?.type_quotas !== undefined) {
    const quotas = constraints.type_quotas;
    if (quotas.source === 'fixed') {
      rule.push(
        t('constraints.typeQuotasFixed', {
          min: quotas.min_per_type,
          types: (quotas.fixed_types ?? []).map((type) => localizeType(type, dataLocale)).join(', '),
        }),
      );
    } else {
      rule.push(t('constraints.typeQuotasCore', { min: quotas.min_per_type }));
    }
  }
  if (constraints?.tera_match === 'player_core') rule.push(t('constraints.teraCore'));
  if (constraints?.tera_match === 'team_types') rule.push(t('constraints.teraTeam'));
  if (constraints?.evolution_stage?.mode === 'nfe_only_plus_n_fe') {
    const cap = constraints.evolution_stage.fully_evolved_cap;
    rule.push(cap === undefined ? t('constraints.evolutionUncapped') : t('constraints.evolution', { cap }));
  }
  if (constraints?.eviolite_tier_cap !== undefined) rule.push(t('constraints.eviolite', { tier: constraints.eviolite_tier_cap }));
  return rule;
}

/** Describes the effective rules of a ruleset in `locale`. */
export function describeRuleset(rules: ResolvedRules, locale: Locale, options: DescribeOptions): DescribedRuleset {
  const t = createTranslator(rulesetStudioDescribeMessages, locale);
  const nameOf = options.nameOf ?? ((_category, id) => id);
  const max = options.maxNames ?? DEFAULT_MAX_NAMES;
  const dataLocale = options.dataLocale ?? locale;
  const sections: DescribedSection[] = [];

  // Base.
  const base: string[] = [
    options.presetName === null ? t('base.blank') : t('base.preset', { preset: options.presetName }),
    t(rules.doubles ? 'base.doubles' : 'base.singles', { gen: rules.gen }),
    t(rules.universe === 'national' ? 'base.national' : 'base.standard'),
  ];
  sections.push({ id: 'base', heading: t('heading.base'), lines: base });

  // Clauses.
  const clauseLines: string[] = [];
  if (rules.clauses.length === 0) {
    clauseLines.push(t('clauses.none'));
  } else {
    clauseLines.push(t('clauses.list', { list: rules.clauses.map(clauseName).join(', ') }));
    if (rules.clauses.some((id) => getClause(id) !== undefined && !isEnforcedClause(id))) clauseLines.push(t('clauses.informational'));
  }
  sections.push({ id: 'clauses', heading: t('heading.clauses'), lines: clauseLines });

  // The four lists.
  let entryCount = 0;
  for (const category of RULESET_CATEGORIES) {
    const list = rules[category];
    entryCount += list.ids.length;
    const lines: string[] = [];
    if (list.mode === 'allow') {
      lines.push(
        t(`list.${category}.allow`, {
          count: list.ids.length,
          list: nameList(category, list, max, nameOf, (names, count) => t('list.more', { names, count })),
        }),
      );
    } else if (list.ids.length === 0) {
      lines.push(t(`list.${category}.none`));
    } else {
      lines.push(
        t(`list.${category}.block`, {
          count: list.ids.length,
          list: nameList(category, list, max, nameOf, (names, count) => t('list.more', { names, count })),
        }),
      );
    }
    sections.push({ id: category, heading: t(`heading.${category}`), lines });
  }

  // Team rules.
  const rule = describeTeamRules(rules, locale, dataLocale);
  sections.push({ id: 'constraints', heading: t('heading.constraints'), lines: rule.length === 0 ? [t('constraints.none')] : rule });

  // Notes.
  const notes = rules.custom_rules.trim();
  sections.push({ id: 'notes', heading: t('heading.notes'), lines: [notes === '' ? t('notes.none') : notes] });

  return {
    sections,
    entryCount,
    coverage: t('coverage.join', {
      bans: t('coverage.bans', { count: entryCount }),
      clauses: t('coverage.clauses', { count: rules.clauses.length }),
    }),
  };
}
