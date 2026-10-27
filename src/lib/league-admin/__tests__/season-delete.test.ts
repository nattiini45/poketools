import { describe, expect, it } from 'vitest';
import {
  SEASON_DELETE_DERIVED,
  SEASON_DELETE_GROUPS,
  SEASON_DELETE_KEPT,
  SEASON_DELETE_NOT_RELINKED,
  SEASON_DELETE_OWNED,
  SEASON_DELETE_UNLINKS,
  SEASON_DELETE_UNNAMED_OWNED,
} from '../season-delete';
import { lastFunctionBody, replayForeignKeys } from '@/lib/league-trash/__tests__/fk-replay';

/**
 * Keeps `season-delete.ts` (the Danger tab's description of a league delete) equal to the league recycle bin's SQL
 * inventory: the LAST definition of `league_trash__inventory()` (owned / derived / kept) and `league_trash__pointers()`
 * (rows outside the league that point into it), read from the migrations without a database.
 */

type Cls = 'owned' | 'derived' | 'kept';

function inventory(): Map<string, Cls> {
  const out = new Map<string, Cls>();
  for (const m of lastFunctionBody('league_trash__inventory').matchAll(/\(\s*'([a-z_]+)'\s*,\s*'(owned|derived|kept)'\s*,/g)) {
    out.set(m[1], m[2] as Cls);
  }
  return out;
}

function pointers(): { rel: string; relink: boolean }[] {
  return [
    ...lastFunctionBody('league_trash__pointers').matchAll(
      /\(\s*'([a-z_]+)'\s*,\s*'[a-z_]+'\s*,\s*'[a-z_]+'\s*,\s*'[^']*'\s*,\s*(true|false)\s*\)/g,
    ),
  ].map((m) => ({ rel: m[1], relink: m[2] === 'true' }));
}

const sorted = (values: Iterable<string>) => [...values].sort();
const ofClass = (cls: Cls) => [...inventory()].filter(([, c]) => c === cls).map(([rel]) => rel);

describe('season delete description (from the league trash inventory)', () => {
  it('the parser sees the inventory (sanity)', () => {
    expect(inventory().get('seasons')).toBe('owned');
    expect(inventory().get('battle_stats')).toBe('owned');
    expect(inventory().get('aggregates')).toBe('derived');
    expect(inventory().get('audit_log')).toBe('kept');
    expect(pointers().length).toBeGreaterThanOrEqual(7);
  });

  it('every owned table is listed exactly once (named groups + unnamed)', () => {
    const listed = [...Object.values(SEASON_DELETE_OWNED).flat(), ...SEASON_DELETE_UNNAMED_OWNED];
    expect(new Set(listed).size).toBe(listed.length);
    expect(sorted(listed)).toEqual(sorted(ofClass('owned')));
  });

  it('the hint groups are exactly the keys of the owned map, and none is empty', () => {
    expect(sorted(SEASON_DELETE_GROUPS)).toEqual(sorted(Object.keys(SEASON_DELETE_OWNED)));
    for (const group of SEASON_DELETE_GROUPS) expect(SEASON_DELETE_OWNED[group].length, group).toBeGreaterThan(0);
  });

  it('the derived and the kept tables are exactly the inventory classes', () => {
    expect(sorted(SEASON_DELETE_DERIVED)).toEqual(sorted(ofClass('derived')));
    expect(sorted(SEASON_DELETE_KEPT)).toEqual(sorted(ofClass('kept')));
  });

  it('the unlinked tables are exactly the tables of the pointers; the not-relinked ones exactly the relink=false pointers', () => {
    const rels = pointers();
    expect(sorted(SEASON_DELETE_UNLINKS)).toEqual(sorted(new Set(rels.map((p) => p.rel))));
    expect(sorted(SEASON_DELETE_NOT_RELINKED)).toEqual(sorted(new Set(rels.filter((p) => !p.relink).map((p) => p.rel))));
    for (const rel of SEASON_DELETE_NOT_RELINKED) expect(SEASON_DELETE_UNLINKS).toContain(rel);
  });

  it('no table is both deleted with the league and left behind by it', () => {
    const owned = new Set(ofClass('owned'));
    expect(SEASON_DELETE_DERIVED.filter((rel) => owned.has(rel))).toEqual([]);
    expect(SEASON_DELETE_KEPT.filter((rel) => owned.has(rel))).toEqual([]);
  });

  it('the replay still sees the foreign keys the trash depends on (the delete is never blocked by them)', () => {
    // The four former blockers are owned tables now: captured, deleted in order, restored.
    const fks = replayForeignKeys();
    for (const table of ['tournaments', 'draft_pools', 'teams', 'season_storylines']) {
      expect(fks.get(`${table}_season_id_fkey`)?.parent, table).toBe('seasons');
      expect(ofClass('owned'), table).toContain(table);
    }
  });
});
