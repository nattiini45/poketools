import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { achievementsMessages } from '@/i18n/messages/achievements';
import { achievementText } from '@/i18n/content/achievements';

/**
 * The seed insert lives in the pre-baseline migration history, which is maintainers only (private
 * companion overlay, see .gitignore): a public checkout does not have it, so the seed comparison
 * runs only where the file is on disk (same pattern as GAUNTLET_STATEFUL in vitest.config.ts).
 */
const SEED_SQL = join(process.cwd(), 'supabase/migrations-legacy/20260331000000_gamification_tables.sql');

/** (key, name, description) triples of the seed insert (i18n-core §5.2). */
function seedRows(): Array<[string, string, string]> {
  const sql = readFileSync(SEED_SQL, 'utf8');
  const insert = sql.slice(sql.indexOf('insert into achievement_definitions'));
  const rows: Array<[string, string, string]> = [];
  for (const m of insert.matchAll(/\(\s*'([a-z0-9_]+)',\s*'([^']*)',\s*'([^']*)',/g)) {
    rows.push([m[1], m[2], m[3]]);
  }
  return rows;
}

describe('achievements catalog', () => {
  it('holds the 16 seeded achievements, each with a name and a description in both languages', () => {
    const en = achievementsMessages.en as Record<string, { name: string; description: string }>;
    const de = achievementsMessages.de as Record<string, { name: string; description: string }>;
    expect(Object.keys(en)).toHaveLength(16);
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect(en[key].name && en[key].description && de[key].name && de[key].description, key).toBeTruthy();
    }
  });

  it.skipIf(!existsSync(SEED_SQL))('holds every seeded achievement with its seed text verbatim in English', () => {
    const rows = seedRows();
    expect(rows.length).toBe(16);
    const en = achievementsMessages.en as Record<string, { name: string; description: string }>;
    expect(Object.keys(en).sort()).toEqual(rows.map(([key]) => key).sort());
    for (const [key, name, description] of rows) {
      expect(en[key]).toEqual({ name, description });
    }
  });

  it('achievementText translates catalog keys and keeps DB text for unknown keys', () => {
    const seeded = { key: 'first_win', name: 'First Victory', description: 'Win your first match.' };
    expect(achievementText(seeded, 'en')).toEqual({ name: 'First Victory', description: 'Win your first match.' });
    expect(achievementText(seeded, 'de')).toEqual({ name: 'Erster Sieg', description: 'Gewinne dein erstes Spiel.' });

    const custom = { key: 'admin_made', name: 'Admin Made', description: 'Custom.' };
    expect(achievementText(custom, 'de')).toEqual({ name: 'Admin Made', description: 'Custom.' });
  });
});
