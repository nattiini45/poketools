/**
 * Structured KO info and its localized text (design pkmn-l10n.md §3.7). Pure and client-safe.
 *
 * The calc API keeps its English `ko_chance` / `description` (the AI agent and the golden-set eval parse them);
 * PK-5 adds `ko: toKoInfo(kochance)` per result, and displays render `formatKo(r.ko, useLocale(), r.ko_chance)`.
 */
import { INTL_TAG, type Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { pkmnMessages } from '@/i18n/messages/pkmn';

/** `n` = hits to KO (0: no KO in range); `chance` 0..1, null when @smogon/calc could not compute it ("possible"). */
export interface KoInfo {
  n: number;
  chance: number | null;
  /** The KO depends on hazards or end-of-turn damage (the calc text says "after …"). */
  conditional: boolean;
}

/**
 * From @smogon/calc `kochance()` (`{ chance: number | undefined; n; text }`, node_modules/@smogon/calc/dist/desc.d.ts).
 * `null` / `undefined` input gives `null`.
 */
export function toKoInfo(ko: { chance: number | undefined; n: number; text: string } | null | undefined): KoInfo | null {
  if (!ko) return null;
  const n = Number.isFinite(ko.n) && ko.n > 0 ? Math.trunc(ko.n) : 0;
  const chance = typeof ko.chance === 'number' && Number.isFinite(ko.chance) ? ko.chance : null;
  return { n, chance, conditional: /\bafter\b/.test(ko.text) };
}

export type KoLevel = 'guaranteed' | 'likely' | 'possible' | 'unlikely';

/**
 * Severity bucket for KO badges; replaces `parseKoChance` (CalcTab.tsx) with the same thresholds:
 * chance 1 → guaranteed, ≥ 80 % → likely, ≥ 20 % → possible, anything else (incl. no KO and an unknown chance)
 * → unlikely.
 */
export function koLevel(ko: KoInfo | null): KoLevel {
  if (!ko || ko.n <= 0 || ko.chance === null) return 'unlikely';
  if (ko.chance >= 1) return 'guaranteed';
  const percent = ko.chance * 100;
  if (percent >= 80) return 'likely';
  if (percent >= 20) return 'possible';
  return 'unlikely';
}

const percentFormats = new Map<Locale, Intl.NumberFormat>();

function formatPercent(chance: number, l: Locale): string {
  let format = percentFormats.get(l);
  if (!format) {
    format = new Intl.NumberFormat(INTL_TAG[l], { style: 'percent', maximumFractionDigits: 1 });
    percentFormats.set(l, format);
  }
  // Same rounding as @smogon/calc's roundChance: one decimal, clamped to 0.1 % … 99.9 %.
  const tenths = Math.max(Math.min(Math.round(chance * 1000), 999), 1);
  return format.format(tenths / 1000);
}

/** The Showdown KO token: OHKO, 2HKO, 3HKO, … */
function koToken(n: number): string {
  return n === 1 ? 'OHKO' : `${n}HKO`;
}

/**
 * The German phrase for each "after …" item @smogon/calc can name (`getHazards` / `getEndOfTurn`,
 * node_modules/@smogon/calc/dist/desc.js), in the dative that follows "nach". The Pokémon names in them are the
 * official ones from the pkmn data (calc-text.test.ts pins each against `germanMove` / `germanItem` /
 * `germanAbility` / `localizeStatus` / `localizeWeather`), kept literal here so this module stays dictionary-free.
 * Items missing here (G-Max field effects, Steelsurge) get the generic wording below.
 */
export const DE_AFTER_ITEMS: Readonly<Record<string, string>> = {
  'Stealth Rock': 'Tarnsteine',
  Spikes: 'Stachler',
  '1 layer of Spikes': '1 Lage Stachler',
  '2 layers of Spikes': '2 Lagen Stachler',
  '3 layers of Spikes': '3 Lagen Stachler',
  'Dry Skin damage': 'Schaden durch Trockenheit',
  'Solar Power damage': 'Schaden durch Solarkraft',
  'Dry Skin recovery': 'Heilung durch Trockenheit',
  'Rain Dish recovery': 'Heilung durch Regengenuss',
  'sandstorm damage': 'Schaden durch Sandsturm',
  'Ice Body recovery': 'Heilung durch Eishaut',
  'hail damage': 'Schaden durch Hagel',
  'Leftovers recovery': 'Heilung durch Überreste',
  'Black Sludge recovery': 'Heilung durch Giftschleim',
  'Black Sludge damage': 'Schaden durch Giftschleim',
  'Sticky Barb damage': 'Schaden durch Klettdorn',
  'Leech Seed damage': 'Schaden durch Egelsamen',
  'Liquid Ooze damage': 'Schaden durch Kloakensoße',
  'Leech Seed recovery': 'Heilung durch Egelsamen',
  'Grassy Terrain recovery': 'Heilung durch Grasfeld',
  'Poison Heal': 'Aufheber',
  'poison damage': 'Schaden durch Vergiftung',
  'toxic damage': 'Schaden durch schwere Vergiftung',
  'reduced burn damage': 'reduziertem Schaden durch Verbrennung',
  'burn damage': 'Schaden durch Verbrennung',
  'Bad Dreams': 'Alptraum',
  'trapping damage': 'Schaden durch Festhalten',
  'Salt Cure': 'Pökelsalz',
};

/** "nach {items}" and the stand-in for items without a German phrase ("nach Tarnsteine und weiteren Effekten"). */
const DE_AFTER = 'nach';
const DE_AFTER_OTHER = 'weiteren Effekten';

/**
 * The "after …" items of a @smogon/calc KO text, in order and deduplicated: every clause (hazards, end-of-turn
 * damage, recovery), split the way the calc's `serializeText` joins them ("A", "A and B", "A, B, and C").
 * "37.5% chance to 2HKO after Stealth Rock (guaranteed 2HKO after Leftovers recovery)" →
 * ["Stealth Rock", "Leftovers recovery"]. No clause → [].
 */
export function koAfterItems(calcText: string | null | undefined): string[] {
  if (!calcText) return [];
  const items: string[] = [];
  for (const match of calcText.matchAll(/\bafter (.+?)(?=\s*\(|\)|$)/g)) {
    for (const part of match[1].split(/, and |, | and /)) {
      const item = part.trim();
      if (item && !items.includes(item)) items.push(item);
    }
  }
  return items;
}

/** "A", "A und B", "A, B und C". */
function joinDe(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
}

/** The calc's own English text when the caller has it (the API's `ko_chance`); 'N/A' and '' count as missing. */
function usableCalcText(calcText: string | null | undefined): string | null {
  const text = calcText?.trim();
  return text && text !== 'N/A' ? text : null;
}

/**
 * The KO phrase in the UI locale, or "" when there is no KO.
 *
 * Pass the calc's English `ko_chance` as `calcText` wherever the result carries it:
 * - en: the calc text is returned unchanged ("guaranteed 2HKO after Stealth Rock and Leftovers recovery",
 *   "approx. …", "KO in 3 turns", the two-chance "(… after Leftovers recovery)" form), exactly as before i18n.
 * - de: the structured phrase plus the translated "after" items: "garantierter 2HKO nach Tarnsteine und Heilung
 *   durch Überreste"; items without a German phrase become "weiteren Effekten", and with none translatable the
 *   phrase falls back to " (bedingt)".
 * Without `calcText` it renders the structured phrase ("guaranteed OHKO" | "37.5% chance to 2HKO" |
 * "possible 3HKO"; de "garantierter OHKO" | "37,5 % Chance auf 2HKO" | "möglicher 3HKO") plus " (conditional)" /
 * " (bedingt)" when the KO needs hazards or end-of-turn damage.
 */
export function formatKo(ko: KoInfo | null, uiLocale: Locale, calcText?: string | null): string {
  if (!ko || ko.n <= 0) return '';
  const t = createTranslator(pkmnMessages, uiLocale);
  const token = koToken(ko.n);
  let text: string;
  if (ko.chance === null) text = t('ko.possible', { ko: token });
  else if (ko.chance >= 1) text = t('ko.guaranteed', { ko: token });
  else if (ko.chance > 0) text = t('ko.chance', { percent: formatPercent(ko.chance, uiLocale), ko: token });
  else return '';

  const source = usableCalcText(calcText);
  if (uiLocale === 'en' && source) return source;

  const items = koAfterItems(source);
  if (uiLocale === 'de' && items.length > 0) {
    const translated = items.map((item) => DE_AFTER_ITEMS[item]).filter((p): p is string => p !== undefined);
    if (translated.length > 0) {
      if (translated.length < items.length) translated.push(DE_AFTER_OTHER);
      return `${text} ${DE_AFTER} ${joinDe(translated)}`;
    }
  }
  return ko.conditional || items.length > 0 ? t('ko.conditional', { text }) : text;
}
