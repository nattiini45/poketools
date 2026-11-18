import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe.each([
  ['game', '20261102120000_audit_log_game_match_id_index.sql'],
  ['phase_game', '20261118117000_audit_log_phase_game_match_id_index.sql'],
])('audit_log %s match_id index migration', (kind, file) => {
  const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8');
  const code = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .trim();

  it('is one CREATE INDEX CONCURRENTLY statement and nothing else (the CLI sends a file as a pipeline)', () => {
    expect(code.endsWith(';')).toBe(true);
    expect(code.slice(0, -1)).not.toContain(';');
    expect(code.startsWith(`CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_${kind}_match_id_idx ON public.audit_log `)).toBe(true);
    expect(code).not.toMatch(/\b(BEGIN|COMMIT|SET|GRANT|REVOKE)\b/i);
  });

  it('indexes the expression the admin match history filters on, for game events only', () => {
    expect(code).toContain("((metadata->>'match_id'), created_at DESC)");
    expect(code).toContain(`WHERE resource_type = '${kind}'`);
  });

  it('serves the filter listMatchAuditEvents sends', () => {
    const queries = readFileSync(join(process.cwd(), 'src', 'lib', 'audit', 'queries.ts'), 'utf8');
    expect(queries).toContain('resource_type.eq.${prefix}game,metadata->>match_id.eq.');
  });
});
