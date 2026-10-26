import { describe, expect, it } from 'vitest';
import { declaredColumns, lastFunctionBody, replayForeignKeys, replayInsertRevokes, replayTriggers, type ForeignKey } from './fk-replay';

/**
 * The migration-replay guard of the league recycle bin (no database).
 *
 * `league_trash__inventory()`, `league_trash__pointers()`, `league_trash__external_parents()` and
 * `league_trash__restore_plan()` (`supabase/migrations/20261026091000_league_trash.sql`) are THE classification of every
 * table a league reaches. A league delete captures the owned tables and deletes the rest by foreign keys, so a table
 * that gains a foreign key into the league's subtree, or an owned table that gains a foreign key to a new parent, would
 * be deleted without being captured, or restored without a guard, unless somebody classifies it. This test replays every
 * migration and fails until they do. The runtime twin is `league_trash__assert_inventory()`, which aborts a delete
 * before it touches anything.
 */

type Cls = 'owned' | 'derived' | 'kept';
interface Pointer {
  rel: string;
  col: string;
  parent: string;
  relink: boolean;
}
interface PlanStep {
  step: number;
  rel: string;
  filter: string | null;
  defer: string[];
}
interface ExternalParent {
  parent: string;
  protection: 'junction' | 'nulled';
  junction: string | null;
  jcol: string | null;
}

function parseInventory(): Map<string, Cls> {
  const out = new Map<string, Cls>();
  for (const m of lastFunctionBody('league_trash__inventory').matchAll(/\(\s*'([a-z_]+)'\s*,\s*'(owned|derived|kept)'\s*,/g)) {
    out.set(m[1], m[2] as Cls);
  }
  return out;
}

function parsePointers(): Pointer[] {
  return [
    ...lastFunctionBody('league_trash__pointers').matchAll(
      /\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*'[^']*'\s*,\s*(true|false)\s*\)/g,
    ),
  ].map((m) => ({ rel: m[1], col: m[2], parent: m[3], relink: m[4] === 'true' }));
}

function parseExternalParents(): ExternalParent[] {
  return [
    ...lastFunctionBody('league_trash__external_parents').matchAll(
      /\(\s*'([a-z_]+)'\s*,\s*'(junction|nulled)'\s*,\s*(NULL|'[a-z_]+')\s*,\s*(NULL|'[a-z_]+')\s*\)/g,
    ),
  ].map((m) => ({
    parent: m[1],
    protection: m[2] as 'junction' | 'nulled',
    junction: m[3] === 'NULL' ? null : m[3].slice(1, -1),
    jcol: m[4] === 'NULL' ? null : m[4].slice(1, -1),
  }));
}

