import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { legacyFormToDocument } from '@/lib/ruleset-kit/legacy';
import { validateRulesetDocument } from '@/lib/ruleset-kit/validate';
import { convertLegacyRow, resolveEffective, resolveLeagueDefault, type LegacyRow } from './legacy-oracle';

/**
 * The migration rehearsal (opt-in; never part of `npm run test`). `scripts/ruleset-lab/rehearse.sh` replays the local stack
 * to the migration before the Ruleset Studio, loads the legacy fixtures, applies the expand file and the contract file and
 * writes three JSON exports; this test compares what the SQL did with the TypeScript oracle (`legacy-oracle.ts`):
 *
 *   bash scripts/ruleset-lab/rehearse.sh <dir>
 *   RULESET_REHEARSAL_DIR=<dir> npx vitest run src/lib/ruleset-studio/__tests__/ruleset-conversion.local.test.ts
 *
 * Proven here: every legacy ruleset became a definition with ONE published version that keeps the old id, whose frozen
 * rules equal the TypeScript twin of the conversion; every phase and league got the pin the old resolver enforced; the log
 * lists exactly the rows that changed; the contract file changed no pin; ids that need the fold (accents, symbols) were
 * folded the way `toID` folds them.
 */
const DIR = process.env.RULESET_REHEARSAL_DIR;

interface Legacy {
  rulesets: LegacyRow[];
  tournaments: Array<{ id: string; season_id: string | null; bracket_type: string; ruleset_id: string }>;
  seasons: Array<{ id: string; name: string; ruleset_id: string | null }>;
}
interface AfterB1 {
  definitions: Array<{ id: string; slug: string; kind: string; visibility: string; season_id: string | null; owner_id: string | null; current_version_id: string | null; current_draft: unknown }>;
  versions: Array<{ id: string; definition_id: string; version_no: number; name_text: string; spec: Record<string, unknown>; resolved: Record<string, unknown>; catalog_version: string; gen: number; format_key: string; is_doubles: boolean }>;
  tournaments: Array<{ id: string; ruleset_id: string }>;
  seasons: Array<{ id: string; ruleset_id: string | null }>;
  log: Array<{ kind: string; target_id: string; old: string; new: string; step: string }>;
  season_formats: Array<{ season_id: string; preset_rulesets: Record<string, string> }>;
}
interface AfterB2 {
  tournaments: Array<{ id: string; ruleset_id: string }>;
  seasons: Array<{ id: string; ruleset_id: string | null }>;
  legacy_rows: number;
}

const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(DIR as string, file), 'utf8')) as T;

