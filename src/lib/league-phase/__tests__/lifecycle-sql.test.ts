import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { phaseMachine } from '../phase-state';
import { phaseRoundMachine } from '../phase-round-state';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261117110000_phase_lifecycle.sql'), 'utf8');
const rosterSql = readFileSync(join(process.cwd(), 'supabase/migrations/20261118090000_phase_roster_group_integrity.sql'), 'utf8');
const orderSql = readFileSync(join(process.cwd(), 'supabase/migrations/20261118100000_phase_admin_insert.sql'), 'utf8');
const definitions = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([\s\S]*?)END \$\$;|CREATE OR REPLACE FUNCTION public\.(season_group__league_scheduled)\(([\s\S]*?)\$\$;/g)];
const body = (name: string) => {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.' + name + '(');
  expect(start, name).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$$;', start);
  return sql.slice(start, end + 3);
};

describe('native lifecycle SQL', () => {
  it('checks the whole live order under the season and phase locks before inserting or reordering', () => {
    const boundary = orderSql.indexOf('CREATE OR REPLACE FUNCTION public.phase_stage_orders_reorder');
    const insert = orderSql.slice(0, boundary);
    const reorder = orderSql.slice(boundary);
    for (const sql of [insert, reorder]) {
      expect(sql).toContain('ORDER BY id FOR NO KEY UPDATE');
      expect(sql.indexOf('pg_advisory_xact_lock')).toBeLessThan(sql.indexOf('FOR KEY SHARE'));
      expect(sql.indexOf('FOR KEY SHARE')).toBeLessThan(sql.indexOf('FOR NO KEY UPDATE'));
      expect(sql.indexOf('FOR NO KEY UPDATE')).toBeLessThan(sql.indexOf('UPDATE public.league_phases'));
    }
    expect(insert.indexOf('PHASE_INSERT_LOCKED')).toBeLessThan(insert.indexOf('UPDATE public.league_phases'));
    expect(insert).toContain('RETURNING id');
    expect(reorder.indexOf('PHASE_REORDER_INCOMPLETE')).toBeLessThan(reorder.indexOf('UPDATE public.league_phases'));
    expect(reorder.indexOf('PHASE_REORDER_LOCKED')).toBeLessThan(reorder.indexOf('UPDATE public.league_phases'));
    expect(orderSql).not.toMatch(/phase_storage_transition|SECURITY DEFINER|DISABLE TRIGGER/i);
  });

  it('preserves retained group rows and rejects scheduled removals before changing the roster or freeze flag', () => {
    const replace = rosterSql.slice(0, rosterSql.indexOf('CREATE OR REPLACE FUNCTION public.phase_enrollment_replace'));
    expect(replace).toMatch(/DELETE FROM public\.phase_participants p WHERE p\.phase_id = p_phase_id\s+AND NOT EXISTS/);
    expect(replace).toContain('ON CONFLICT (phase_id, player_id) DO UPDATE SET seed = EXCLUDED.seed;');
    expect(replace.indexOf('public.phase__lock')).toBeLessThan(replace.indexOf('PHASE_GROUP_ROSTER_SCHEDULED'));
    expect(replace.indexOf('PHASE_GROUP_ROSTER_SCHEDULED')).toBeLessThan(replace.indexOf('DELETE FROM'));
    const edit = rosterSql.slice(rosterSql.indexOf('CREATE OR REPLACE FUNCTION public.phase_participant_edit'));
    expect(edit.indexOf('public.phase__lock')).toBeLessThan(edit.indexOf('PHASE_GROUP_ROSTER_SCHEDULED'));
    expect(edit.indexOf('PHASE_GROUP_ROSTER_SCHEDULED')).toBeLessThan(edit.indexOf('public.phase_enrollment_freeze'));
    expect(rosterSql).not.toMatch(/ALTER TABLE|phase_storage_transition|DISABLE TRIGGER|SECURITY DEFINER/i);
  });

  it('is additive and leaves native activation to the operator fence', () => {
    expect(sql).toMatch(/^BEGIN;/);
    expect(sql.trim()).toMatch(/COMMIT;$/);
    expect(sql).not.toMatch(/CREATE TABLE|ALTER TABLE|phase_storage_transition|DISABLE TRIGGER|session_replication_role|SECURITY DEFINER|EXECUTE\s+(?:format|quote)/i);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.(round_write|round_complete|round_delete|bracket_write|tournament_enrollment_replace|tournament_enrollment_freeze|phase_complete_at_stage_end)\(/);
  });

  it('fixes the search path and explicitly closes every function to API roles', () => {
    const names = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map(match => match[1]);
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) {
      expect(body(name)).toContain('SET search_path = public, pg_temp');
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(sql).toMatch(new RegExp('REVOKE ALL ON FUNCTION public\\.' + escaped + '\\([^;]+FROM PUBLIC, anon, authenticated;'));
      expect(sql).toMatch(new RegExp('GRANT EXECUTE ON FUNCTION public\\.' + escaped + '\\([^;]+TO service_role;'));
    }
    expect(sql).not.toMatch(/GRANT[^;]+TO (?:PUBLIC|anon|authenticated)/i);
  });

  it('uses native tables exclusively except the deliberate inverse schedule-lock union', () => {
    expect(definitions.length).toBeGreaterThan(20);
    for (const name of ['phase_round_write', 'phase_bracket_write', 'phase_enrollment_replace', 'phase_enrollment_freeze', 'league_phase_complete_at_stage_end', 'phase_round_complete', 'phase_round_delete', 'phase_participant_swap', 'phase_group_write']) {
      expect(body(name)).not.toMatch(/public\.(tournaments|tournament_participants|tournament_groups|tournament_group_members|rounds|matches|games)\b/);
    }
    expect(body('season_group__league_scheduled')).toContain('public.rounds');
    expect(body('season_group__league_scheduled')).toContain('public.phase_rounds');
  });

  it('locks league then parent before child writes', () => {
    const lock = body('phase__lock');
    expect(lock.indexOf('pg_advisory_xact_lock')).toBeLessThan(lock.indexOf('public.seasons WHERE'));
    expect(lock.indexOf('public.seasons WHERE')).toBeLessThan(lock.indexOf('FOR NO KEY UPDATE'));
    for (const name of ['phase_participant_edit', 'phase_participant_swap', 'phase_participant_seeds', 'phase_enrollment_replace', 'phase_group_write', 'phase_group_member_swap', 'phase_group_member_move', 'phase_group_row_handover']) {
      const fn = body(name);
      expect(fn.indexOf('public.phase__lock(')).toBeLessThan(fn.search(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.phase_/));
    }
  });

  it('retains first-round mirrored group parity and the inverse schedule guard', () => {
    expect(sql).toContain('CREATE TRIGGER trg_phase_rounds_league_groups_guard BEFORE INSERT');
    const guard = body('phase_rounds__league_groups_guard');
    expect(guard).toContain("'PHASE_GROUPS_STALE'");
    expect(guard.match(/\bEXCEPT\b/g)).toHaveLength(2);
    expect(guard).toContain('public.season_group_members');
    expect(guard).toContain('public.phase_participants');
    expect(guard.indexOf('public.phase__lock')).toBeLessThan(guard.indexOf('EXCEPT'));
  });

  it('preserves enrollment timestamp CAS, frozen flag and no-round checks under the parent lock', () => {
    const replace = body('phase_enrollment_replace');
    expect(replace).toContain("(v_current ->> 'synced_at') IS DISTINCT FROM p_expected_synced_at");
    expect(replace).toContain("'enrollment_frozen'");
    expect(replace).toContain("'enrollment_rounds_exist'");
    expect(replace).toContain("jsonb_build_object('frozen', coalesce(v_current ->> 'frozen', 'false') = 'true')");
    expect(body('phase_enrollment_freeze')).toContain("jsonb_set(enrollment_source, '{frozen}', 'true'::jsonb)");
  });

  it('preserves round retry and completion contention guards and machine sources', () => {
    const write = body('phase_round_write');
    expect(write).toContain("IF v_status = 'completed' THEN");
    expect(write).toContain('FOR NO KEY UPDATE');
    expect(write).toContain("'rounds_round_completed'");
    expect(write).toContain("'rounds_round_already_written'");
    expect(write).toContain('public.format__check_revision');
    expect(write).toContain("t.status IN ('upcoming', 'active')");
    expect(phaseMachine.sourcesOf('active')).toContain('upcoming');
    const complete = body('phase_round_complete');
    expect(phaseRoundMachine.sourcesOf('completed')).toEqual(['active', 'pending']);
    expect(complete).toContain("status IN ('pending', 'active')");
    expect(complete.indexOf('FOR UPDATE')).toBeLessThan(complete.indexOf('SELECT count(*)'));
    expect(complete).toContain('AND NOT p_force');
    expect(complete).toContain("'already_completed'");
  });

  it('retains bracket expected-state and played-match fences before replacement', () => {
    const bracket = body('phase_bracket_write');
    expect(bracket.indexOf('v_status <> p_expected_status')).toBeLessThan(bracket.indexOf('IF p_replace THEN'));
    expect(bracket).toContain("'tournament_status_changed'");
    expect(bracket).toContain("'bracket_already_generated'");
    expect(bracket).toContain("'bracket_matches_played'");
    expect(bracket.indexOf('ORDER BY r.id FOR UPDATE')).toBeLessThan(bracket.indexOf('ORDER BY m.id FOR UPDATE'));
    expect(bracket.indexOf('FROM public.phase_games')).toBeLessThan(bracket.indexOf('DELETE FROM public.phase_matches'));
    expect(bracket).toContain('AND status = p_expected_status');
    expect(bracket).toContain('public.phase_enrollment_freeze(p_phase_id)');
  });

  it('does not overwrite stage-end completion after an unseen native match appeared', () => {
    const complete = body('league_phase_complete_at_stage_end');
    expect(complete).toContain("v_row.status <> 'active'");
    expect(complete).toContain('m.id <> ALL (p_known_unfinished)');
    expect(complete).toContain("'unsettled'");
    expect(complete).toContain("AND status = 'active'");
    expect(complete).toContain("'phase', to_jsonb(v_row)");
  });

  it('uses actual P1 challenge pointer columns and cancels under the same round-delete transaction', () => {
    const deletion = body('phase_round_delete');
    expect(deletion).toContain('c.league_phase_id = v_phase');
    expect(deletion).toContain('WHERE phase_match_id IN');
    expect(deletion).not.toContain('native_phase_id');
    expect(deletion.indexOf('public.format_challenges SET')).toBeLessThan(deletion.indexOf('DELETE FROM public.phase_matches'));
    expect(deletion).toContain("'round_changed'");
  });

  it('allows a parent deletion cascade and keeps native timestamps equivalent', () => {
    for (const guard of ['phase_groups__guard', 'phase_group_members__guard', 'phase_participants__lock']) {
      expect(body(guard)).toContain("IF NOT EXISTS (SELECT 1 FROM public.league_phases WHERE id = OLD.phase_id) THEN RETURN OLD;");
    }
    for (const table of ['league_phases', 'phase_rounds', 'phase_groups']) {
      expect(sql).toContain('BEFORE UPDATE ON public.' + table);
    }
  });

  it('updates seeds atomically after checking final duplicate ownership and preserves omitted starting brackets', () => {
    const seeds = body('phase_participant_seeds');
    expect(seeds.indexOf("'SEED_CONFLICT'")).toBeLessThan(seeds.indexOf('SET seed = NULL'));
    expect(seeds).toContain('coalesce(e.starting_bracket, p.starting_bracket)');
    expect(seeds).toContain('ORDER BY player_id, ord DESC');
    expect(seeds).not.toMatch(/FOR\s+\w+\s+IN/i);
  });
});
