/**
 * Static contract of 20261102140000_legacy_draft_roster_lock.sql (issue #46). No DB: reads the migration text.
 *
 * - The roster is refused (SEASON_DRAFT_LOCKED) only for a legacy pool whose status is in_progress.
 * - The removal function and the join trigger replace the 20261018202100 bodies, keeping every group rule.
 * - The league recycle bin still restores: season_participants (step 20) goes in before draft_pools (steps 40/50),
 *   so the join guard never sees a live legacy pool while a restore runs.
 *
 * The behaviour on a real Postgres is src/lib/draft/__tests__/legacy-roster-lock.local.test.ts (`npm run test:db`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { DRAFT_ERROR_STATUS, isDraftErrorCode } from '@/lib/draft/errors';

const DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const read = (file: string): string => readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = read('20261102140000_legacy_draft_roster_lock.sql');
const BASE = read('20261018202100_league_groups_participant_lock.sql');

function fnBody(sql: string, signature: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${signature}`);
  if (start < 0) throw new Error(`missing ${signature}`);
  const dollar = sql.indexOf('$$', start);
  const end = sql.indexOf('$$', dollar + 2);
  return sql.slice(start, end + 2);
}

const lines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean);

describe('20261102140000_legacy_draft_roster_lock.sql', () => {
  const predicate = fnBody(MIGRATION, 'season__legacy_draft_live(');
  const remove = fnBody(MIGRATION, 'season_participant_remove(');
  const guard = fnBody(MIGRATION, 'season_participants__group_guard(');

  it('the predicate is a legacy pool of the league with status in_progress, nothing else', () => {
    expect(predicate).toContain("engine = 'legacy'");
    expect(predicate).toContain("status = 'in_progress'");
    expect(predicate).toContain('season_id = p_season_id');
    expect(predicate).not.toContain('pending');
    expect(predicate).not.toContain("'complete'");
  });

  it('removal takes the season lock, then refuses a live legacy pool before any group rule', () => {
    const lock = remove.indexOf('pg_advisory_xact_lock(hashtext(p_season_id::text))');
    const refusal = remove.indexOf("RAISE EXCEPTION 'SEASON_DRAFT_LOCKED'");
    const groups = remove.indexOf('SELECT m.group_id');
    expect(lock).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(lock);
    expect(groups).toBeGreaterThan(refusal);
    expect(remove).toContain('public.season__legacy_draft_live(p_season_id)');
  });

  it('removal keeps every group rule of 20261018202100', () => {
    const baseRemove = fnBody(BASE, 'season_participant_remove(');
    const kept = lines(baseRemove).filter((l) => /SEASON_GROUP|season_group|DELETE FROM|RETURN v_n/.test(l));
    expect(kept.length).toBeGreaterThan(5);
    const have = new Set(lines(remove));
    expect(kept.filter((l) => !have.has(l))).toEqual([]);
  });

  it('the join guard checks the live legacy pool before the no-groups early return, and takes no lock for a plain league', () => {
    const early = guard.indexOf('RETURN NEW;');
    const refusal = guard.indexOf("RAISE EXCEPTION 'SEASON_DRAFT_LOCKED'");
    expect(early).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(early);
    expect(guard).toContain("engine = 'legacy'");
    expect(guard.indexOf('pg_advisory_xact_lock')).toBeGreaterThan(early);
    expect(guard).toContain("RAISE EXCEPTION 'SEASON_GROUPS_SCHEDULED'");
  });

  it('adds no trigger and no table, so league_trash__inventory() stays complete', () => {
    expect(MIGRATION).not.toMatch(/CREATE (CONSTRAINT )?TRIGGER/i);
    expect(MIGRATION).not.toMatch(/CREATE TABLE/i);
    expect(MIGRATION).not.toMatch(/ALTER TABLE/i);
  });

  it('revokes every function from the API roles and grants service_role only', () => {
    expect(MIGRATION).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated;/);
    expect(MIGRATION).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role;/);
    expect(MIGRATION).not.toMatch(/TO\s+(anon|authenticated|PUBLIC)/);
  });

  it('SEASON_DRAFT_LOCKED is a catalogued draft error answered with 409', () => {
    expect(isDraftErrorCode('SEASON_DRAFT_LOCKED')).toBe(true);
    expect(DRAFT_ERROR_STATUS.SEASON_DRAFT_LOCKED).toBe(409);
    expect(errorsDraft.en.SEASON_DRAFT_LOCKED).toMatch(/roster|Trainers/);
    expect(errorsDraft.de.SEASON_DRAFT_LOCKED).toMatch(/Kader/);
  });
});

describe('20261102150100_legacy_draft_roster_lock_serialize.sql', () => {
  const SERIALIZE = read('20261102150100_legacy_draft_roster_lock_serialize.sql');
  const activation = fnBody(SERIALIZE, 'draft_pools__serialize_activation(');
  const swap = fnBody(SERIALIZE, 'season_participants__swap_guard(');

  it('a pool going live takes the season lock of the roster guards, only for a legacy pool entering in_progress', () => {
    expect(activation).toContain("NEW.engine = 'legacy'");
    expect(activation).toContain("NEW.status = 'in_progress'");
    expect(activation).toContain('OLD.status IS DISTINCT FROM NEW.status');
    expect(activation).toContain('pg_advisory_xact_lock(hashtext(NEW.season_id::text))');
    expect(SERIALIZE).toMatch(/BEFORE UPDATE OF status ON public\.draft_pools/);
  });

  it('the substitution swap takes the same lock before it looks for a live legacy pool, and a plain league takes none', () => {
    const early = swap.indexOf('RETURN NEW;');
    const lock = swap.indexOf('pg_advisory_xact_lock(hashtext(NEW.season_id::text))');
    const refusal = swap.indexOf("RAISE EXCEPTION 'SEASON_DRAFT_LOCKED'");
    expect(early).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(early);
    expect(refusal).toBeGreaterThan(lock);
    expect(swap).toContain('public.season__legacy_draft_live(NEW.season_id)');
    expect(SERIALIZE).toMatch(/BEFORE UPDATE OF player_id ON public\.season_participants[\s\S]*WHEN \(OLD\.player_id IS DISTINCT FROM NEW\.player_id\)/);
  });

  it('adds no INSERT trigger, table or policy, so league_trash__inventory() stays complete', () => {
    expect(SERIALIZE).not.toMatch(/CREATE TRIGGER[^;]*INSERT/i);
    expect(SERIALIZE).not.toMatch(/CREATE TABLE|CREATE POLICY/i);
    expect(SERIALIZE).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated;/);
    expect(SERIALIZE).not.toMatch(/TO\s+(anon|authenticated|PUBLIC)/);
  });
});

describe('league recycle bin restore order', () => {
  const restore = read('20261026091000_league_trash.sql');
  const plan = fnBody(restore, 'league_trash__restore_plan(');
  const stepOf = (rel: string): number[] =>
    [...plan.matchAll(new RegExp(`\\((\\d+),\\s*'${rel}'`, 'g'))].map((m) => Number(m[1]));

  it('restores season_participants before any draft_pools row', () => {
    const [participants] = stepOf('season_participants');
    const pools = stepOf('draft_pools');
    expect(pools).toHaveLength(2);
    expect(participants).toBeLessThan(Math.min(...pools));
  });

  it('no later migration redefines the plan (this pin reads the only definition)', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).filter((f) => read(f).includes('FUNCTION public.league_trash__restore_plan'));
    expect(files).toEqual(['20261026091000_league_trash.sql']);
  });
});
