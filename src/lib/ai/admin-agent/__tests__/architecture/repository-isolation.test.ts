/**
 * Plan 3.9 test 8, repository isolation, from outside the store. `store/__tests__/isolation.test.ts` already proves the two
 * halves that live with the store (no `.from('admin_agent_` outside `store/` under `src/`, and every store method takes a
 * typed `adminId` first and refuses a forged one before a query). This test closes what that one cannot see:
 *
 *  - the tables are named only by the store, the generated types and the migration, anywhere in the repository's code
 *    (scripts and the Supabase folder included, not only `src/`);
 *  - an `AdminId` is minted in one place per entry: the route-side helper that has just run a live `require*` guard, and
 *    the harness's fixture; never from a request body, a route param or a conversation id;
 *  - the store's own surface stays free of a method that is not scoped by an admin (no "get any conversation" escape).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isTestPath, REPO_ROOT, relFromRepo, stripComments, walkFiles } from './graph';

// The scans read about 1,500 files; under a full parallel run the default 5 s is not enough.
vi.setConfig({ testTimeout: 30_000 });

/** The comment-free text of a file, read once per run: the scans below visit about 1,500 files several times each. */
const strippedCache = new Map<string, string>();
function strippedSource(file: string): string {
  let text = strippedCache.get(file);
  if (text === undefined) {
    text = stripComments(readFileSync(file, 'utf8'));
    strippedCache.set(file, text);
  }
  return text;
}

const AGENT = 'src/lib/ai/admin-agent';

/** Every source file in the repository's code folders, tests and migrations excluded. */
const code = [
  ...walkFiles(path.join(REPO_ROOT, 'src'), (rel) => /\.(ts|tsx|mjs|js|cjs)$/.test(rel) && !isTestPath(rel)),
  ...walkFiles(path.join(REPO_ROOT, 'scripts'), (rel) => /\.(ts|tsx|mjs|js|cjs)$/.test(rel) && !isTestPath(rel) && !/\/__tests__\//.test(rel)),
  ...walkFiles(path.join(REPO_ROOT, 'supabase'), (rel) => /\.(ts|mjs|js)$/.test(rel) && !rel.startsWith('supabase/migrations/')),
];

/** The only code files that may name an `admin_agent_` table: the store and the generated database types. */
const MAY_NAME_TABLES = (rel: string): boolean => rel.startsWith(`${AGENT}/store/`) || rel === 'src/types/database.ts';

describe('the assistant\'s tables are named by the store alone', () => {
  it('scans the repository\'s code', () => {
    expect(code.length).toBeGreaterThan(1500);
  });

  it('has no admin_agent_ table name in executable code outside store/ and the generated types, comments aside', () => {
    const offenders = code
      .filter((file) => !MAY_NAME_TABLES(relFromRepo(file)))
      .filter((file) => /admin_agent_/.test(strippedSource(file)))
      .map(relFromRepo);
    expect(offenders).toEqual([]);
  });

  it('has no raw SQL against them outside the migration: no template literal or string passes an admin_agent_ statement on', () => {
    const offenders = code
      .filter((file) => !MAY_NAME_TABLES(relFromRepo(file)))
      .filter((file) => /\b(?:insert\s+into|update|delete\s+from|truncate)\s+(?:public\.)?admin_agent_/i.test(readFileSync(file, 'utf8')))
      .map(relFromRepo);
    expect(offenders).toEqual([]);
  });

  it('keeps the table names in exactly one migration', () => {
    const migrations = walkFiles(path.join(REPO_ROOT, 'supabase/migrations'), (rel) => rel.endsWith('.sql')).filter((file) => /create\s+table[^;]*admin_agent_/i.test(readFileSync(file, 'utf8')));
    expect(migrations.map(relFromRepo)).toEqual(['supabase/migrations/20261027100000_admin_agent_tables.sql']);
  });
});

describe('an AdminId is minted from a live player and nowhere else', () => {
  const mintSites = code
    .filter((file) => /\badminIdOf\s*\(/.test(strippedSource(file)))
    .map(relFromRepo)
    .sort();

  it('has the definition, the routes\' guard helper and the harness, and no other minting site', () => {
    expect(mintSites).toEqual(['src/app/api/admin/agent/_lib/auth.ts', `${AGENT}/eval/runner.ts`, `${AGENT}/store/ids.ts`]);
  });

  it('mints, in the routes, only from the player a live guard returned', () => {
    const helper = path.join(REPO_ROOT, 'src/app/api/admin/agent/_lib/auth.ts');
    expect(existsSync(helper)).toBe(true);
    const text = stripComments(readFileSync(helper, 'utf8'));
    const calls = [...text.matchAll(/adminIdOf\(([^)]*)\)/g)].map((match) => match[1].trim());
    expect(calls).toEqual(['player.playerId']);
    // The player comes from a `require*` guard in the same function, before the id is made.
    expect(text.indexOf('requireAnyAdmin')).toBeGreaterThan(-1);
    expect(text.indexOf('requireAnyAdmin')).toBeLessThan(text.indexOf('adminIdOf('));
  });

  it('never mints from a request, a body, a param, a query or a conversation id', () => {
    for (const file of code) {
      const text = strippedSource(file);
      for (const match of text.matchAll(/adminIdOf\(([^)]*)\)/g)) {
        expect(match[1], `${relFromRepo(file)}: adminIdOf(${match[1]})`).not.toMatch(/\b(?:body|params?|query|searchParams|request|req|headers|conversationId|conversation\.id|clientMsgId|cookie)\b/i);
      }
    }
  });
});

