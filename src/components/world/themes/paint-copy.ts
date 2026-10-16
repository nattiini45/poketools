/**
 * The isle themes' painted vocabulary (T21, i18n D11): every word the
 * sakura, mountain and clouds painters put on a canvas comes from the
 * `world-themes` namespace through these helpers, in the viewer's locale.
 *
 * Pure and client-safe (no React, no three): the painters in each theme's
 * `content/paint.ts` and the DOM section copy import it. Messages are stored
 * in sentence case; `paintText` upper-cases the template OUTSIDE its
 * placeholders (`upperForPaint`, so `ß` → `SS`), so a trainer or league name
 * passed as a param keeps the case the caller gave it — exactly what the
 * English literals did before (`LIVE · ${pair}`).
 */
import type { Locale } from '@/i18n/config';
import { createTranslator, getMessages, interpolate, isPluralForms, lookupPath, selectPlural, upperForPaint } from '@/i18n/core';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import type worldThemesEn from '@/i18n/messages/world-themes/en';
import type { ArgsFor, At, Leaves, ParamValue } from '@/i18n/types';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import { kickoffTickerState, livePair, priceBandLabel, type KickoffTickerSource } from '@/lib/route-world/board-text';
import type { WorldRosterTile } from '@/lib/worlds/route-data';
import { epbPack } from '@/lib/format-pack';
import type { FormatRules, TeraRules } from '@/types/format-rules';
import { formatRulesRows, isPointBuyRules, rulesOfRecordName } from '@/components/world/sections/rules-context';
import type { RulesCopyContext } from '@/components/world/sections/types';

type PaintMessages = (typeof worldThemesEn)['paint'];
/** A dotted key under `world-themes.paint`. */
export type PaintKey = Leaves<PaintMessages>;

/** The `world-themes` translator (memoized per locale by `createTranslator`). */
export function themeT(locale: Locale) {
  return createTranslator(worldThemesMessages, locale);
}

const PLACEHOLDER = /^\{[A-Za-z0-9_]+\}$/;

/** Upper-case a template everywhere except inside its `{param}` placeholders. */
function upperOutsidePlaceholders(template: string, locale: Locale): string {
  return template
    .split(/(\{[A-Za-z0-9_]+\})/)
    .map((part) => (PLACEHOLDER.test(part) ? part : upperForPaint(part, locale)))
    .join('');
}

/**
 * A painted word or line: the `world-themes.paint` message in `locale`,
 * upper-cased for the canvas, then interpolated (numbers formatted per
 * locale, string params kept as given).
 */
export function paintText<K extends PaintKey>(locale: Locale, key: K, ...args: ArgsFor<At<PaintMessages, K>>): string {
  const params = args[0] as Readonly<Record<string, ParamValue>> | undefined;
  const leaf = lookupPath(getMessages(worldThemesMessages, locale).paint, key);
  let template: string = key;
  if (typeof leaf === 'string') template = leaf;
  else if (isPluralForms(leaf)) template = selectPlural(leaf, typeof params?.count === 'number' ? params.count : 0, locale);
  return interpolate(upperOutsidePlaceholders(template, locale), params, locale);
}

// ── Fixture status ──────────────────────────────────────────────────

/** The three pills a fixture shows. */
export type FixtureStatusKey = 'open' | 'live' | 'done';

/**
 * `BoardContent` fixture statuses (the neutral keys `upcoming` / `live` /
 * `done`, i18n-core §7 step 5) → pill keys.
 */
const FIXTURE_STATUS_KEYS: Readonly<Record<string, FixtureStatusKey>> = {
  upcoming: 'open',
  live: 'live',
  done: 'done',
};

export function fixtureStatusKey(status: string): FixtureStatusKey | null {
  return FIXTURE_STATUS_KEYS[status] ?? null;
}

/** Whether a fixture is being played right now. */
export function isLiveFixture(status: string): boolean {
  return fixtureStatusKey(status) === 'live';
}

/** The typed status as its painted pill — never the raw logic word. */
export function statusPill(status: string, locale: Locale): string {
  const key = fixtureStatusKey(status);
  return key ? paintText(locale, `status.${key}`) : upperForPaint(status, locale);
}

