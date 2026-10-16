import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

// Static guard (runs in `npm run test`, no database). It replays
// supabase/migrations/ in file order and tracks which API roles (`anon`,
// `authenticated`, `PUBLIC`) can reach each table, view, sequence, function
// and procedure in schema `public`. After the last file none may: the anon key
// ships in the browser bundle and anyone can sign up as `authenticated`, so a
// single grant republishes the admin match notes, the private `players`
// columns or a writable table to anyone. See
// docs/security/anon-match-columns.md (Options B and C, approved
// 2026-10-07) and the two migrations that close public:
// 20261008081402_revoke_anon_private_match_columns.sql and
// 20261008081443_close_public_api_roles.sql.
//
// The model, per statement:
//   - CREATE TABLE / VIEW / SEQUENCE / FUNCTION / PROCEDURE in public gives
//     the new object postgres's default privileges at that point. They start
//     open, as on every Supabase database before the first migration (the
//     platform grants ALL on new tables, sequences and functions in public to
//     anon and authenticated, and the built-in default gives PUBLIC EXECUTE on
//     every function). So a squashed baseline, or any dump, reopens every
//     object it creates unless the close-out runs again after it.
//   - ALTER DEFAULT PRIVILEGES opens or closes those defaults: per schema
//     (IN SCHEMA public) or globally. A per-schema REVOKE cannot remove the
//     global PUBLIC EXECUTE default, as in Postgres.
//   - GRANT on an object (table or column level, or ALL ... IN SCHEMA public)
//     opens its API-role grantees. REVOKE ALL (EXECUTE for a routine) closes
//     them; a partial REVOKE such as `REVOKE SELECT (notes)` closes nothing.
//   - CREATE OR REPLACE of an existing routine or view keeps its ACL, but the
//     guard cannot tell a new overload from a replacement, so it adds the
//     current defaults (closed once Option C has run).
//   - ALTER TABLE ... RENAME TO carries the ACL to the new name; SET SCHEMA
//     public brings in an object whose ACL the guard cannot see, so it counts
//     as open.
//   - ENABLE / DISABLE ROW LEVEL SECURITY tracks RLS on every table.
// Separately, no migration may make an API role a member of another role
// (`GRANT service_role TO authenticated`): membership inherits every
// privilege of the granted role.
// It does not see a dump restored outside this folder (psql -f <dump>),
// grants made in the dashboard, objects created by another role, or
// owner-rights views and SECURITY DEFINER functions. V1, V6 and V7 in
// docs/security/anon-match-columns.md cover those, and both migrations verify
// the live catalog in their own self-check.
const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations');
const API_ROLES = ['anon', 'authenticated', 'public'] as const;
type ApiRole = (typeof API_ROLES)[number];

type ObjectKind = 'table' | 'view' | 'sequence' | 'function' | 'procedure';
type DefaultKind = 'tables' | 'sequences' | 'functions';

interface Migration {
  file: string;
  sql: string;
}

interface DbObject {
  kind: ObjectKind;
  name: string;
  /** API role → the statement that opened it. */
  open: Map<ApiRole, string>;
  /** Tables only: whether row level security is enabled. */
  rls: boolean;
}

interface State {
  /** Default privileges of postgres: `global` (all schemas) and `schema` (IN SCHEMA public). */
  defaults: Record<'global' | 'schema', Record<DefaultKind, Set<ApiRole>>>;
  objects: Map<string, DbObject>;
}

/** A fresh Supabase database before the first migration (see the header). */
function initialState(): State {
  return {
    defaults: {
      global: { tables: new Set(), sequences: new Set(), functions: new Set(['public']) },
      schema: {
        tables: new Set(['anon', 'authenticated']),
        sequences: new Set(['anon', 'authenticated']),
        functions: new Set(['anon', 'authenticated']),
      },
    },
    objects: new Map(),
  };
}

