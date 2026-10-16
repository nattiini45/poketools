/**
 * Achievement text by stable key (i18n-core §5.2). The `achievements`
 * namespace (owned by T02) is keyed by `achievement_definitions.key` with
 * `{ name, description }` values; admin-created achievements that have no
 * catalog entry show their DB text. T17 uses the same function for Discord.
 */
import type { Locale } from '../config';
import { getMessages, lookupPath } from '../core';
import { achievementsMessages } from '../messages/achievements';

export interface AchievementTextSource {
  key: string;
  name: string;
  description: string;
}

function catalogString(tree: unknown, key: string, field: 'name' | 'description'): string | undefined {
  if (typeof tree !== 'object' || tree === null) return undefined;
  if (!Object.prototype.hasOwnProperty.call(tree, key)) return undefined;
  const value = lookupPath((tree as Record<string, unknown>)[key], field);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function achievementText(def: AchievementTextSource, locale: Locale): { name: string; description: string } {
  const localized: unknown = getMessages(achievementsMessages, locale);
  const english: unknown = achievementsMessages.en;
  return {
    name: catalogString(localized, def.key, 'name') ?? catalogString(english, def.key, 'name') ?? def.name,
    description:
      catalogString(localized, def.key, 'description') ??
      catalogString(english, def.key, 'description') ??
      def.description,
  };
}
