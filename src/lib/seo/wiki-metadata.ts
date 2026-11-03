import 'server-only';
import type { Metadata } from 'next';
import { getDataLocale, getLocale, getT } from '@/i18n/server';
import { metaMessages } from '@/i18n/messages/meta';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import {
  getWikiAbilityDetail,
  getWikiItemDetail,
  getWikiMoveDetail,
  getWikiSpeciesDetail,
  getWikiTypeMatchups,
  resolveWikiTeraType,
} from '@/lib/wiki/index-rows.server';
import { localizeWikiEntry } from '@/lib/wiki/localize-entry.server';

/**
 * Titles and descriptions of the wiki detail pages. Everything here comes from the memoised, locale-neutral wiki
 * data (no database read), so a request pays nothing for its metadata. An unknown name returns `{}`: the page
 * itself calls `notFound()`, and the 404 must not carry the title of an entity that does not exist.
 *
 * A title is the entity's own name; the root layout's title template adds the brand.
 */

const DESCRIPTION_MAX = 200;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= DESCRIPTION_MAX ? flat : `${flat.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…`;
}

export async function speciesMetadata(rawName: string): Promise<Metadata> {
  const species = getWikiSpeciesDetail(rawName);
  if (!species) return {};
  const [t, dataLocale] = await Promise.all([getT(metaMessages), getDataLocale()]);
  const name = localizeSpecies(species.name, dataLocale);
  const types = species.types.map((type) => localizeType(type, dataLocale)).join('/');
  return { title: name, description: clip(t('entity.pokemonDescription', { name, types })) };
}

export async function moveMetadata(rawName: string): Promise<Metadata> {
  const move = getWikiMoveDetail(rawName);
  if (!move) return {};
  const [t, locale, dataLocale] = await Promise.all([getT(metaMessages), getLocale(), getDataLocale()]);
  const name = localizeMove(move.name, dataLocale);
  const { entry } = localizeWikiEntry('move', move, locale);
  const summary = entry.shortDesc || entry.description;
  return {
    title: name,
    description: clip(
      summary
        ? t('entity.summaryDescription', { name, summary })
        : t('entity.moveDescription', { name, type: localizeType(move.type, dataLocale) }),
    ),
  };
}

export async function abilityMetadata(rawName: string): Promise<Metadata> {
  const ability = getWikiAbilityDetail(rawName);
  if (!ability) return {};
  const [t, locale, dataLocale] = await Promise.all([getT(metaMessages), getLocale(), getDataLocale()]);
  const name = localizeAbility(ability.name, dataLocale);
  const { entry } = localizeWikiEntry('ability', ability, locale);
  const summary = entry.shortDesc || entry.description;
  return {
    title: name,
    description: clip(
      summary ? t('entity.summaryDescription', { name, summary }) : t('entity.abilityDescription', { name }),
    ),
  };
}

export async function itemMetadata(rawName: string): Promise<Metadata> {
  const item = getWikiItemDetail(rawName);
  if (!item) return {};
  const [t, locale, dataLocale] = await Promise.all([getT(metaMessages), getLocale(), getDataLocale()]);
  const name = localizeItem(item.name, dataLocale);
  const { entry } = localizeWikiEntry('item', item, locale);
  const summary = entry.shortDesc || entry.description;
  return {
    title: name,
    description: clip(
      summary ? t('entity.summaryDescription', { name, summary }) : t('entity.itemDescription', { name }),
    ),
  };
}

export async function teraMetadata(rawType: string): Promise<Metadata> {
  const resolved = resolveWikiTeraType(rawType);
  if (!resolved || !getWikiTypeMatchups(resolved)) return {};
  const [t, dataLocale] = await Promise.all([getT(metaMessages), getDataLocale()]);
  const type = localizeType(resolved, dataLocale);
  return { title: t('entity.teraTitle', { type }), description: clip(t('entity.teraDescription', { type })) };
}