/**
 * A migration's statements, split on `;` outside quotes and comments.
 * Comments are dropped, string and dollar-quoted bodies are blanked (a
 * function body can contain `;` and SQL text), double quotes are removed (so
 * pg_dump's `"public"."matches"` reads `public.matches`), and whitespace is
 * collapsed.
 */
function statements(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      current += ' ';
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j += 1;
      }
      current += "''";
      i = j + 1;
      continue;
    }
    if (ch === '"') {
      const end = sql.indexOf('"', i + 1);
      current += sql.slice(i + 1, end === -1 ? sql.length : end);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        current += '$$';
        i = end === -1 ? sql.length : end + tag[0].length;
        continue;
      }
    }
    if (ch === ';') {
      out.push(current);
      current = '';
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  out.push(current);
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length > 0);
}

/** Splits on commas outside parentheses. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const roleList = (s: string): string[] => splitTopLevel(s).map((r) => r.replace(/^GROUP\s+/i, '').toLowerCase());
const apiRoles = (s: string): ApiRole[] =>
  roleList(s).filter((r): r is ApiRole => (API_ROLES as readonly string[]).includes(r));

/** The object name in schema public (`public.x` or bare `x`), or null for another schema. */
function publicName(raw: string): string | null {
  const name = raw.split('(')[0].trim().toLowerCase();
  if (!name.includes('.')) return name;
  const [schema, rest] = name.split('.', 2);
  return schema === 'public' ? rest : null;
}

const key = (kind: ObjectKind, name: string): string =>
  `${kind === 'view' ? 'table' : kind === 'procedure' ? 'function' : kind}:${name}`;

const defaultKind = (kind: ObjectKind): DefaultKind =>
  kind === 'sequence' ? 'sequences' : kind === 'function' || kind === 'procedure' ? 'functions' : 'tables';

function effectiveDefaults(state: State, kind: ObjectKind): Set<ApiRole> {
  const k = defaultKind(kind);
  return new Set([...state.defaults.global[k], ...state.defaults.schema[k]]);
}

/** Creates (or, for OR REPLACE / IF NOT EXISTS, re-creates) an object with the current defaults. */
function create(state: State, kind: ObjectKind, name: string, where: string): void {
  const k = key(kind, name);
  const existing = state.objects.get(k);
  const obj: DbObject = existing ?? { kind, name, open: new Map(), rls: false };
  for (const role of effectiveDefaults(state, kind)) {
    if (!obj.open.has(role)) obj.open.set(role, `${where} (default privileges)`);
  }
  state.objects.set(k, obj);
}

/**
 * The objects a GRANT / REVOKE target names, or null when it is not about
 * schema public. A GRANT (`addMissing`) on an object the replay has not seen
 * still counts, so that object is added.
 */
function targets(state: State, target: string, addMissing: boolean): DbObject[] | null {
  const all = /^ALL\s+(TABLES|SEQUENCES|FUNCTIONS|PROCEDURES|ROUTINES)\s+IN\s+SCHEMA\s+(.+)$/i.exec(target);
  if (all) {
    if (!roleList(all[2]).includes('public')) return null;
    const kinds: Record<string, ObjectKind[]> = {
      tables: ['table', 'view'],
      sequences: ['sequence'],
      functions: ['function'],
      procedures: ['procedure'],
      routines: ['function', 'procedure'],
    };
    const wanted = kinds[all[1].toLowerCase()];
    return [...state.objects.values()].filter((o) => wanted.includes(o.kind));
  }
  const typed = /^(TABLE|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE)\s+(.+)$/i.exec(target);
  const otherKind = /^(SCHEMA|DATABASE|DOMAIN|TYPE|LANGUAGE|LARGE\s+OBJECT|FOREIGN|TABLESPACE|PARAMETER)\b/i;
  if (!typed && otherKind.test(target)) return null;
  const kindWord = (typed?.[1] ?? 'TABLE').toLowerCase();
  const names = splitTopLevel(typed?.[2] ?? target);
  const found: DbObject[] = [];
  for (const raw of names) {
    const name = publicName(raw);
    if (name === null) continue;
    const candidates: ObjectKind[] =
      kindWord === 'table' ? ['table', 'view'] : kindWord === 'sequence' ? ['sequence'] : ['function', 'procedure'];
    for (const kind of candidates) {
      const obj = state.objects.get(key(kind, name));
      if (obj) found.push(obj);
    }
    if (addMissing && !candidates.some((kind) => state.objects.has(key(kind, name)))) {
      // Its RLS state is unknown; the grant itself is what fails the guard.
      const kind = candidates[0];
      const obj: DbObject = { kind, name, open: new Map(), rls: true };
      state.objects.set(key(kind, name), obj);
      found.push(obj);
    }
  }
  return found;
}

