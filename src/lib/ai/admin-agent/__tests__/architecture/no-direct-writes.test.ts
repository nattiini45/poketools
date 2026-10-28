/**
 * Plan 3.9 test 3, no direct writes. Nothing under the assistant's core (`registry/`, `readers/`, `previews/`, `loop/`,
 * `plans/`, `proposals/`, `dispatch/`, `prompts/`, the harness) or its routes and bindings (`src/app/api/admin/agent/`)
 * calls `.insert/.update/.upsert/.delete/.rpc` or `.from('table')` on a database client, imports the service-role client,
 * or imports a mutating query function. Only `store/` writes, and only the assistant's own tables.
 *
 * The v2 plan denied mutating query exports by name pattern (`create*`, `update*`, ...) and that is not sound: `saveFormatDraft`,
 * `publishRulesetVersion`, `repinTarget`, `moveLeagueToTrash`, `reorderPhases`, `swapSeasonParticipant`, `claimGuestPlayer` and
 * more do not match it. So this test is the inverse: an import from a database query module must have a READ name (a read
 * verb first, no write word anywhere in it). `registry/__tests__/import-allowlist.test.ts` goes further for the model-facing
 * directories (an explicit list of names); this test covers every other directory and the routes with the same two nets.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isTestPath, parseImports, relFromRepo, SRC_ROOT, stripComments, walkFiles } from './graph';

const AGENT = 'src/lib/ai/admin-agent';
const ROUTES = 'src/app/api/admin/agent';

/** Everything that must not write: the core without `store/`, and the routes and bindings. */
const scanned = [
  ...walkFiles(path.join(SRC_ROOT, 'lib/ai/admin-agent'), (rel) => /\.tsx?$/.test(rel) && !isTestPath(rel)),
  ...walkFiles(path.join(SRC_ROOT, 'app/api/admin/agent'), (rel) => /\.tsx?$/.test(rel) && !isTestPath(rel)),
].filter((file) => !relFromRepo(file).startsWith(`${AGENT}/store/`));

// ─── The two nets ────────────────────────────────────────────────────

