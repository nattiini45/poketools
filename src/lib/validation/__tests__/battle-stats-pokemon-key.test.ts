/**
 * The battle_stats one-row-per-Pokémon key: the request schemas' battleStatPokemonKey and the unique index
 * battle_stats_game_player_pokemon_key (20261021100200_battle_stats_pokemon_key_js_trim.sql) must agree, so a writer
 * that skips the schemas cannot store a whitespace-padded twin of a name the schemas would call a repeat. No DB: reads
 * the migration text; the SQL expression was also run on the local stack (Postgres strips exactly these 25 code points).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { adminGameEditSchema, battleStatPokemonKey, manualResultSchema } from '@/lib/validation/schemas';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const FILE = '20261021100200_battle_stats_pokemon_key_js_trim.sql';
const INDEX = 'battle_stats_game_player_pokemon_key';

function stripComments(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.includes('--') ? line.slice(0, line.indexOf('--')) : line))
    .join('\n');
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ file: f, sql: stripComments(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').replace(/\r\n/g, '\n')) }));
const sql = files.find((f) => f.file === FILE)?.sql ?? '';

/** Every regexp_replace pattern literal in the migration (the DO pre-check and the index). */
const patterns = [...sql.matchAll(/regexp_replace\(\s*pokemon_name,\s*'([^']*)',\s*'',\s*'g'\s*\)/g)].map((m) => m[1]);
const pattern = patterns[0] ?? '';

/** The code points of a bracket class written as `\uXXXX` entries and `\uXXXX-\uXXXX` ranges. */
function classCodePoints(cls: string): Set<number> {
  const body = cls.slice(1, -1);
  const out = new Set<number>();
  const re = /\\u([0-9a-f]{4})(?:-\\u([0-9a-f]{4}))?/gy;
  let consumed = 0;
  for (const m of body.matchAll(re)) {
    const from = parseInt(m[1], 16);
    const to = m[2] ? parseInt(m[2], 16) : from;
    for (let c = from; c <= to; c++) out.add(c);
    consumed += m[0].length;
  }
  expect(consumed).toBe(body.length);
  return out;
}

/** The index key as Postgres computes it: the SQL ARE pattern is also valid JS regex syntax. */
const dbKey = (name: string) => name.replace(new RegExp(pattern, 'g'), '').toLowerCase();

const ch = (code: number) => String.fromCharCode(code);
const isBmpNonSurrogate = (c: number) => c < 0xd800 || c > 0xdfff;

describe(FILE, () => {
  it('rebuilds the index under its existing name with the regexp key, and the pre-check uses the same key', () => {
    expect(sql).toMatch(new RegExp(`DROP INDEX IF EXISTS public\\.${INDEX};`));
    expect(sql).toMatch(new RegExp(`CREATE UNIQUE INDEX ${INDEX}\\s+ON public\\.battle_stats \\(game_id, player_id,\\s+lower\\(regexp_replace\\(`));
    expect(sql).toMatch(/RAISE EXCEPTION/);
    expect(sql).not.toMatch(/btrim/);
    expect(patterns).toHaveLength(2);
    expect(patterns[1]).toBe(pattern);
  });

  it('is the latest migration that defines the index', () => {
    const definers = files.filter((f) => f.sql.includes(`UNIQUE INDEX IF NOT EXISTS ${INDEX}`) || f.sql.includes(`UNIQUE INDEX ${INDEX}`));
    expect(definers.at(-1)?.file).toBe(FILE);
  });

  it('strips, at both ends, exactly the code points String.prototype.trim strips', () => {
    const m = /^\^(\[[^\]]+\])\+\|(\[[^\]]+\])\+\$$/.exec(pattern);
    expect(m).not.toBeNull();
    const [, leading, trailing] = m as RegExpExecArray;
    expect(trailing).toBe(leading);
    const set = classCodePoints(leading);
    const mismatches: string[] = [];
    for (let c = 0; c <= 0xffff; c++) {
      if (!isBmpNonSurrogate(c)) continue;
      if (set.has(c) !== (ch(c).trim() === '')) mismatches.push(c.toString(16));
    }
    expect(mismatches).toEqual([]);
    expect(set.size).toBe(25);
  });

  it('gives the same key as battleStatPokemonKey for padded and unpadded names', () => {
    const pads = [...Array(0x10000).keys()].filter((c) => isBmpNonSurrogate(c) && ch(c).trim() === '').map(ch);
    const names = ['Pikachu', 'Mr. Mime', 'Farfetch’d', 'Flabébé', 'pikachu', `Pi${ch(0x09)}kachu`, `${ch(0x85)}Pikachu`];
    for (const name of names) {
      expect(dbKey(name)).toBe(battleStatPokemonKey(name));
      for (const pad of pads) {
        expect(dbKey(`${pad}${name}${pad}${pad}`)).toBe(battleStatPokemonKey(`${pad}${name}${pad}${pad}`));
      }
    }
    // NEL (U+0085) is not JS whitespace: both keys keep it, so it names a different Pokémon on both sides.
    expect(dbKey(`${ch(0x85)}Pikachu`)).not.toBe(dbKey('Pikachu'));
  });
});

describe('battleStatPokemonKey in the request schemas', () => {
  const MATCH_ID = '12345678-1234-4123-8123-123456789abc';
  const P1_ID = '11111111-1111-4111-8111-111111111111';
  const P2_ID = '22222222-2222-4222-8222-222222222222';
  const padded = `${ch(0x09)}${ch(0xa0)}PIKACHU${ch(0x3000)}${ch(0xfeff)}`;

  const manual = (names: string[]) => ({
    match_id: MATCH_ID,
    winner_id: P1_ID,
    pokemon_stats: [
      { player_id: P1_ID, pokemon: names.map((pokemon_name) => ({ pokemon_name })) },
      { player_id: P2_ID, pokemon: [{ pokemon_name: 'Charizard' }] },
    ],
  });

  it('manual result refuses a tab / no-break-space padded repeat, as the index would', () => {
    const result = manualResultSchema.safeParse(manual(['Pikachu', padded]));
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ message: 'Each Pokémon may appear only once per player' })
    );
  });

  it('manual result accepts a NEL-prefixed name beside the plain one, as the index would', () => {
    expect(manualResultSchema.safeParse(manual(['Pikachu', `${ch(0x85)}Pikachu`])).success).toBe(true);
  });

  it('admin game edit refuses a padded repeat for one player and accepts it across players', () => {
    const rows = (second: string) => [
      { player_id: P1_ID, pokemon_name: 'Pikachu' },
      { player_id: second, pokemon_name: padded },
    ];
    expect(adminGameEditSchema.safeParse({ battle_stats: rows(P1_ID) }).success).toBe(false);
    expect(adminGameEditSchema.safeParse({ battle_stats: rows(P2_ID) }).success).toBe(true);
  });
});
