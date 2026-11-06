import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FormatRuntime } from '@/lib/supabase/queries/format-runtime';
import { buildRuntimeState } from '../state';
import { FORMAT_CHECK_SOURCES } from '../types';

const MIGRATION = '20261106090000_format_challenges.sql';

const emptyRuntime = (): FormatRuntime => ({
  relationLinks: [],
  resourceItems: [],
  actionSubmissions: [],
  eventLog: [],
  flags: [],
  playerAttrs: [],
  trackProgress: [],
  checks: [],
  adjustments: [],
});

function checkRow(source: string): FormatRuntime['checks'][number] {
  return {
    id: `c-${source}`,
    season_id: 's-1',
    source,
    rule_id: 'team.audit',
    dedupe_key: `k-${source}`,
    subject: {},
    status: 'open',
    note: null,
    opened_at: '2026-11-05T00:00:00Z',
    resolved_at: null,
    resolved_by: null,
  };
}

describe('format check sources', () => {
  it('keeps a team_audit row in the runtime state and drops an unknown source', () => {
    const runtime = { ...emptyRuntime(), checks: [checkRow('team_audit'), checkRow('made_up')] };
    const { state } = buildRuntimeState({ tunables: [] }, runtime, { tunables: undefined, amendments: undefined });
    expect(state.checks.map((c) => c.source)).toEqual(['team_audit']);
  });

  it('lists exactly the sources of the migration CHECK', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', MIGRATION), 'utf8');
    const match = /ADD CONSTRAINT format_checks_source_check CHECK \(\s*source IN \(([^)]*)\)/.exec(sql);
    expect(match).not.toBeNull();
    const listed = [...(match?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...listed].sort()).toEqual([...FORMAT_CHECK_SOURCES].sort());
  });
});