/** The pill word the shared line painters fill (`LIVE` in both languages today). */
export function livePillWord(locale: Locale): string {
  return paintText(locale, 'status.live');
}

/** `LIVE` pill test for a painted line, in the painter's own language. */
export function hasLivePill(text: string, locale: Locale): boolean {
  const word = livePillWord(locale);
  return text.split(/\s+/).includes(word);
}

// ── Kickoff ticker and footer stamps ────────────────────────────────

/**
 * The isles' kickoff line (the shared ticker order, board-text.ts):
 * `LIVE · SKYE – TIDE` or `NEXT KICKOFF · 9/24 18:00`; null when neither
 * holds. The narrow cloths pass `liveMatchPair`.
 */
export function kickoffLine<K extends { readonly iso: string; readonly date: string; readonly time: string }>(
  source: KickoffTickerSource<K>,
  nowMs: number,
  locale: Locale,
  pair: (home: string, away: string) => string = livePair,
): string | null {
  const state = kickoffTickerState(source, nowMs);
  if (!state) return null;
  if (state.kind === 'live') return paintText(locale, 'kickoffLive', { pair: pair(state.home, state.away) });
  return paintText(locale, 'kickoffNext', { date: state.kickoff.date, time: state.kickoff.time });
}

/** The footer stamp's source: the ticker plus the league counts. */
export interface StampSource<K extends { readonly iso: string; readonly date: string; readonly time: string }>
  extends KickoffTickerSource<K> {
  readonly completed: number;
  readonly participants: number;
}

/**
 * `NEXT KICKOFF · 9/17 18:00 · 8 TRAINERS`, else `12 MATCHES PLAYED · 8
 * TRAINERS` (`matchesFlown` on the isles).
 */
export function leagueStamp<K extends { readonly iso: string; readonly date: string; readonly time: string }>(
  content: StampSource<K>,
  nowMs: number,
  locale: Locale,
  played: 'matchesPlayed' | 'matchesFlown' = 'matchesPlayed',
): string {
  const trainers = paintText(locale, 'trainers', { count: content.participants });
  const line = kickoffLine(content, nowMs, locale);
  if (!line) return `${paintText(locale, played, { count: content.completed })} · ${trainers}`;
  return `${line} · ${trainers}`;
}

/**
 * A stage name as the boards paint it, in the viewer's language. The stage
 * is stored in English (the engines' names); German reads the halves as
 * `HINRUNDE` / `RÜCKRUNDE` and every other engine name through
 * `translateEngineLabel`. English stays the stored text, upper-cased.
 */
export function paintStageName(stage: string, locale: Locale): string {
  if (locale !== 'en') {
    const trimmed = stage.trim();
    if (/^first half$/i.test(trimmed)) return paintText(locale, 'firstHalf');
    if (/^second half$/i.test(trimmed)) return paintText(locale, 'secondHalf');
  }
  return upperForPaint(translateEngineLabel('round', stage, locale), locale);
}

/** `SECOND HALF · MATCHDAY 2` (`RÜCKRUNDE · SPIELTAG 2`) — the boards' kicker detail. */
export function stageMatchdayLine(stage: string, round: number | string, locale: Locale): string {
  return `${paintStageName(stage, locale)} · ${paintText(locale, 'matchday', { n: round })}`;
}

/** `▲2` / `▼1` / '' — the rank-movement suffix the cloth rows carry. */
function rankMoveSuffix(rankChange: number | null): string {
  if (!rankChange) return '';
  return rankChange > 0 ? ` ▲${rankChange}` : ` ▼${-rankChange}`;
}

/** `12 PTS ▲2` — a standing row's detail. */
export function standingDetail(points: number, rankChange: number | null, locale: Locale): string {
  return `${paintText(locale, 'standingPoints', { points })}${rankMoveSuffix(rankChange)}`;
}

// ── Roster tiles ────────────────────────────────────────────────────

/**
 * A roster tile's painted name: a point-buy line's base species in the
 * viewer's data locale (the stored value stays English). A tile without a
 * price may carry a trainer's name, which is never run through the
 * species dictionary.
 */
export function rosterTileName(tile: Pick<WorldRosterTile, 'name' | 'price'>, dataLocale: Locale): string {
  return tile.price !== null ? localizeSpecies(tile.name, dataLocale) : tile.name;
}

