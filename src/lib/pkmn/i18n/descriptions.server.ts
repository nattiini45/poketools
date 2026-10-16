import 'server-only';
/**
 * German game descriptions for moves, abilities and items (design pkmn-l10n.md §3.6). Server only: the three
 * description maps are 44 KB gzip and are delivered already localized by the server (`client-boundary.test.ts`
 * fails if a `'use client'` module reaches this file).
 *
 * PokeAPI has no German Scarlet/Violet text: the newest German text is Sword/Shield. Entries without German text
 * (SV-new moves, abilities, items) fall back to the English Showdown text. Reviewed SV texts from
 * `scripts/pkmn-i18n/overrides/desc.de.json` are merged into the maps by the generator.
 *
 * Descriptions follow the UI locale, not the data locale (§3.4, §8 O3): a German UI with English Pokémon terms
 * still reads German sentences.
 */
import type { Locale } from '@/i18n/config';
import abilitiesDesc from './data/abilities.desc.de.json';
import itemsDesc from './data/items.desc.de.json';
import movesDesc from './data/moves.desc.de.json';
import { toID } from './id';

export type DescKind = 'move' | 'ability' | 'item';

export interface LocalizedDesc {
  text: string;
  lang: Locale;
  /** 'game': the German in-game text (or a reviewed override); 'showdown': the English Showdown text. */
  source: 'game' | 'showdown';
}

const MAPS: Readonly<Record<DescKind, Readonly<Record<string, string>>>> = {
  move: movesDesc,
  ability: abilitiesDesc,
  item: itemsDesc,
};

const HIDDEN_POWER_ID = 'hiddenpower';

function germanDesc(kind: DescKind, englishName: string): string | undefined {
  const map = MAPS[kind];
  let id = toID(englishName);
  // A typed Hidden Power ("Hidden Power Fire") shares the text of Hidden Power.
  if (kind === 'move' && id.startsWith(HIDDEN_POWER_ID) && !Object.prototype.hasOwnProperty.call(map, id)) {
    id = HIDDEN_POWER_ID;
  }
  if (!id || !Object.prototype.hasOwnProperty.call(map, id)) return undefined;
  return map[id];
}

/**
 * 'de': the German game text, or, if there is none, `englishDesc` marked `lang: 'en'`.
 * 'en': `englishDesc` unchanged. `englishName` is the canonical English name (an id also resolves).
 */
export function localizeDesc(kind: DescKind, englishName: string, englishDesc: string, uiLocale: Locale): LocalizedDesc {
  if (uiLocale === 'de') {
    const german = germanDesc(kind, englishName);
    if (german !== undefined) return { text: german, lang: 'de', source: 'game' };
  }
  return { text: englishDesc, lang: 'en', source: 'showdown' };
}
