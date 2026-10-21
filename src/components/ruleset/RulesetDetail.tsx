import type { Ruleset } from '@/types/ruleset';
import { getFormatName } from '@/lib/pkmn/format-catalog';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import RulesetDetailView, { type RulesetDetailContent, type RulesetDetailText } from './RulesetDetailView';

/**
 * The headings and chips the detail prints. Without a `labels` prop they come
 * from the `ruleset` namespace (`detail`) in the viewer's language.
 */
export interface RulesetDetailLabels {
  doubles: string;
  clauses: string;
  bannedPokemon: string;
  bannedMoves: string;
  bannedItems: string;
  bannedAbilities: string;
  addedPokemon: string;
  sharedType: string;
  sharedTypeRule: (percent: number) => string;
  customRules: string;
}

/** The detail's labels in `locale`, from the `ruleset` namespace. */
export function rulesetDetailLabels(locale: Locale): RulesetDetailLabels {
  const t = createTranslator(rulesetMessages, locale);
  return {
    doubles: t('detail.doubles'),
    clauses: t('detail.clauses'),
    bannedPokemon: t('detail.bannedPokemon'),
    bannedMoves: t('detail.bannedMoves'),
    bannedItems: t('detail.bannedItems'),
    bannedAbilities: t('detail.bannedAbilities'),
    addedPokemon: t('detail.addedPokemon'),
    sharedType: t('detail.sharedType'),
    sharedTypeRule: (percent) => t('detail.sharedTypeRule', { percent }),
    customRules: t('detail.customRules'),
  };
}

/**
 * The English labels.
 * @deprecated Pass no `labels` to get the viewer's language; kept for callers that still pass it.
 */
export const DEFAULT_RULESET_DETAIL_LABELS: RulesetDetailLabels = rulesetDetailLabels('en');

interface RulesetDetailProps {
  ruleset: Ruleset;
  /**
   * Element wrapping each rule group. Pass `'div'` inside a 3D route world's
   * station (the league hub): while the world is the page, the route-live CSS
   * (`[data-world-route] section:not(dialog *)` in globals.css) fixes every
   * `<section>` under `[data-world-route]` to 100vh and hides its children.
   * Only sections inside a `<dialog>` (the docked overlays) are exempt, and
   * the hub is not in one.
   */
  blockTag?: 'section' | 'div';
  /** Overrides the viewer-language labels. */
  labels?: RulesetDetailLabels;
}

/**
 * Universal shell, rendered from server components: it resolves the format
 * name here (from the dex-free `@/lib/pkmn/format-catalog`; `@/lib/pkmn/formats`
 * reaches `@pkmn/dex`, which must stay out of client bundles) and hands the
 * client view only the displayed fields, as plain strings (a `labels`
 * override's `sharedTypeRule` is applied here, because functions cannot cross
 * to a client component).
 */
export default function RulesetDetail({ ruleset, blockTag = 'section', labels }: RulesetDetailProps) {
  const content: RulesetDetailContent = {
    formatName: getFormatName(ruleset.base_format),
    isDoubles: ruleset.is_doubles,
    clauses: ruleset.clauses,
    bans: ruleset.bans,
    addedPokemon: ruleset.additions.pokemon,
    minSharedTypePct: ruleset.min_shared_type_pct,
    customRules: ruleset.custom_rules_string,
  };
  const text: RulesetDetailText | undefined = labels
    ? {
        doubles: labels.doubles,
        clauses: labels.clauses,
        bannedPokemon: labels.bannedPokemon,
        bannedMoves: labels.bannedMoves,
        bannedItems: labels.bannedItems,
        bannedAbilities: labels.bannedAbilities,
        addedPokemon: labels.addedPokemon,
        sharedType: labels.sharedType,
        sharedTypeRule: labels.sharedTypeRule(ruleset.min_shared_type_pct),
        customRules: labels.customRules,
      }
    : undefined;
  return <RulesetDetailView content={content} blockTag={blockTag} text={text} />;
}
