/**
 * A page that lists or opens match, tournament, team, round, game, cast-session, wiki-note or broadcast-moment
 * data reads a store that the phase separation splits in two. Such a page must pick a generation: by mode
 * (`getPhaseRouteMode`), by the owner of the id it was asked for (`resolveIdOnlyMatchRoute`,
 * `resolveIdOnlyTeamRoute`, `resolveIdOnlyCompetitionRoute`), by asking a reader for the phase store
 * (`storage: 'phase'`), or by handing the phase session to a client that opens it (`openPhaseSession`). A page
 * that does none of those reads the legacy generation always, which is how `/content` kept listing only legacy
 * matches after every other match surface had been bound (see the P6 handoff).
 *
 * The guard is a source walk over `src/app/**\/page.tsx`. A page that imports one of the migrated families'
 * legacy readers and shows none of the three signals must be listed in `LEGACY_BY_DESIGN` with its reason, so a
 * new surface of this kind is a decision rather than an oversight. Route handlers are not walked here: their
 * storage choice is covered by the per-slice route tests and by the route manifest's guard/schema records.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_DIR = path.resolve(__dirname, '../../../app');

/** Query modules whose data moves in P6. Each has a `phase-` counterpart except `tournaments`, whose phases are `league_phases`. */
const MIGRATED_LEGACY_MODULES = [
  'matches',
  'tournaments',
  'teams',
  'rounds',
  'games',
  'cast-sessions',
  'wiki-notes',
  'broadcast-moments',
] as const;

/**
 * Any one of the ways a surface picks its generation: by mode, by the owner of the id it was asked for (a match, a
 * team, a competition), by asking a reader for the phase store, or by handing the phase session to a client that opens
 * it (`openPhaseSession`, the broadcast tracker).
 */
const DISPATCH = /getPhaseRouteMode|requireOpenPhaseRouteMode|isPhaseRouteModeEnabled|resolveIdOnlyMatchRoute|resolveIdOnlyTeamRoute|resolveIdOnlyCompetitionRoute|openPhaseSession|storage: 'phase'|phaseStorage/;

/**
 * Pages that read a migrated family's legacy store on purpose. Each entry names why, and the test fails if an
 * entry stops being needed, so the list cannot rot into a blanket exemption.
 */
const LEGACY_BY_DESIGN: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: 'admin/tournaments/page.tsx',
    reason: 'Legacy standalone tournament list. League phases are administered under /admin/leagues/[id]/phases/[phaseId].',
  },
  {
    file: 'admin/tournaments/archived/page.tsx',
    reason: 'Legacy standalone tournament archive; a phase is archived from its league, not from a tournament list.',
  },
  {
    file: 'admin/tournaments/[id]/rounds/page.tsx',
    reason: 'Legacy standalone round admin; a phase manages its rounds through its own phase admin page.',
  },
  {
    file: 'admin/kale/page.tsx',
    reason: 'Internal admin tool that reads legacy tournaments directly; it has no user-facing phase counterpart.',
  },
  {
    file: 'admin/matches/[id]/import-replay/page.tsx',
    reason: 'Legacy match replay import page. A native match is imported through its phase parse-replay route, so this page stays legacy.',
  },
];

function pages(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') pages(full, found);
    } else if (entry === 'page.tsx') {
      found.push(full);
    }
  }
  return found;
}

function legacyImport(src: string): string | null {
  for (const mod of MIGRATED_LEGACY_MODULES) {
    if (src.includes(`@/lib/supabase/queries/${mod}'`)) return mod;
  }
  return null;
}

describe('page storage scope', () => {
  const rows = pages(APP_DIR).flatMap((full) => {
    const src = readFileSync(full, 'utf8');
    const mod = legacyImport(src);
    if (!mod) return [];
    const file = path.relative(APP_DIR, full).split(path.sep).join('/');
    return [{ file, mod, dispatched: DISPATCH.test(src) }];
  });

  it('walks the page tree', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('a page reading a migrated legacy store picks a generation, or says why it does not', () => {
    const allowed = new Set(LEGACY_BY_DESIGN.map((entry) => entry.file));
    const undecided = rows
      .filter((row) => !row.dispatched && !allowed.has(row.file))
      .map((row) => `${row.file} (reads ${row.mod})`);
    expect(undecided).toEqual([]);
  });

  it('every legacy-by-design entry is still needed', () => {
    const stale = LEGACY_BY_DESIGN.filter((entry) => {
      const row = rows.find((candidate) => candidate.file === entry.file);
      return !row || row.dispatched;
    }).map((entry) => entry.file);
    expect(stale).toEqual([]);
  });

  it('every legacy-by-design entry gives a reason', () => {
    const missing = LEGACY_BY_DESIGN.filter((entry) => entry.reason.trim().length < 20).map((entry) => entry.file);
    expect(missing).toEqual([]);
  });
});