/** A database call: a table, an insert, an update, an upsert, a delete or an RPC. Crypto's `.update(` is removed first. */
const DB_CALL = /\.\s*from\s*\(\s*['"`]|\.\s*(?:insert|update|upsert|delete|rpc)\s*\(/;
const CRYPTO_UPDATE = /\bcreate(?:Hash|Hmac)\s*\([^)]*\)\s*\.update\s*\(/g;

/** A name that reads: it starts with a read verb. */
const READ_VERB = /^(?:get|list|find|count|load|search|has|is|check|resolve)[A-Z0-9_]|^(?:get|list|find|count|load|search)$/;
/** A word that writes, anywhere in a name (`getOrCreate...`, `listAndClear...`). */
const WRITE_WORD = /(?:Create|Insert|Update|Delete|Upsert|Save|Set(?![a-z])|Claim|Mark|Apply|Clear|Bump|Increment|Ensure|Publish|Move|Archive|Restore|Expire|Attach|Detach|Reorder|Swap|Regenerate|Generate|Merge|Reset|Bind|Add|Remove|Replace|Repin|Purge)/;

/** Modules that talk to the database or send something out; none may be imported from the scanned set. */
const FORBIDDEN_MODULES: ReadonlyArray<RegExp> = [
  /^@\/lib\/supabase\/client$/,
  /^@supabase\//,
  /^@\/lib\/discord(\/|$)/,
  /^@\/lib\/social(\/|$)/,
  /^@\/lib\/revalidation$/,
  /^next\/cache$/,
];

const QUERY_MODULE = /^@\/lib\/supabase\/queries\//;

function importedNames(source: string, module: string): string[] {
  const names: string[] = [];
  const escaped = module.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  for (const match of stripComments(source).matchAll(new RegExp(`import\\s+(?!type\\b)([^'";]*?)\\s+from\\s+'${escaped}'`, 'g'))) {
    for (const part of match[1].replace(/[{}]/g, ',').split(',')) {
      const trimmed = part.trim();
      if (trimmed !== '' && !trimmed.startsWith('type ')) names.push(trimmed.split(/\s+as\s+/)[0].trim());
    }
  }
  return names;
}

describe('only store/ writes', () => {
  it('scans the core and the routes', () => {
    expect(scanned.length).toBeGreaterThan(80);
    const dirs = new Set(scanned.map((file) => relFromRepo(file).replace(`${AGENT}/`, '').split('/')[0]));
    for (const dir of ['loop', 'registry', 'readers', 'previews', 'plans', 'proposals', 'dispatch', 'prompts', 'eval']) expect(dirs.has(dir), dir).toBe(true);
    expect(scanned.some((file) => relFromRepo(file).startsWith(`${ROUTES}/`))).toBe(true);
  });

  it('calls no .from(table), .insert, .update, .upsert, .delete or .rpc', () => {
    const offenders = scanned
      .filter((file) => DB_CALL.test(stripComments(readFileSync(file, 'utf8')).replace(CRYPTO_UPDATE, '')))
      .map(relFromRepo);
    expect(offenders).toEqual([]);
  });

  it('imports no database client, no emitter, no cache expiry', () => {
    const offenders: string[] = [];
    for (const file of scanned) {
      const { specifiers, typeSpecifiers } = parseImports(readFileSync(file, 'utf8'));
      // A type-only import of the client type is erased; it cannot call anything.
      for (const specifier of specifiers) if (FORBIDDEN_MODULES.some((pattern) => pattern.test(specifier))) offenders.push(`${relFromRepo(file)}: ${specifier}`);
      for (const specifier of typeSpecifiers) if (/^@\/lib\/supabase\/client$/.test(specifier)) offenders.push(`${relFromRepo(file)}: type import of the service-role client`);
    }
    expect(offenders).toEqual([]);
  });

  it('imports only read functions from a database query module', () => {
    const offenders: string[] = [];
    let queryImports = 0;
    for (const file of scanned) {
      const source = readFileSync(file, 'utf8');
      const { specifiers } = parseImports(source);
      for (const specifier of specifiers.filter((s) => QUERY_MODULE.test(s))) {
        const names = importedNames(source, specifier);
        queryImports += names.length;
        for (const name of names) if (!READ_VERB.test(name) || WRITE_WORD.test(name)) offenders.push(`${relFromRepo(file)}: ${name} from ${specifier}`);
      }
    }
    // The staging code reads live rows through these modules; a zero here would mean the scan stopped seeing them.
    expect(queryImports).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  it('lets the audit writer into the root and the approve wiring only (the loop and the executor get it injected)', () => {
    const importers = scanned.filter((file) => parseImports(readFileSync(file, 'utf8')).specifiers.includes('@/lib/audit/log')).map(relFromRepo);
    expect(importers.sort()).toEqual([`${ROUTES}/_lib/approve.ts`, `${AGENT}/index.ts`].sort());
  });

  it('keeps writes out of the harness too: it reads the fixture world, never a table', () => {
    const harness = scanned.filter((file) => relFromRepo(file).startsWith(`${AGENT}/eval/`));
    expect(harness.length).toBeGreaterThan(10);
    for (const file of harness) expect(parseImports(readFileSync(file, 'utf8')).specifiers.some((s) => QUERY_MODULE.test(s)), relFromRepo(file)).toBe(false);
  });
});

describe('the nets catch what they are for', () => {
  it('flags a database call and ignores crypto and Array.from', () => {
    for (const text of ["await supabase.from('seasons').select()", 'await db.insert({})', 'client.update(x)', 'q.upsert(row)', 'q.delete()', "await supabase.rpc('fn')"]) {
      expect(DB_CALL.test(text), text).toBe(true);
    }
    expect(DB_CALL.test("createHash('sha256').update(x).digest('hex')".replace(CRYPTO_UPDATE, ''))).toBe(false);
    expect(DB_CALL.test('Array.from(items)')).toBe(false);
    expect(DB_CALL.test('Buffer.from(text)')).toBe(false);
  });

  it('accepts read names and refuses the names the v2 pattern missed', () => {
    for (const name of ['getSeasonById', 'listSeasons', 'findHeadRulesetsByName', 'countOwnedRulesetDefinitions', 'getPinTargetStates', 'getLeagueTrashBySeason', 'hasEnrollment']) {
      expect(READ_VERB.test(name) && !WRITE_WORD.test(name), name).toBe(true);
    }
    for (const name of ['saveFormatDraft', 'publishRulesetVersion', 'repinTarget', 'attachSeasonFormat', 'moveLeagueToTrash', 'expireLeagueTrash', 'archiveTournamentsBySeason', 'reorderPhases', 'swapSeasonParticipant', 'moveGroupMember', 'claimGuestPlayer', 'insertGame', 'clearDraft', 'markReady', 'applyAggregate']) {
      expect(READ_VERB.test(name) && !WRITE_WORD.test(name), name).toBe(false);
    }
    // A read verb in front does not excuse a write word inside.
    for (const name of ['getOrCreateSeason', 'listAndClearQueue', 'getAndMarkRead', 'findOrInsertPlayer', 'getAndSetDefault']) expect(READ_VERB.test(name) && !WRITE_WORD.test(name), name).toBe(false);
    expect(READ_VERB.test('get')).toBe(true);
    expect(READ_VERB.test('getter')).toBe(false);
  });

  it('reads the imported names of a module, skipping type imports', () => {
    const source = "import { getSeasonById, type Season, saveSeason as save } from '@/lib/supabase/queries/seasons';\nimport type { X } from '@/lib/supabase/queries/seasons';";
    expect(importedNames(source, '@/lib/supabase/queries/seasons')).toEqual(['getSeasonById', 'saveSeason']);
  });
});