/**
 * A roster tile's band line: `27 PTS · PREMIUM` (a point-buy line; `plain`
 * drops the mid-dot for the mountain frieze's tighter budget), else the
 * trainer's gym band (`FIRE GYM`, `OPEN GYM`).
 */
export function rosterBandLine(
  tile: Pick<WorldRosterTile, 'band' | 'price'>,
  locale: Locale,
  dataLocale: Locale,
  form: 'dot' | 'plain' = 'dot',
): string {
  if (tile.price !== null) {
    return paintText(locale, form === 'dot' ? 'priceBand' : 'priceBandPlain', {
      price: tile.price,
      band: priceBandLabel(tile.band, locale),
    });
  }
  if (tile.band.toLowerCase() === 'open') return paintText(locale, 'openGym');
  return paintText(locale, 'gym', { type: upperForPaint(localizeType(tile.band, dataLocale), locale) });
}

// ── Rules plaques ───────────────────────────────────────────────────

/** Plaque title per theme. */
export type RulesTitleKey = 'rules.titlePark' | 'rules.titlePass' | 'rules.titleIsles';

/** The plaque copy every isle plaque painter shapes (DOM rows stay sentence case). */
export interface ThemePlaqueCopy {
  title: string;
  rulesetName: string;
  rows: [string, string][];
  compactRows: [string, string][];
  note: string | null;
}

/**
 * The ruleset of record: the season's (else its first stage's) ruleset,
 * else the league's format label — the rules that actually apply.
 */
export function themeRulesOfRecordName(rulesetName: string | null, context: RulesCopyContext, locale: Locale): string {
  return rulesOfRecordName(rulesetName, context, locale);
}

/** The Tera word of a stage-1 rule. */
export function teraWord(stage1: TeraRules[keyof TeraRules], locale: Locale): string {
  const t = themeT(locale);
  if (stage1 === 'any') return t('paint.rules.teraFree');
  if (stage1 === 'stab_only') return t('paint.rules.teraStab');
  return t('paint.rules.teraNone');
}

/**
 * Plaque copy from the contract's rules fields — pure shaping. The format
 * decides the rows: Evolution Point Buy carves the draft numbers (its row,
 * else the league defaults with the defaults note); every other format its
 * format and best-of (`compactRows` label it 'Mode'), with no note.
 */
export function themePlaqueCopy(
  formatRules: FormatRules | null,
  rulesetName: string | null,
  context: RulesCopyContext,
  locale: Locale,
  options: { titleKey: RulesTitleKey; linesLabel: 'linesPerTrainer' | 'linesEach' },
): ThemePlaqueCopy {
  const t = themeT(locale);
  const title = paintText(locale, options.titleKey);
  const recordName = themeRulesOfRecordName(rulesetName, context, locale);
  if (!isPointBuyRules(context)) {
    // The DOM rules rows (`formatRulesRows`) word these identically in both
    // languages; one source keeps plaque and panel from drifting.
    const { rows, compactRows } = formatRulesRows(context, locale);
    return { title, rulesetName: recordName, rows, compactRows, note: null };
  }
  const defaults = epbPack.defaults;
  const tera = teraWord((formatRules?.tera_rules ?? epbPack.teraByStage).stage1, locale);
  const budget = t('paint.rules.budgetValue', { points: formatRules?.draft_budget ?? defaults.draftBudget });
  const picks = String(formatRules?.draft_picks ?? defaults.draftPicks);
  const banned = String((formatRules?.banned_moves ?? defaults.bannedMoves).length);
  return {
    title,
    rulesetName: recordName,
    rows: [
      [t('paint.rules.draftBudget'), budget],
      [t(`paint.rules.${options.linesLabel}`), picks],
      [t('paint.rules.teraStage1'), tera],
      [t('paint.rules.bannedMoves'), banned],
    ],
    compactRows: [
      [t('paint.rules.compactDraft'), budget],
      [t('paint.rules.compactLines'), picks],
      [t('paint.rules.compactTera'), tera],
      [t('paint.rules.compactBanned'), banned],
    ],
    note: formatRules ? null : t('paint.rules.defaultsNote'),
  };
}
