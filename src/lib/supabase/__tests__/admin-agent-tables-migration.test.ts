import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { declaredColumns, replayForeignKeys, replayTriggers, strip } from '@/lib/league-trash/__tests__/fk-replay';

/**
 * Static guard of the Admin Assistant tables (PR8, `supabase/migrations/20261027100000_admin_agent_tables.sql`,
 * docs/poketools-spec.md 4.14). No database: it reads the migration files, like `migration-api-grants.test.ts`
 * (which replays the grants of the whole folder) and `league-trash/__tests__/inventory.test.ts` (which replays the
 * foreign keys). What the triggers and functions DO is proved against a local stack by
 * `src/lib/league-trash/__tests__/admin-agent-tables.local.test.ts` (opt-in).
 */
const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations');
const FILE = '20261027100000_admin_agent_tables.sql';

const TABLES = [
  'admin_agent_conversations',
  'admin_agent_messages',
  'admin_agent_plans',
  'admin_agent_plan_revisions',
  'admin_agent_proposals',
  'admin_agent_actions',
  'admin_agent_snapshots',
  'admin_agent_refs',
  'admin_agent_usage',
] as const;

const allSql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((file) => ({ file, sql: readFileSync(path.join(MIGRATIONS, file), 'utf8') }));
const raw = readFileSync(path.join(MIGRATIONS, FILE), 'utf8');

/** Statements of a migration without comments and without `$$` bodies, whitespace collapsed. */
const statementsOf = (sql: string): string[] =>
  strip(sql)
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
const statements = statementsOf(raw);

const FKS = [...replayForeignKeys().entries()].map(([name, fk]) => ({ name, ...fk })).filter((fk) => fk.child.startsWith('admin_agent_'));

/** The `CREATE TABLE` statement of a table, comments removed. */
function tableBody(table: string): string {
  const stmt = statements.find((s) => new RegExp(`^CREATE TABLE public\\.${table} \\(`).test(s));
  if (!stmt) throw new Error(`no CREATE TABLE for ${table}`);
  return stmt;
}

