import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261120100000_phase_transfer.sql'), 'utf8');

function body(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$$;', sql.indexOf('AS $$', start) + 5);
  return sql.slice(start, end);
}

function position(code: string, needle: string): number {
  const at = code.indexOf(needle);
  expect(at, needle).toBeGreaterThanOrEqual(0);
  return at;
}

describe('P6 transfer migration (plan 4.D transfer-order acceptance)', () => {
  it('lets no API role execute any transfer function', () => {
    const functions = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(phase_transfer\w*)\(/g)].map((m) => m[1]);
    expect(functions.length).toBeGreaterThan(10);
    for (const name of functions) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`));
    }
    expect(sql).not.toMatch(/GRANT EXECUTE/i);
    expect(sql).not.toMatch(/SECURITY DEFINER/i);
    expect(body('phase_transfer__begin')).toContain("IF current_user <> 'postgres' THEN");
  });

  it('opens both new tables to service_role reads only, behind RLS', () => {
    for (const table of ['phase_transfer_ledger', 'phase_transfer_lineage']) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated, service_role;`);
      expect(sql).toContain(`GRANT SELECT ON TABLE public.${table} TO service_role;`);
    }
  });

  it('forward retargets every SET NULL pointer before it deletes, and deletes matches before teams', () => {
    const forward = body('phase_transfer_forward');
    const firstDelete = position(forward, 'DELETE FROM public.');
    for (const update of ['UPDATE public.agent_suggestions', 'UPDATE public.cast_sessions', 'UPDATE public.player_streaks', 'UPDATE public.teams', 'UPDATE public.format_challenges']) {
      expect(position(forward, update)).toBeLessThan(firstDelete);
    }
    const matches = position(forward, 'DELETE FROM public.matches');
    expect(matches).toBeLessThan(position(forward, 'DELETE FROM public.teams'));
    expect(position(forward, 'DELETE FROM public.teams')).toBeLessThan(position(forward, 'DELETE FROM public.tournaments'));
    expect(position(forward, 'PHASE_TRANSFER_POINTER_NULLED')).toBeGreaterThan(position(forward, 'DELETE FROM public.tournaments'));
  });

  it('refuses orphan group slots and unconverted trash before the first write', () => {
    const forward = body('phase_transfer_forward');
    const copy = position(forward, "phase_transfer__copy('forward')");
    expect(position(forward, 'PHASE_TRANSFER_GROUP_ORPHANS')).toBeLessThan(copy);
    expect(position(forward, 'PHASE_TRANSFER_TRASH_CONVERSION_REQUIRED')).toBeLessThan(copy);
  });

  it('inverse restores the tournament (with its season) before groups and groups before rounds, under the shared lock order', () => {
    const manifest = body('phase_transfer__manifest');
    const inverse = manifest.slice(manifest.indexOf("WHERE p_direction = 'forward'"));
    const seq = (src: string) => Number(new RegExp(`\\((\\d+), '${src}', `).exec(inverse)?.[1]);
    expect(seq('league_phases')).toBeLessThan(seq('phase_groups'));
    expect(seq('phase_groups')).toBeLessThan(seq('phase_group_members'));
    expect(seq('phase_group_members')).toBeLessThan(seq('phase_rounds'));
    for (const name of ['phase_transfer_forward', 'phase_transfer_inverse']) {
      expect(body(name)).toContain('v_seasons := public.phase_transfer__lock();');
    }
  });

  it('moves the format challenge phase FK with the phase instead of leaving it dropped', () => {
    const forward = body('phase_transfer_forward');
    expect(position(forward, "phase_transfer__point_challenges('league_phases')")).toBeLessThan(position(forward, 'DELETE FROM public.tournaments'));
    expect(position(forward, 'PHASE_TRANSFER_CHALLENGE_UNMOVABLE')).toBeLessThan(position(forward, "phase_transfer__copy('forward')"));
    const inverse = body('phase_transfer_inverse');
    expect(position(inverse, "phase_transfer__point_challenges('tournaments')")).toBeLessThan(position(inverse, 'DELETE FROM public.league_phases'));
    expect(body('phase_transfer__point_challenges')).toContain('ON DELETE CASCADE');
    expect(sql).not.toMatch(/DROP CONSTRAINT format_challenges_phase_id_fkey;/);
  });

  it('keeps lineage across directions and gates activation on it', () => {
    expect(sql).not.toMatch(/DELETE FROM public\.phase_transfer_lineage/);
    expect(body('phase_transfer_activate')).toContain('PHASE_TRANSFER_LINEAGE_MISSING');
    expect(body('phase_transfer_activate')).toContain("phase_storage_transition('frozen_phase', 'phase')");
  });
});
