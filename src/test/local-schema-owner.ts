import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/**
 * Inserts fixture rows as the schema owner, through psql in the local stack's database container (the same way the
 * phase suites already reach it). For rows that the API roles may not write in the current storage generation: a
 * league-owned `tournaments` row in `phase` mode (20261120130000_phase_legacy_league_tournament_guard.sql) is refused
 * for every session that did not log in as postgres. Only a local-stack suite calls this; omitted columns keep their
 * defaults.
 */
const CONTAINER = 'supabase_db_poketools';
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function rowStatement(table: string, row: Record<string, unknown>): string {
  const columns = Object.keys(row);
  for (const name of [table, ...columns]) {
    if (!IDENTIFIER.test(name)) throw new Error(`[local-schema-owner] not a plain identifier: ${name}`);
  }
  const json = JSON.stringify(row);
  const tag = `$r${randomBytes(8).toString('hex')}$`;
  if (json.includes(tag)) throw new Error('[local-schema-owner] dollar-quote tag collides with the row');
  const list = columns.map((c) => `"${c}"`).join(', ');
  return `INSERT INTO public."${table}" (${list}) SELECT ${list} FROM jsonb_populate_record(NULL::public."${table}", ${tag}${json}${tag}::jsonb);`;
}

export async function insertAsSchemaOwner(table: string, rows: readonly Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const sql = ['BEGIN;', ...rows.map((row) => rowStatement(table, row)), 'COMMIT;'].join('\n');
  const child = spawn('docker', ['exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']);
  let errors = '';
  child.stderr.on('data', (data: Buffer) => { errors += data.toString(); });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  child.stdin.end(sql);
  const code = await exit;
  if (code !== 0) throw new Error(`[local-schema-owner] insert into ${table} failed: ${errors.trim()}`);
}
