import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { leagueHubHref } from '@/lib/league-hub/tabs';
import { LOCALES, type Locale } from '@/i18n/config';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import { createTranslator } from '@/i18n/core';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { worldClientMessages } from '@/i18n/messages/world/client';
import type { SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';
import type { RulesCopyContext } from './types';

/**
 * The format-aware half of the rules plaque, shared by the three English
 * route themes (sakura, mountain, clouds), their DOM #rules section, the
 * `?rules=gate` overlay and the painted in-world plaque. Pure and
 * client-safe: the 3D gates import it next to their painter.
 *
 * Only Evolution Point Buy seasons ever get a `format_rules` row (season
 * creation seeds one for EPB alone, and the format-rules API rejects every
 * other format), so the EPB draft numbers — budget, lines, Tera, banned
 * moves — are shown for EPB only. Every other format shows its format and
 * the current stage's best-of, and the full rules (clauses, bans, custom
 * rules) live in the league hub's Rules tab, which reads the ruleset live.
 */

/**
 * THE current stage of a league, as every world names it (stages arrive in
 * `stage_order`): the active stage; else the first stage not yet completed —
 * the one about to be played, so a league that has not started names its
 * group stage, not the playoffs created up front, and a league between
 * stages names the next one; else (every stage completed) the last one;
 * else null. The Pulse sections ('Aktuelle Etappe' on the plaza, the
 * masthead on the English worlds), the board panels and every rules surface
 * read it, so the best-of on a plaque always belongs to the stage Pulse
 * names. (PR #65 test pass, R10: the rules surfaces fell back to the FIRST
 * stage while the plaza Pulse fell back to the last — a finished league read
 * 'Best-of: 1' from its group stage under 'Aktuelle Etappe: … Playoffs'.)
 */
export function currentStage<T extends Pick<TournamentWithDetails, 'status'>>(stages: readonly T[]): T | null {
  return (
    stages.find((stage) => stage.status === 'active') ??
    stages.find((stage) => stage.status !== 'completed') ??
    stages[stages.length - 1] ??
    null
  );
}

/**
 * The plaque context for a league: its format, and the best-of of the stage
 * the Pulse section names (`currentStage`), or null when the league has no
 * stage yet.
 */
export function rulesCopyContext({
  league,
  stages,
}: {
  league: Pick<SeasonWithDetails, 'format_type'>;
  stages: readonly Pick<TournamentWithDetails, 'status' | 'best_of_default'>[];
}): RulesCopyContext {
  const stage = currentStage(stages);
  return { format: league.format_type, bestOf: stage?.best_of_default ?? null };
}

/**
 * Where a non-EPB league's full rules live: the league hub's Rules tab (it
 * reads the live ruleset; the world sections add no read for it), scrolled
 * to the hub. The viewer's query (`search`) is kept, `?world=` above all, so
 * the link never changes the world; the overlay and focus params
 * (`panelParams`, and `?rules` always) are dropped, so an open `?rules=gate`
 * overlay closes on the way. `lite` makes it the Lite exit too (`?tier=lite`,
 * route forcing dropped, as the station card's): on the route tier the hub
 * hides with the other sections while the scene is live.
 */
export function rulesHubHref(
  leagueId: string,
  search = '',
  { panelParams = [], lite = false }: { panelParams?: readonly string[]; lite?: boolean } = {},
): string {
  const params = new URLSearchParams(search);
  for (const param of [...panelParams, 'rules']) params.delete(param);
  if (lite) {
    params.delete('routeDebug');
    params.set('tier', 'lite');
  }
  const query: Record<string, string[]> = {};
  for (const [key, value] of params) (query[key] ??= []).push(value);
  return `${leagueHubHref(leagueId, query, 'rules')}#league-hub`;
}

/** Whether the plaque shows the EPB draft numbers (the format decides, never the row). */
export function isPointBuyRules(context: RulesCopyContext): boolean {
  return isEvolutionPointBuy(context.format);
}

/** The format's name in `locale` (the shared `enums.formatType` labels). */
function formatName(context: RulesCopyContext, locale: Locale): string {
  return enumLabel(createTranslator(enumMessages, locale), 'formatType', context.format) || context.format;
}

/**
 * The name the plaques paint as the ruleset of record: the season's (else
 * its first stage's) ruleset, else the league's FORMAT — the rules that
 * actually apply, as the plaza's 'Regelwerk' row already does. It used to
 * fall back to an invented 'League Standard' while the hub's Rules tab said
 * 'No ruleset assigned.' (PR #65 test pass, 5A-3).
 */
export function rulesOfRecordName(rulesetName: string | null, context: RulesCopyContext, locale: Locale = 'en'): string {
  return rulesetName ?? formatName(context, locale);
}

/**
 * What the #rules section and the `?rules=gate` panel add after the ruleset
 * of record when there is none: the hub Rules tab's own finding, never a
 * claimed derivation ('derived from the season, or its first stage' — the
 * fallback had found nothing to derive). In the viewer's language.
 */
export function noRulesetSuffix(locale: Locale = 'en'): string {
  return ` — ${createTranslator(worldClientMessages, locale)('rules.noRuleset')}`;
}

/**
 * Whether a theme plaque row is the banned-moves row (`world-themes`
 * `paint.rules.bannedMoves`, in either language): the DOM surfaces add
 * "banned outright" after its count.
 */
export function isBannedMovesLabel(label: string): boolean {
  return LOCALES.some((locale) => createTranslator(worldThemesMessages, locale)('paint.rules.bannedMoves') === label);
}

/** The English `noRulesetSuffix` (kept for callers and tests that pin the English copy). */
export const NO_RULESET_SUFFIX = noRulesetSuffix('en');

/** The non-EPB "Full rules" sentence before the Rules-tab link, with and without a ruleset. */
export function fullRulesSentence(rulesetName: string | null, locale: Locale = 'en'): string {
  const t = createTranslator(worldClientMessages, locale);
  return rulesetName ? t('rules.fullRulesWithRuleset') : t('rules.fullRulesWithoutRuleset');
}

/**
 * The non-EPB plaque rows: the format and, when the league has a stage, its
 * best-of. `compactRows` is the sakura ledger's one-line-per-pair summary,
 * labelled 'Mode' because 'Format' plus the longest value nearly fills the
 * ledger's floored width.
 */
export function formatRulesRows(
  context: RulesCopyContext,
  locale: Locale = 'en',
): {
  rows: [string, string][];
  compactRows: [string, string][];
} {
  const t = createTranslator(worldClientMessages, locale);
  const format = formatName(context, locale);
  const bestOf: [string, string][] =
    context.bestOf === null ? [] : [[t('rules.bestOfRow'), String(context.bestOf)]];
  return {
    rows: [[t('rules.formatRow'), format], ...bestOf],
    compactRows: [[t('rules.modeRow'), format], ...bestOf],
  };
}
