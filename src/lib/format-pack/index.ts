/**
 * Public entry of the format pack (design spec §B.3). Client-safe and pure.
 *
 * Every consumer imports from here (`@/lib/format-pack`), never from `@format-pack` or a pack
 * folder. The accessors are thin: they keep the call sites of the consumer slices uniform.
 */
import type { Locale } from '@/i18n/config';
import type { PriceGroup } from '@/types/point-buy';
import { formatPack } from './active';
import { storedFlagsOf } from './stored-flags';
import type { EpbLineRule, FormatPack, LineOverride, TeraEligibility } from './types';

export { formatPack } from './active';
export type * from './types';
export { definePackEn, type PackEn } from './define';
export { STORED_FLAG, storedFlagsOf } from './stored-flags';

/** The EPB section of the active pack. */
export const epbPack: FormatPack['epb'] = formatPack.epb;

/** The pack's ruling for a line, by its stored English base name; null when the line has none. */
export function epbLineRuleForBase(base: string): EpbLineRule | null {
  return formatPack.epb.lineRules.find((r) => r.base === base) ?? null;
}

/** The stored flags the importer writes for a base (`special_rules` jsonb, `STORED_FLAG` keys); null when none. */
export function storedSpecialRulesForBase(base: string): Record<string, boolean> | null {
  return storedFlagsOf(epbLineRuleForBase(base));
}

/** The league threshold override of a line id; null when there is none. */
export function lineOverrideFor(lineId: string): LineOverride | null {
  return formatPack.epb.lineOverrides.find((o) => o.line_id === lineId) ?? null;
}

/**
 * Comeback Tokens of a loss from the surviving-Pokémon score: a shutout (loser 0 alive) earns the
 * tokens of the highest table row whose `minWinnerSurvivors` the winner reaches; anything else 0.
 */
export function comebackTokensFromTable(loserSurvivors: number, winnerSurvivors: number): number {
  if (loserSurvivors > 0) return 0;
  let tokens = 0;
  for (const row of formatPack.epb.comeback.table) {
    if (winnerSurvivors >= row.minWinnerSurvivors) tokens = row.tokens;
  }
  return tokens;
}

/** Tera eligibility of a stage: stage <= 1 -> stage1, 2 -> stage2, anything higher -> stage3. */
export function teraEligibilityForStage(stage: number): TeraEligibility {
  const t = formatPack.epb.teraByStage;
  if (stage <= 1) return t.stage1;
  if (stage === 2) return t.stage2;
  return t.stage3;
}

/**
 * The price group of a price when the sheet names none: the first group (in `priceGroupOrder`,
 * descending) whose range minimum the price reaches, else the last group.
 */
export function priceGroupForPrice(price: number): PriceGroup {
  const order = formatPack.epb.priceGroupOrder;
  for (const group of order) {
    if (price >= formatPack.epb.priceGroups[group][0]) return group;
  }
  return order[order.length - 1];
}

/** The price tab of a price; null means the line appears only under "all". */
export function priceTabOf(price: number): string | null {
  for (const tab of formatPack.epb.priceTabs) {
    if (price >= tab.min && price <= tab.max) return tab.key;
  }
  return null;
}

/** The label of a utility key in `locale`, falling back to English, then to the key itself. */
export function utilityLabel(key: string, locale: Locale): string {
  return formatPack.messages[locale].utility[key] ?? formatPack.messages.en.utility[key] ?? key;
}

/** The base of the first line that earns participation tokens; null when the pack has none. */
export function participationLineBase(): string | null {
  return formatPack.epb.lineRules.find((r) => r.participationPoints)?.base ?? null;
}
