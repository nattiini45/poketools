import type { PokemonSet } from '@/types/team';
import { formatStatSpread, hasCustomIv, hasEv } from './stat-spread';

/** Showdown paste text: always English (it is import/export text). */
export function formatShowdownSet(set: PokemonSet): string {
  const lines: string[] = [];
  const name = set.name || set.species;

  // Header: Name (Species) @ Item
  let header = name !== set.species ? `${name} (${set.species})` : set.species;
  if (set.item) header += ` @ ${set.item}`;
  lines.push(header);

  if (set.ability) lines.push(`Ability: ${set.ability}`);
  if (set.tera_type) lines.push(`Tera Type: ${set.tera_type}`);
  if (set.level && set.level !== 100) lines.push(`Level: ${set.level}`);

  if (set.evs) {
    const evParts = formatStatSpread(set.evs, hasEv, 'en');
    if (evParts) lines.push(`EVs: ${evParts}`);
  }

  if (set.nature) lines.push(`${set.nature} Nature`);

  if (set.ivs) {
    const ivParts = formatStatSpread(set.ivs, hasCustomIv, 'en');
    // i18n-ignore: Showdown paste syntax stays English
    if (ivParts) lines.push(`IVs: ${ivParts}`);
  }

  if (set.moves) {
    for (const move of set.moves) {
      if (move) lines.push(`- ${move}`);
    }
  }

  return lines.join('\n');
}