describe('the nine admin_agent_* tables', () => {
  it('exactly these tables are created by the migrations (a tenth needs this test, the grants and the lifecycle rules)', () => {
    const created = allSql.flatMap(({ sql }) =>
      [...strip(sql).matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(admin_agent_[a-z_]+)"?/gi)].map((m) => m[1]),
    );
    expect([...created].sort()).toEqual([...TABLES].sort());
    const own = [...strip(raw).matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi)].map((m) => m[1]);
    expect(own.filter((name) => !name.startsWith('admin_agent_'))).toEqual([]);
  });

  it('every table has RLS enabled, no policy anywhere, and is revoked from every role before the service_role grant', () => {
    for (const table of TABLES) {
      expect(statements, table).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(statements, table).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated, service_role`);
      // SELECT, INSERT, UPDATE and nothing else: no DELETE (rows go only through the retention purge), no TRUNCATE.
      expect(statements, table).toContain(`GRANT SELECT, INSERT, UPDATE ON TABLE public.${table} TO service_role`);
    }
    for (const { file, sql } of allSql) {
      expect(strip(sql), file).not.toMatch(/CREATE\s+POLICY[^;]*admin_agent_/i);
    }
  });

  it('no statement in any migration grants an assistant table or function to anything but service_role', () => {
    for (const { file, sql } of allSql) {
      const mentions = statementsOf(sql).filter((s) => /^(GRANT|REVOKE)\b/i.test(s) && /admin_agent/i.test(s));
      for (const statement of mentions) {
        if (/^GRANT/i.test(statement)) {
          expect(statement, `${file}: ${statement}`).toMatch(/ TO service_role$/);
          expect(statement, `${file}: ${statement}`).not.toMatch(/\b(DELETE|TRUNCATE|ALL)\b/i);
        } else {
          expect(statement, `${file}: ${statement}`).toMatch(/ FROM PUBLIC, anon, authenticated(, service_role)?$/);
        }
      }
    }
  });

  it('every table has a BEFORE DELETE trigger that forbids deletes and a BEFORE UPDATE column guard', () => {
    const triggers = [...replayTriggers().values()].filter((t) => t.table.startsWith('admin_agent_'));
    for (const table of TABLES) {
      const mine = triggers.filter((t) => t.table === table);
      expect(mine.some((t) => t.events.length === 1 && t.events[0] === 'DELETE'), `${table} delete`).toBe(true);
      expect(mine.some((t) => t.name.endsWith('_guard') && t.events.includes('UPDATE')), `${table} update`).toBe(true);
      expect(statements, `${table} no_delete`).toContain(
        `CREATE TRIGGER trg_${table}_no_delete BEFORE DELETE ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.admin_agent__forbid_delete()`,
      );
    }
  });

  it('admin columns are ON DELETE SET NULL and every row with one also stores admin_name NOT NULL', () => {
    const adminFks = FKS.filter((fk) => /_(admin_id|approved_by)_fkey$/.test(fk.name));
    expect(adminFks.map((fk) => fk.name).sort()).toEqual([
      'admin_agent_actions_admin_id_fkey',
      'admin_agent_conversations_admin_id_fkey',
      'admin_agent_plans_admin_id_fkey',
      'admin_agent_proposals_admin_id_fkey',
      'admin_agent_proposals_approved_by_fkey',
      'admin_agent_usage_admin_id_fkey',
    ]);
    for (const fk of adminFks) {
      expect(fk.parent, fk.name).toBe('players');
      expect(fk.onDelete, fk.name).toBe('set null');
    }
    const withAdmin = [...declaredColumns(/^admin_id$/).keys()].filter((t) => t.startsWith('admin_agent_')).sort();
    const withName = [...declaredColumns(/^admin_name$/).keys()].filter((t) => t.startsWith('admin_agent_')).sort();
    expect(withName).toEqual(withAdmin);
    expect(withAdmin).toHaveLength(5);
    for (const table of withAdmin) expect(tableBody(table), table).toMatch(/\badmin_name text NOT NULL\b/);
  });

  it('the only parents outside the family are players: no key into the league subtree (recycle bin rule)', () => {
    for (const fk of FKS) {
      expect(['players', ...TABLES], `${fk.name} -> ${fk.parent}`).toContain(fk.parent);
    }
    expect(FKS.some((fk) => /entity/.test(fk.name))).toBe(false);
  });

  it('the ledger entity_id is a plain uuid without a reference', () => {
    expect([...declaredColumns(/^entity_id$/).keys()].filter((t) => t.startsWith('admin_agent_'))).toEqual(['admin_agent_actions']);
    const body = tableBody('admin_agent_actions');
    expect(body).toMatch(/\bentity_id uuid,/);
    expect(body).not.toMatch(/entity_id uuid[^,]*REFERENCES/i);
  });

  it('carries the keys the design depends on', () => {
    expect(tableBody('admin_agent_messages')).toMatch(/PRIMARY KEY \(conversation_id, seq\)/);
    expect(tableBody('admin_agent_plan_revisions')).toMatch(/PRIMARY KEY \(plan_id, revision\)/);
    expect(tableBody('admin_agent_refs')).toMatch(/PRIMARY KEY \(conversation_id, ref_kind, ref_id\)/);
    expect(tableBody('admin_agent_actions')).toMatch(/UNIQUE \(conversation_id, tool_use_id\)/);
    expect(tableBody('admin_agent_actions')).toMatch(/UNIQUE \(proposal_id, step_key\)/);
    expect(tableBody('admin_agent_conversations')).toMatch(/\bturn_lease_until timestamptz,/);
    expect(tableBody('admin_agent_usage')).toMatch(/\breserved_usd_micro bigint NOT NULL/);
    expect(statements).toContain(
      "CREATE UNIQUE INDEX uq_admin_agent_proposals_executing ON public.admin_agent_proposals (conversation_id) WHERE status = 'executing'",
    );
    expect(statements).toContain(
      'CREATE UNIQUE INDEX uq_admin_agent_messages_client_msg ON public.admin_agent_messages (conversation_id, client_msg_id) WHERE client_msg_id IS NOT NULL',
    );
    expect(statements).toContain(
      'CREATE INDEX idx_admin_agent_conversations_admin_last ON public.admin_agent_conversations (admin_id, last_message_at DESC)',
    );
    expect(statements).toContain('CREATE INDEX idx_admin_agent_usage_admin_created ON public.admin_agent_usage (admin_id, created_at)');
  });
});

describe('the functions', () => {
  const functions = [...raw.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(([^)]*)\)([\s\S]*?)\$\$/g)].map((m) => ({
    name: m[1],
    header: m[3],
  }));

  it('the parser finds them (sanity)', () => {
    expect(functions.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        'admin_agent__purging',
        'admin_agent__forbid_delete',
        'admin_agent__guard_update',
        'admin_agent_retention_purge',
        'admin_agent_claim_budget',
        'admin_agent_acquire_turn_lease',
        'admin_agent_release_turn_lease',
        'admin_agent_reserve_usage',
        'admin_agent_settle_usage',
      ]),
    );
  });

  it('every function pins search_path, and every one is closed to the API roles and granted to service_role', () => {
    for (const fn of functions) {
      expect(fn.header, fn.name).toMatch(/SET search_path = public, pg_temp/);
      const revoke = new RegExp(`^REVOKE ALL ON FUNCTION public\\.${fn.name}\\(.*\\) FROM PUBLIC, anon, authenticated$`);
      const grant = new RegExp(`^GRANT EXECUTE ON FUNCTION public\\.${fn.name}\\(.*\\) TO service_role$`);
      expect(statements.some((s) => revoke.test(s)), `${fn.name} revoke`).toBe(true);
      expect(statements.some((s) => grant.test(s)), `${fn.name} grant`).toBe(true);
    }
  });

  it('only the retention purge runs with owner rights, and only it sets the purge flag', () => {
    expect(functions.filter((f) => /SECURITY DEFINER/.test(f.header)).map((f) => f.name)).toEqual(['admin_agent_retention_purge']);
    expect(raw.match(/set_config\('app\.retention_purge', 'on', true\)/g)).toHaveLength(1);
    expect(raw.match(/set_config\('app\.retention_purge', 'off', true\)/g)).toHaveLength(1);
    expect(allSql.filter(({ sql }) => sql.includes('app.retention_purge')).map(({ file }) => file)).toEqual([FILE]);
  });

  it('the flag counts only outside the API roles, so a caller cannot forge it', () => {
    const purging = /CREATE OR REPLACE FUNCTION public\.admin_agent__purging\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(raw)?.[1] ?? '';
    for (const role of ['anon', 'authenticated', 'authenticator', 'service_role']) expect(purging).toContain(`'${role}'`);
    expect(purging).toContain("current_setting('app.retention_purge', true)");
  });

  it('the purge refuses arguments that could wipe the tables', () => {
    const purge = /CREATE OR REPLACE FUNCTION public\.admin_agent_retention_purge\([\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(raw)?.[1] ?? '';
    expect(purge).toMatch(/p_message_days < 30/);
    expect(purge).toMatch(/p_audit_days < 30/);
    expect(purge).toMatch(/p_limit NOT BETWEEN 1 AND 100000/);
  });

  it('the purge refuses a future p_now from the API roles, judged on the session user', () => {
    const purge = /CREATE OR REPLACE FUNCTION public\.admin_agent_retention_purge\([\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(raw)?.[1] ?? '';
    // current_user is the owner inside a SECURITY DEFINER function, so only session_user can tell the API from a maintainer.
    expect(purge).toMatch(/p_now > clock_timestamp\(\) \+ interval '1 minute'/);
    expect(purge).toMatch(/session_user IN \('anon', 'authenticated', 'authenticator', 'service_role'\)/);
  });
});

describe('the migration stays inside its lane', () => {
  it('alters no table outside the family and leaves the league recycle bin functions alone', () => {
    const body = strip(raw);
    const altered = [...body.matchAll(/\b(?:ALTER|DROP)\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?(\w+)/gi)].map((m) => m[1]);
    expect(altered.filter((name) => !name.startsWith('admin_agent_'))).toEqual([]);
    expect(body).not.toMatch(/league_trash__/);
  });
});