const RE = {
  createTable: /^CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i,
  createView: /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:RECURSIVE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i,
  createSequence: /^CREATE\s+(?:UNLOGGED\s+)?SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/i,
  createRoutine: /^CREATE\s+(?:OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\s+([^\s(]+)/i,
  dropTable: /^DROP\s+(TABLE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE)\s+(?:IF\s+EXISTS\s+)?(.+?)(?:\s+(?:CASCADE|RESTRICT))?$/i,
  rename: /^ALTER\s+(TABLE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE)\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(\S+)\s+RENAME\s+TO\s+(\S+)$/i,
  setSchema: /^ALTER\s+(TABLE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE)\s+(?:IF\s+EXISTS\s+)?(\S+?)(?:\(.*\))?\s+SET\s+SCHEMA\s+public$/i,
  rls: /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(\S+)\s+(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY$/i,
  grantOn:
    /^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+(.+?)(?:\s+WITH\s+GRANT\s+OPTION)?(?:\s+GRANTED\s+BY\s+\S+)?$/i,
  revokeOn:
    /^REVOKE\s+(GRANT\s+OPTION\s+FOR\s+)?(.+?)\s+ON\s+(.+?)\s+FROM\s+(.+?)(?:\s+GRANTED\s+BY\s+\S+)?(?:\s+(?:CASCADE|RESTRICT))?$/i,
  defaults:
    /^ALTER\s+DEFAULT\s+PRIVILEGES(?:\s+FOR\s+(?:ROLE|USER)\s+(.+?))?(?:\s+IN\s+SCHEMA\s+(.+?))?\s+(GRANT|REVOKE)\s+(GRANT\s+OPTION\s+FOR\s+)?(.+?)\s+ON\s+(TABLES|SEQUENCES|FUNCTIONS|ROUTINES|TYPES|SCHEMAS|LARGE\s+OBJECTS)\s+(?:TO|FROM)\s+(.+?)(?:\s+WITH\s+GRANT\s+OPTION)?(?:\s+(?:CASCADE|RESTRICT))?$/i,
  grantRole: /^GRANT\s+(?!.*\sON\s)(.+?)\s+TO\s+(.+?)(?:\s+WITH\s+.+?)?(?:\s+GRANTED\s+BY\s+\S+)?$/i,
};

/** Whether a REVOKE privilege list removes everything an object kind can hold. */
function revokesAll(privileges: string, kind: ObjectKind | DefaultKind): boolean {
  const p = privileges.trim();
  if (/^ALL(\s+PRIVILEGES)?$/i.test(p)) return true;
  return ['function', 'procedure', 'functions'].includes(kind) && /^EXECUTE$/i.test(p);
}

/** Applies one statement to the replay state. */
function apply(state: State, statement: string, where: string): void {
  let m: RegExpExecArray | null;

  if ((m = RE.defaults.exec(statement))) {
    const [, forRoles, inSchemas, verb, grantOptionOnly, privileges, objType, grantees] = m;
    if (forRoles && !roleList(forRoles).includes('postgres')) return; // objects created by another role
    if (inSchemas && !roleList(inSchemas).includes('public')) return;
    const kind = objType.toLowerCase().replace('routines', 'functions');
    if (kind !== 'tables' && kind !== 'sequences' && kind !== 'functions') return;
    const layer = state.defaults[inSchemas ? 'schema' : 'global'][kind];
    for (const role of apiRoles(grantees)) {
      if (verb.toUpperCase() === 'GRANT') layer.add(role);
      else if (!grantOptionOnly && revokesAll(privileges, kind)) layer.delete(role);
    }
    return;
  }
  if ((m = RE.createTable.exec(statement))) {
    const name = publicName(m[1]);
    if (name !== null) create(state, 'table', name, where);
    return;
  }
  if ((m = RE.createView.exec(statement))) {
    const name = publicName(m[1]);
    if (name !== null) create(state, 'view', name, where);
    return;
  }
  if ((m = RE.createSequence.exec(statement))) {
    const name = publicName(m[1]);
    if (name !== null) create(state, 'sequence', name, where);
    return;
  }
  if ((m = RE.createRoutine.exec(statement))) {
    const name = publicName(m[2]);
    if (name !== null) create(state, m[1].toLowerCase() === 'procedure' ? 'procedure' : 'function', name, where);
    return;
  }
  if ((m = RE.dropTable.exec(statement))) {
    const kind: ObjectKind = /SEQUENCE/i.test(m[1]) ? 'sequence' : 'table';
    for (const raw of splitTopLevel(m[2])) {
      const name = publicName(raw);
      if (name !== null) state.objects.delete(key(kind, name));
    }
    return;
  }
  if ((m = RE.rename.exec(statement))) {
    const from = publicName(m[2]);
    const to = m[3].toLowerCase();
    const kind: ObjectKind = /SEQUENCE/i.test(m[1]) ? 'sequence' : 'table';
    const obj = from === null ? undefined : state.objects.get(key(kind, from));
    if (from !== null && obj) {
      state.objects.delete(key(kind, from));
      state.objects.set(key(kind, to), { ...obj, name: to });
    }
    return;
  }
  if ((m = RE.setSchema.exec(statement))) {
    const word = m[1].toLowerCase();
    const kind: ObjectKind = word === 'sequence' ? 'sequence' : /function|procedure|routine/.test(word) ? 'function' : 'table';
    const name = m[2].split('.').pop()?.toLowerCase() ?? m[2];
    const obj: DbObject = state.objects.get(key(kind, name)) ?? { kind, name, open: new Map(), rls: false };
    for (const role of ['anon', 'authenticated'] as const) obj.open.set(role, `${where} (moved in, ACL unknown)`);
    state.objects.set(key(kind, name), obj);
    return;
  }
  if ((m = RE.rls.exec(statement))) {
    const name = publicName(m[1]);
    const obj = name === null ? undefined : state.objects.get(key('table', name));
    if (obj) obj.rls = m[2].toUpperCase() === 'ENABLE';
    return;
  }
  if ((m = RE.grantOn.exec(statement))) {
    const roles = apiRoles(m[3]);
    if (roles.length === 0) return;
    for (const obj of targets(state, m[2], true) ?? []) {
      for (const role of roles) obj.open.set(role, where);
    }
    return;
  }
  if ((m = RE.revokeOn.exec(statement))) {
    if (m[1]) return; // GRANT OPTION FOR only removes the option
    const roles = apiRoles(m[4]);
    for (const obj of targets(state, m[3], false) ?? []) {
      if (!revokesAll(m[2], obj.kind)) continue;
      for (const role of roles) obj.open.delete(role);
    }
  }
}

/** Replays `migrations` in order. */
function replay(migrations: Migration[]): State {
  const state = initialState();
  for (const { file, sql } of migrations) {
    for (const s of statements(sql)) apply(state, s, `${file}: ${s.slice(0, 100)}`);
  }
  return state;
}

/** Every `<role> <- <kind> <name>  [<where>]` still open after the replay, sorted. */
function reachable(state: State): string[] {
  return [...state.objects.values()]
    .flatMap((o) => [...o.open.entries()].map(([role, where]) => `${role} <- ${o.kind} ${o.name}  [${where}]`))
    .sort();
}

/** The same, without the statement: `<role> <- <kind> <name>`. */
const short = (state: State): string[] => reachable(state).map((r) => r.split('  [')[0]);

/** Default privileges that still hand new objects in public to an API role. */
function openDefaults(state: State): string[] {
  return (['global', 'schema'] as const)
    .flatMap((layer) =>
      (['tables', 'sequences', 'functions'] as const).flatMap((kind) =>
        [...state.defaults[layer][kind]].map((role) => `${layer} ${kind} -> ${role}`),
      ),
    )
    .sort();
}

/** Tables (not views) without row level security. */
const tablesWithoutRls = (state: State): string[] =>
  [...state.objects.values()].filter((o) => o.kind === 'table' && !o.rls).map((o) => o.name).sort();

/** `GRANT <role> TO <API role>` statements (role membership, no ON clause). */
function roleMembershipGrants(sql: string): string[] {
  return statements(sql).filter((s) => {
    const m = RE.grantRole.exec(s);
    return m !== null && apiRoles(m[2]).length > 0;
  });
}

const migrations: Migration[] = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((file) => ({ file, sql: readFileSync(path.join(MIGRATIONS, file), 'utf8') }));

const REVOKE_B_FILE = '20261008081402_revoke_anon_private_match_columns.sql';
const CLOSE_C_FILE = '20261008081443_close_public_api_roles.sql';
const without = (...files: string[]): Migration[] => migrations.filter((m) => !files.includes(m.file));
const sqlOf = (file: string): string => {
  const found = migrations.find((m) => m.file === file);
  if (!found) throw new Error(`missing migration ${file}`);
  return found.sql;
};

/** A dumped table as pg_dump writes it, with RLS on and only service_role granted. */
const DUMP = [
  'CREATE TABLE IF NOT EXISTS "public"."matches" ("id" uuid, "notes" text);',
  'ALTER TABLE "public"."matches" ENABLE ROW LEVEL SECURITY;',
  'GRANT ALL ON TABLE "public"."matches" TO "service_role";',
].join('\n');
const B = 'REVOKE ALL ON TABLE public.matches FROM anon, authenticated;';

describe('migrations leave schema public closed to the API roles', () => {
  it('the statement splitter reads pg_dump quoting, dollar-quoted bodies and comments (control)', () => {
    expect(
      statements(`-- GRANT ALL ON TABLE matches TO anon;
CREATE FUNCTION "public"."f"() RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN EXECUTE 'GRANT ALL ON public.matches TO anon'; END $fn$;
/* GRANT SELECT ON public.players TO anon; */ GRANT ALL ON FUNCTION "public"."f"() TO "service_role";
SELECT ';' AS "semi;colon";`),
    ).toEqual([
      'CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$',
      'GRANT ALL ON FUNCTION public.f() TO service_role',
      "SELECT '' AS semi;colon",
    ]);
  });

  it('the replay sees the real folder open public before the fix (control)', () => {
    // Without B and C, the baseline's CREATE TABLEs and GRANT ALL lines leave matches,
    // players and every function open; the snapshot table also has RLS off.
    const before = short(replay(without(REVOKE_B_FILE, CLOSE_C_FILE)));
    for (const expected of [
      'anon <- table matches',
      'authenticated <- table matches',
      'anon <- table players',
      'anon <- table match_evolution_snapshots',
      'anon <- function epb_replace_match_snapshots',
      'public <- function epb_replace_match_snapshots',
    ]) {
      expect(before, expected).toContain(expected);
    }
    // The two functions advisor_fixes closed stay closed in the model too.
    expect(before.filter((r) => /check_and_record_admin_export|rls_auto_enable/.test(r))).toEqual([]);
    expect(tablesWithoutRls(replay(without(CLOSE_C_FILE)))).toEqual(['match_evolution_snapshots']);
    expect(openDefaults(replay(without(CLOSE_C_FILE)))).toEqual([
      'global functions -> public',
      'schema functions -> anon',
      'schema functions -> authenticated',
      'schema sequences -> anon',
      'schema sequences -> authenticated',
      'schema tables -> anon',
      'schema tables -> authenticated',
    ]);

    // B alone closes matches and nothing else.
    const afterB = short(replay(without(CLOSE_C_FILE)));
    expect(afterB.filter((r) => r.endsWith(' table matches'))).toEqual([]);
    expect(afterB).toContain('anon <- table players');
  });

  it('the matcher catches every reopen path (control)', () => {
    const closed: Migration[] = [
      { file: 'dump', sql: DUMP },
      { file: 'C', sql: sqlOf(CLOSE_C_FILE) },
    ];
    const later = (sql: string) => short(replay([...closed, { file: 'later', sql }]));

    // A dump of the fixed table carries no REVOKE: restoring it reopens both roles.
    expect(short(replay([{ file: 'dump', sql: DUMP }]))).toEqual(['anon <- table matches', 'authenticated <- table matches']);
    expect(short(replay([{ file: 'dump', sql: DUMP }, { file: 'B', sql: B }]))).toEqual([]);
    expect(short(replay(closed))).toEqual([]);
    expect(openDefaults(replay(closed))).toEqual([]);

    // Object grants: table, column, schema-wide, PUBLIC, sequence and routine.
    expect(later('GRANT SELECT (id, status) ON public.matches TO anon, authenticated;')).toEqual([
      'anon <- table matches',
      'authenticated <- table matches',
    ]);
    expect(later('GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;')).toEqual(['anon <- table matches']);
    expect(later('GRANT SELECT ON public.matches TO PUBLIC;')).toEqual(['public <- table matches']);
    expect(later('CREATE SEQUENCE public.s; GRANT USAGE ON SEQUENCE public.s TO authenticated;')).toEqual([
      'authenticated <- sequence s',
    ]);
    expect(
      later(
        'CREATE FUNCTION public.f(p_id uuid, p_n integer) RETURNS int LANGUAGE sql AS $$ select 1 $$; GRANT EXECUTE ON FUNCTION "public"."f"("p_id" uuid, "p_n" integer) TO "anon";',
      ),
    ).toEqual(['anon <- function f']);
    expect(later('CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ select 1 $$; GRANT ALL ON ALL ROUTINES IN SCHEMA public TO authenticated;')).toEqual([
      'authenticated <- function f',
    ]);
    expect(later('CREATE PROCEDURE public.p() LANGUAGE sql AS $$ select 1 $$; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;')).toEqual([]);
    expect(later('CREATE PROCEDURE public.p() LANGUAGE sql AS $$ select 1 $$; GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA public TO anon;')).toEqual([
      'anon <- procedure p',
    ]);

    // Default privileges: a later grant reopens every object created after it.
    const reopened = replay([...closed, { file: 'later', sql: 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon; CREATE TABLE public.t (id int);' }]);
    expect(short(reopened)).toEqual(['anon <- table t']);
    expect(openDefaults(reopened)).toEqual(['schema tables -> anon']);
    expect(openDefaults(replay([...closed, { file: 'later', sql: 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;' }]))).toEqual([
      'global functions -> public',
    ]);
    // Another creator's defaults are not postgres's; a per-schema revoke cannot remove PUBLIC EXECUTE.
    expect(openDefaults(replay([...closed, { file: 'later', sql: 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;' }]))).toEqual([]);
    expect(
      openDefaults(replay([{ file: 'x', sql: 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;' }])),
    ).toContain('global functions -> public');

    // A new table or routine after C is closed by default and needs no revoke; before C it is open.
    expect(later('CREATE TABLE public.t (id int); ALTER TABLE public.t ENABLE ROW LEVEL SECURITY;')).toEqual([]);
    expect(later('CREATE OR REPLACE FUNCTION public.epb_replace_match_snapshots(p_match_id uuid, p_snapshots jsonb) RETURNS void LANGUAGE sql AS $$ select $$;')).toEqual([]);
    expect(short(replay([{ file: 'x', sql: 'CREATE TABLE public.t (id int); CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ select 1 $$;' }]))).toEqual([
      'anon <- function f',
      'anon <- table t',
      'authenticated <- function f',
      'authenticated <- table t',
      'public <- function f',
    ]);

    // Rename and SET SCHEMA.
    expect(short(replay([{ file: 'x', sql: `CREATE TABLE public.matches_v2 (id uuid); ${B}; ALTER TABLE public.matches_v2 RENAME TO matches;` }]))).toEqual([
      'anon <- table matches',
      'authenticated <- table matches',
    ]);
    expect(later('ALTER TABLE staging.matches SET SCHEMA public;')).toEqual(['anon <- table matches', 'authenticated <- table matches']);

    // Partial revokes close nothing; grants to service_role open nothing.
    expect(later('GRANT ALL ON public.matches TO anon; REVOKE SELECT (notes) ON public.matches FROM anon;')).toEqual([
      'anon <- table matches',
    ]);
    expect(later('GRANT ALL ON public.matches TO anon; REVOKE GRANT OPTION FOR ALL ON public.matches FROM anon;')).toEqual([
      'anon <- table matches',
    ]);
    expect(later('REVOKE SELECT (notes) ON public.matches FROM anon;')).toEqual([]);
    expect(later('GRANT ALL ON TABLE public.matches TO service_role; GRANT USAGE ON SCHEMA public TO anon;')).toEqual([]);
    expect(later('GRANT SELECT ON storage.objects TO anon;')).toEqual([]);
    expect(later('ALTER TABLE public.matches RENAME COLUMN notes TO admin_notes;')).toEqual([]);

    // RLS: a new table without ENABLE ROW LEVEL SECURITY, or a DISABLE, is caught.
    expect(tablesWithoutRls(replay([...closed, { file: 'later', sql: 'CREATE TABLE public.t (id int);' }]))).toEqual(['t']);
    expect(tablesWithoutRls(replay([...closed, { file: 'later', sql: 'ALTER TABLE ONLY public.matches DISABLE ROW LEVEL SECURITY;' }]))).toEqual([
      'matches',
    ]);

    // Role membership.
    expect(
      roleMembershipGrants(
        'GRANT service_role TO authenticated; GRANT postgres TO anon WITH ADMIN OPTION; GRANT USAGE ON SCHEMA public TO anon; GRANT anon TO authenticator;',
      ),
    ).toEqual(['GRANT service_role TO authenticated', 'GRANT postgres TO anon WITH ADMIN OPTION']);
  });

  it('replaying every migration leaves no table, view, sequence or routine in public reachable by anon, authenticated or PUBLIC', () => {
    const state = replay(migrations);
    expect(reachable(state)).toEqual([]);
    // Not vacuous: the replay tracked the whole schema.
    expect(state.objects.has('table:matches')).toBe(true);
    expect(state.objects.has('table:players')).toBe(true);
    expect([...state.objects.values()].filter((o) => o.kind === 'table').length).toBeGreaterThanOrEqual(60);
    expect([...state.objects.values()].filter((o) => o.kind === 'function').length).toBeGreaterThanOrEqual(20);
  });

  it('replaying every migration leaves public.matches closed even without the Option C file', () => {
    expect(short(replay(without(CLOSE_C_FILE))).filter((r) => r.endsWith(' table matches'))).toEqual([]);
  });

  it('postgres hands new objects in public to no API role, and new functions anywhere not to PUBLIC', () => {
    expect(openDefaults(replay(migrations))).toEqual([]);
  });

  it('every table in public has row level security enabled', () => {
    expect(tablesWithoutRls(replay(migrations))).toEqual([]);
  });

  it('no migration makes anon, authenticated or PUBLIC a member of another role', () => {
    const offenders = migrations.flatMap(({ file, sql }) => roleMembershipGrants(sql).map((s) => `${file}: ${s}`));
    expect(offenders).toEqual([]);
  });
});
