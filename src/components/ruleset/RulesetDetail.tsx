import type { Ruleset } from '@/types/ruleset';
import { getFormatName } from '@/lib/pkmn/format-catalog';
import { isEnforcedClause } from '@/lib/pkmn/clauses';
import { itemIconCell, pokemonIconCell } from '@/lib/pkmn/sheet-cells.server';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import RulesetDetailView, { type DetailEntry, type RulesetDetailContent, type RulesetDetailText } from './RulesetDetailView';

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

/** Pokémon names with the cell of their Showdown icon (computed here, so `@pkmn/img` never reaches a client bundle). */
const pokemonEntries = (names: readonly string[]): DetailEntry[] => names.map((name) => ({ name, ic: pokemonIconCell(name) }));
const itemEntries = (names: readonly string[]): DetailEntry[] => names.map((name) => ({ name, ic: itemIconCell(name) }));
const plainEntries = (names: readonly string[]): DetailEntry[] => names.map((name) => ({ name }));

/**
 * Universal shell, rendered from server components: it resolves the format
 * name here (from the dex-free `@/lib/pkmn/format-catalog`; `@/lib/pkmn/formats`
 * reaches `@pkmn/dex`, which must stay out of client bundles) and hands the
 * client view only the displayed fields, as plain data (a `labels`
 * override's `sharedTypeRule` is applied here, because functions cannot cross
 * to a client component).
 *
 * It shows what the team check enforces: the version, the clauses (the ones the check does not enforce are marked as
 * informational), the four lists as bans or, for a list in allowlist mode, as the only entries that are legal, the Pokémon
 * the format key bans that this ruleset allows, the shared-type rule and the team rules in a sentence. Pokémon and items
 * come with their icon-sheet cell (`ic`), drawn by the view with CSS, so a list of hundreds costs one image.
 */
export default function RulesetDetail({ ruleset, blockTag = 'section', labels }: RulesetDetailProps) {
  const content: RulesetDetailContent = {
    formatName: getFormatName(ruleset.base_format),
    isDoubles: ruleset.is_doubles,
    version: ruleset.version?.version_no ?? null,
    clauses: ruleset.clauses.map((name) => ({ name, informational: !isEnforcedClause(name) })),
    bans: {
      pokemon: pokemonEntries(ruleset.bans.pokemon),
      moves: plainEntries(ruleset.bans.moves),
      items: itemEntries(ruleset.bans.items),
      abilities: plainEntries(ruleset.bans.abilities),
    },
    allow: {
      pokemon: ruleset.allow.pokemon === null ? null : pokemonEntries(ruleset.allow.pokemon),
      moves: ruleset.allow.moves === null ? null : plainEntries(ruleset.allow.moves),
      items: ruleset.allow.items === null ? null : itemEntries(ruleset.allow.items),
      abilities: ruleset.allow.abilities === null ? null : plainEntries(ruleset.allow.abilities),
    },
    addedPokemon: pokemonEntries(ruleset.additions.pokemon),
    minSharedTypePct: ruleset.min_shared_type_pct,
    teamConstraints: ruleset.team_constraints,
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