describe('the store\'s surface', () => {
  const read = (name: string) => stripComments(readFileSync(path.join(REPO_ROOT, AGENT, 'store', name), 'utf8'));
  const repositories = ['conversations', 'messages', 'plans', 'proposals', 'actions', 'refs', 'snapshots', 'usage'];

  it('has repository methods that all start with the admin: no method takes only a row id', () => {
    for (const name of repositories) {
      const source = read(`${name}.ts`);
      // A method declaration of the returned object: four spaces, an optional `async`, a name, its parameters, an optional
      // return type and a body. A call statement in a body ends with `;` and does not match.
      const methods = [...source.matchAll(/^ {4}(?:async )?([a-zA-Z]+)(?:<[^>]*>)?\(([^)]*)\)\s*(?::[^;{]*)?\{/gm)].filter(([, , parameters]) => parameters.trim() !== '');
      expect(methods.length, name).toBeGreaterThan(0);
      for (const [, method, parameters] of methods) expect(parameters.trim().startsWith('adminId: AdminId'), `${name}.${method}(${parameters})`).toBe(true);
    }
  });

  it('exports no repository function that bypasses the admin check', () => {
    const index = read('index.ts');
    expect(index).not.toMatch(/export\s+(?:const|function)\s+\w*(?:Any|Unscoped|AsService|Raw|Admin(?:Only)?Bypass)\w*/);
    // The bound store is the only thing that holds the service-role client.
    expect(index).toMatch(/createAdminAgentStore\(/);
  });

  it('keeps the SQL functions out of reach of any other module: the rpc names appear only under store/', () => {
    const rpcNames = [...stripComments(readFileSync(path.join(REPO_ROOT, 'supabase/migrations/20261027100000_admin_agent_tables.sql'), 'utf8')).matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(admin_agent_\w+)/gi)].map((m) => m[1]);
    expect(rpcNames.length).toBeGreaterThan(3);
    const offenders = code.filter((file) => !MAY_NAME_TABLES(relFromRepo(file))).filter((file) => rpcNames.some((name) => strippedSource(file).includes(name))).map(relFromRepo);
    expect(offenders).toEqual([]);
  });
});