function parsePlan(): PlanStep[] {
  return [
    ...lastFunctionBody('league_trash__restore_plan').matchAll(
      /\(\s*(\d+)\s*,\s*'([a-z_]+)'\s*,\s*(NULL|'[^']*')\s*,\s*(NULL(?:::text\[\])?|ARRAY\[[^\]]*\])\s*\)/g,
    ),
  ].map((m) => ({
    step: Number(m[1]),
    rel: m[2],
    filter: m[3] === 'NULL' ? null : m[3].slice(1, -1),
    defer: m[4].startsWith('ARRAY') ? [...m[4].matchAll(/'([a-z_]+)'/g)].map((d) => d[1]) : [],
  }));
}

function parseArchiveTables(): string[] {
  return [...lastFunctionBody('league_trash__archive_tables').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

const sorted = (values: Iterable<string>) => [...values].sort();

const FKS = replayForeignKeys();
const FK_LIST = [...FKS.entries()].map(([name, fk]) => ({ name, ...fk }));
const INVENTORY = parseInventory();
const OWNED = new Set([...INVENTORY].filter(([, cls]) => cls === 'owned').map(([rel]) => rel));
const POINTERS = parsePointers();
const EXTERNAL = parseExternalParents();
const PLAN = parsePlan();

/** Tables reachable from `seasons` through foreign keys (a table is reached when it references a reached table). */
function reachedFromSeasons(): Set<string> {
  const reached = new Set<string>();
  const queue = ['seasons'];
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const fk of FK_LIST) {
      if (fk.parent !== parent || fk.child === 'seasons' || reached.has(fk.child)) continue;
      reached.add(fk.child);
      queue.push(fk.child);
    }
  }
  return reached;
}

describe('the replay sees the schema (sanity)', () => {
  it('parses the foreign keys the inventory depends on', () => {
    expect(FKS.get('season_participants_season_id_fkey')?.onDelete).toBe('cascade');
    expect(FKS.get('tournaments_season_id_fkey')?.onDelete).toBe('no action');
    // 20261026091000 swapped the key to SET NULL (DROP + ADD ... NOT VALID).
    expect(FKS.get('player_streaks_last_match_id_fkey')).toEqual({ child: 'player_streaks', parent: 'matches', onDelete: 'set null' });
    // The junction tables restrict.
    expect(FKS.get('league_trash_players_player_id_fkey')).toEqual({ child: 'league_trash_players', parent: 'players', onDelete: 'restrict' });
  });

  it('parses the four lists', () => {
    expect(OWNED.size).toBe(50);
    expect(sorted([...INVENTORY].filter(([, c]) => c === 'derived').map(([r]) => r))).toEqual([
      'aggregate_jobs',
      'aggregates',
      'player_aggregates',
      'rating_history',
    ]);
    expect(sorted([...INVENTORY].filter(([, c]) => c === 'kept').map(([r]) => r))).toEqual(['audit_log', 'draft_action_log']);
    expect(POINTERS.length).toBeGreaterThanOrEqual(7);
    expect(EXTERNAL.map((e) => e.parent)).toContain('players');
    expect(PLAN.length).toBeGreaterThan(OWNED.size);
  });
});

describe('every table the league reaches is classified', () => {
  it('a table that references the league subtree is inventoried or a pointer (a new foreign-key path fails here)', () => {
    const classified = new Set([...INVENTORY.keys(), ...POINTERS.map((p) => p.rel)]);
    const unclassified = sorted([...reachedFromSeasons()].filter((table) => !classified.has(table)));
    expect(unclassified).toEqual([]);
  });

  it('every foreign key from a table outside the inventory into an owned table is a declared pointer', () => {
    const pointerKey = new Set(POINTERS.map((p) => `${p.rel}.${p.parent}`));
    const undeclared = FK_LIST.filter((fk) => OWNED.has(fk.parent) && !INVENTORY.has(fk.child) && !pointerKey.has(`${fk.child}.${fk.parent}`)).map(
      (fk) => fk.name,
    );
    expect(undeclared).toEqual([]);
  });

  it('every pointer is a real foreign key with an action that leaves the outside row in place', () => {
    for (const pointer of POINTERS) {
      const fk = FK_LIST.find(
        (candidate) => candidate.child === pointer.rel && candidate.parent === pointer.parent && candidate.name === `${pointer.rel}_${pointer.col}_fkey`,
      );
      expect(fk, `${pointer.rel}.${pointer.col}`).toBeDefined();
      expect(['set null', 'set default'], `${pointer.rel}.${pointer.col}`).toContain(fk?.onDelete);
    }
  });

  it('an owned table references only owned tables, classified external parents or itself', () => {
    const external = new Set(EXTERNAL.map((e) => e.parent));
    const unknown = FK_LIST.filter((fk) => OWNED.has(fk.child) && !INVENTORY.has(fk.parent) && !external.has(fk.parent)).map(
      (fk) => `${fk.child} -> ${fk.parent}`,
    );
    expect(unknown).toEqual([]);
  });

  it('every protected external parent has a junction table that restricts its delete', () => {
    for (const parent of EXTERNAL.filter((e) => e.protection === 'junction')) {
      const fk = FK_LIST.find((candidate) => candidate.child === parent.junction && candidate.parent === parent.parent);
      expect(fk, parent.parent).toBeDefined();
      expect(fk?.onDelete, parent.parent).toBe('restrict');
      const trashKey = FK_LIST.find((candidate) => candidate.child === parent.junction && candidate.parent === 'league_trash');
      expect(trashKey?.onDelete, `${parent.junction} -> league_trash`).toBe('cascade');
    }
  });
});

describe('tables with no foreign key to the league', () => {
  it('only the known polymorphic tables carry a scope or resource key', () => {
    const polymorphic = new Set([...declaredColumns(/^(?:scope|resource)_(?:type|id)$/).keys()]);
    const known = new Set(['aggregates', 'player_aggregates', 'resource_admins', 'discord_webhooks', 'social_integrations', 'wiki_notes', 'audit_log']);
    expect(sorted([...polymorphic].filter((table) => !known.has(table)))).toEqual([]);
    // ... and every one of them is classified.
    for (const table of known) expect(INVENTORY.has(table), table).toBe(true);
  });

  it('the append-only logs are kept, never captured', () => {
    expect(INVENTORY.get('audit_log')).toBe('kept');
    expect(INVENTORY.get('draft_action_log')).toBe('kept');
  });
});

describe('the restore plan', () => {
  it('visits every owned table, and only owned tables', () => {
    expect(sorted(new Set(PLAN.map((p) => p.rel)))).toEqual(sorted(OWNED));
  });

  it('has unique steps; a table visited twice is the NULL-group pool split', () => {
    expect(new Set(PLAN.map((p) => p.step)).size).toBe(PLAN.length);
    const twice = sorted(PLAN.map((p) => p.rel).filter((rel, i, all) => all.indexOf(rel) !== i));
    expect(twice).toEqual(['draft_pools']);
    expect(PLAN.filter((p) => p.rel === 'draft_pools').map((p) => p.filter)).toEqual(['r.season_group_id IS NULL', 'r.season_group_id IS NOT NULL']);
  });

  it('inserts parents before children (the declared exceptions aside)', () => {
    const first = new Map<string, number>();
    for (const p of PLAN) first.set(p.rel, Math.min(first.get(p.rel) ?? Infinity, p.step));
    const deferred = new Set(PLAN.flatMap((p) => p.defer.map((col) => `${p.rel}_${col}_fkey`)));
    const violations = FK_LIST.filter((fk: ForeignKey & { name: string }) => {
      if (!OWNED.has(fk.child) || !OWNED.has(fk.parent) || fk.child === fk.parent) return false;
      if (deferred.has(fk.name)) return false;
      // Pools without a group come before season_groups on purpose (the group guard only counts non-cancelled pools);
      // such a pool has no group, so its key is not evaluated.
      if (fk.child === 'draft_pools' && fk.parent === 'season_groups') return false;
      return (first.get(fk.child) ?? Infinity) < (first.get(fk.parent) ?? -Infinity);
    }).map((fk) => `${fk.name}: ${fk.child} (${first.get(fk.child)}) before ${fk.parent} (${first.get(fk.parent)})`);
    expect(violations).toEqual([]);
  });

  it('the deferred column is a real key of its table, and the only cycle', () => {
    expect(PLAN.flatMap((p) => p.defer.map((col) => `${p.rel}.${col}`))).toEqual(['redraft_slots.filled_by_pick_id']);
    expect(FKS.get('redraft_slots_filled_by_pick_id_fkey')?.parent).toBe('draft_picks');
  });
});

describe('guard triggers that fire on INSERT of an owned table', () => {
  /**
   * A restore inserts in plan order and no guard is bypassed: the seven triggers below pass because of that order
   * (section "Restore order" of the migration header). A new INSERT trigger on an owned table can break a restore, so it
   * fails this test until somebody reads that section, proves the order still works and adds it here.
   */
  const REVIEWED = [
    'draft_pools.trg_draft_pools_guard_group',
    'evolution_tracker.trg_evolution_tracker_group',
    'rounds.trg_rounds_league_groups_guard',
    'season_group_members.trg_season_group_members_guard',
    'season_groups.trg_season_groups_guard',
    'season_participants.trg_season_participants_group_guard',
    'tournament_groups.trg_tournament_groups_guard_season_group',
  ];

  it('are exactly the reviewed ones', () => {
    const onInsert = [...replayTriggers().entries()].filter(([, t]) => OWNED.has(t.table) && t.events.includes('INSERT')).map(([key]) => key);
    expect(sorted(onInsert)).toEqual(sorted(REVIEWED));
  });

  it('the parser sees triggers (sanity)', () => {
    const all = replayTriggers();
    expect(all.get('teams.trg_teams_completed_match_lock')?.events).toEqual(['UPDATE', 'DELETE']);
    expect(all.get('matches.trg_matches_updated')?.events).toEqual(['UPDATE']);
    expect(all.get('rounds.trg_rounds_league_groups_guard')?.events).toEqual(['INSERT']);
  });
});

describe('owned tables service_role cannot write', () => {
  /**
   * service_role runs the restore (PostgREST), so an owned table whose INSERT was revoked from it (a read-only archive)
   * would fail the restore with "permission denied" and lose the league's rows. Those tables are restored through the
   * owner-rights `league_trash__insert_rows_owner`, which only accepts `league_trash__archive_tables()`.
   */
  it('are exactly the archive tables of the migration', () => {
    const revoked = [...replayInsertRevokes('service_role')].filter((table) => OWNED.has(table));
    expect(sorted(revoked)).toEqual(sorted(parseArchiveTables()));
  });

  it('the parser sees the revoke of the retired trade table (sanity)', () => {
    expect(replayInsertRevokes('service_role').has('redraft_trade_requests')).toBe(true);
  });
});