describe.skipIf(DIR === undefined)('Ruleset Studio migration rehearsal (SQL against the TypeScript oracle)', () => {
  const legacy = DIR === undefined ? ({} as Legacy) : read<Legacy>('legacy.json');
  const b1 = DIR === undefined ? ({} as AfterB1) : read<AfterB1>('after-b1.json');
  const b2 = DIR === undefined ? ({} as AfterB2) : read<AfterB2>('after-b2.json');
  const seasonById = new Map((legacy.seasons ?? []).map((s) => [s.id, s] as const));

  it('converts every legacy ruleset into one definition with one published version that keeps the old id', () => {
    expect(b1.versions).toHaveLength(legacy.rulesets.length);
    for (const row of legacy.rulesets) {
      const version = b1.versions.find((v) => v.id === row.id);
      expect(version, row.name).toBeDefined();
      expect(version).toMatchObject({ version_no: 1, catalog_version: 'legacy', name_text: row.name.trim() === '' ? 'Ruleset' : row.name });
      const definition = b1.definitions.find((d) => d.id === version?.definition_id);
      expect(definition?.current_version_id, row.name).toBe(row.id);
      expect(definition?.current_draft).toEqual(version?.spec);
    }
    expect(new Set(b1.definitions.map((d) => d.slug)).size).toBe(b1.definitions.length);
  });

  it('freezes the same rules as the TypeScript twin of the conversion (ids folded like toID)', () => {
    for (const row of legacy.rulesets) {
      const version = b1.versions.find((v) => v.id === row.id);
      expect(version?.resolved, row.name).toEqual(convertLegacyRow(row));
      expect(version).toMatchObject({ gen: (version?.resolved as { gen: number }).gen, format_key: row.base_format.trim() || 'blank', is_doubles: row.is_doubles });
    }
    const typos = b1.versions.find((v) => v.name_text === 'Typos')?.resolved as { pokemon: { ids: string[] } };
    // 'Tapu-Koko', 'Mr Mime', 'Mr. Mime' fold to ids that name real entities; 'Garchmop' is a typo and matches nothing.
    expect(typos.pokemon.ids).toEqual(['farfetchd', 'garchmop', 'hooh', 'mrmime', 'tapukoko']);
    const seeded = b1.versions.find((v) => v.name_text === 'Gen 9 OU')?.resolved as { pokemon: { ids: string[] } };
    expect(seeded.pokemon.ids).toEqual(expect.arrayContaining(['flabebe', 'nidoranf', 'nidoranm', 'typenull', 'tapukoko', 'rotomwash']));
  });

  it('writes a document the validator accepts and the bridge would have written (apart from the empty-constraints object)', () => {
    for (const row of legacy.rulesets) {
      const spec = b1.versions.find((v) => v.id === row.id)?.spec;
      const parsed = validateRulesetDocument(spec);
      // A made-up clause ('Made Up Clause') is a valid id in the document; the compile reports it later.
      expect(parsed.ok, `${row.name}: ${JSON.stringify(parsed)}`).toBe(true);
      const twin = legacyFormToDocument({ ...row, banned_pokemon: row.banned_pokemon, team_constraints: null });
      expect({ ...(spec as object), team_constraints: null }).toEqual(twin);
    }
  });

  it('classifies the seeded rows as preset, the format-attach ruleset as league-owned and private, the rest as gallery', () => {
    const kindOf = (name: string) => b1.definitions.find((d) => d.id === b1.versions.find((v) => v.name_text === name)?.definition_id);
    expect(kindOf('Gen 9 OU')).toMatchObject({ kind: 'preset', visibility: 'gallery', season_id: null });
    expect(kindOf('Core Liga')).toMatchObject({ kind: 'custom', visibility: 'gallery' });
    expect(kindOf('Summer League · Gen 9 OU')).toMatchObject({ kind: 'custom', visibility: 'private', season_id: '20000000-0000-4000-8000-000000000003' });
    // The map the attach recorded now holds the DEFINITION id.
    const recorded = b1.season_formats[0].preset_rulesets.gen9ou;
    expect(recorded).toBe(kindOf('Summer League · Gen 9 OU')?.id);
  });

  it('pins every phase and league to what the old resolver enforced, and logs exactly the rows that changed', () => {
    const expectedTournaments = new Map<string, string>();
    for (const t of legacy.tournaments) {
      const season = t.season_id ? seasonById.get(t.season_id) ?? null : null;
      expectedTournaments.set(t.id, resolveEffective({ ruleset_id: t.ruleset_id, bracket_type: t.bracket_type }, season, legacy.rulesets));
    }
    for (const t of b1.tournaments) expect(t.ruleset_id, t.id).toBe(expectedTournaments.get(t.id));

    for (const s of legacy.seasons) {
      const expected = resolveLeagueDefault({ name: s.name, ruleset_id: s.ruleset_id }, legacy.rulesets);
      expect(b1.seasons.find((x) => x.id === s.id)?.ruleset_id, s.name).toBe(expected);
    }

    const changedPhases = legacy.tournaments.filter((t) => expectedTournaments.get(t.id) !== t.ruleset_id).map((t) => t.id).sort();
    const changedLeagues = legacy.seasons.filter((s) => resolveLeagueDefault({ name: s.name, ruleset_id: s.ruleset_id }, legacy.rulesets) !== s.ruleset_id).map((s) => s.id).sort();
    expect(b1.log.filter((l) => l.kind === 'tournament').map((l) => l.target_id).sort()).toEqual(changedPhases);
    expect(b1.log.filter((l) => l.kind === 'season').map((l) => l.target_id).sort()).toEqual(changedLeagues);
    // The fixtures were built to exercise each branch.
    expect(changedPhases.length).toBeGreaterThanOrEqual(3);
    expect(changedLeagues).toEqual(['20000000-0000-4000-8000-000000000001']);
    for (const entry of b1.log) {
      const original = [...legacy.tournaments, ...legacy.seasons].find((x) => x.id === entry.target_id);
      expect(entry.old).toBe(original?.ruleset_id);
    }
  });

  it('the contract file renames the keys and the table and changes no pin', () => {
    expect(b2.tournaments).toEqual(b1.tournaments);
    expect(b2.seasons).toEqual(b1.seasons);
    expect(b2.legacy_rows).toBe(legacy.rulesets.length);
  });
});
