/**
 * Guest players in SQL (20261018160000_players_guest_identity.sql). No DB: replays the
 * migration texts in file order. Grants of the new RPC are also covered by the generic
 * replay in migration-api-grants.test.ts.
 *
 * - The last definition of players_identity_check admits guests (… OR is_guest).
 * - claim_guest_player is defined only here, deletes the source before it moves the
 *   identity onto the guest, clears is_guest, and is service-role only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const FILE = '20261018160000_players_guest_identity.sql';

/** Drop `--` line comments so prose never counts, and collapse whitespace. */
function code(sql: string): string {
  return sql
    .split('\n')
    .map((line) => (line.includes('--') ? line.slice(0, line.indexOf('--')) : line))
    .join('\n')
    .replace(/\s+/g, ' ');
}

const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((file) => ({ file, sql: code(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')) }));

const own = migrations.find((m) => m.file === FILE)?.sql ?? '';
const fnStart = own.indexOf('CREATE OR REPLACE FUNCTION public.claim_guest_player(');
const fnBody = own.slice(fnStart, own.indexOf('$$;', fnStart));

describe(FILE, () => {
  it('exists and sorts after every earlier migration that touches players_identity_check', () => {
    expect(own).not.toBe('');
    const touching = migrations.filter((m) => /players_identity_check/.test(m.sql)).map((m) => m.file);
    expect(touching[touching.length - 1]).toBe(FILE);
  });

  it('replayed in order, the final players_identity_check admits guests', () => {
    let current: string | null = null;
    for (const { sql } of migrations) {
      const re = /(DROP CONSTRAINT (?:IF EXISTS )?players_identity_check)|ADD CONSTRAINT players_identity_check CHECK \((.*?)\) ?;/g;
      for (const m of sql.matchAll(re)) {
        current = m[1] ? null : m[2].trim();
      }
    }
    expect(current).toBe('discord_id IS NOT NULL OR auth_user_id IS NOT NULL OR is_guest');
  });

  it('drops the old check before adding the new one, inside one transaction', () => {
    const begin = own.indexOf('BEGIN;');
    const drop = own.indexOf('ALTER TABLE public.players DROP CONSTRAINT players_identity_check;');
    const add = own.indexOf('ADD CONSTRAINT players_identity_check');
    const commit = own.lastIndexOf('COMMIT;');
    expect(begin).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(begin);
    expect(add).toBeGreaterThan(drop);
    expect(commit).toBeGreaterThan(add);
  });

  it('is the only definition of claim_guest_player', () => {
    const definers = migrations
      .filter((m) => /FUNCTION public\.claim_guest_player\s*\(/.test(m.sql))
      .map((m) => m.file);
    expect(definers).toEqual([FILE]);
    expect(fnStart).toBeGreaterThan(0);
  });

  it('claim_guest_player deletes the source first, then moves the identity and clears is_guest', () => {
    const del = fnBody.indexOf('DELETE FROM public.players WHERE id = p_source_id;');
    const upd = fnBody.indexOf('UPDATE public.players SET discord_id = v_source.discord_id, auth_user_id = v_source.auth_user_id, is_guest = false WHERE id = p_guest_id AND is_guest');
    expect(del).toBeGreaterThan(0);
    expect(upd).toBeGreaterThan(del);
    // Eligibility checks raise before any write.
    const firstRaise = fnBody.indexOf("Target player % is not a guest account");
    const sourceRaise = fnBody.indexOf('Source player % is not a registered account');
    expect(firstRaise).toBeGreaterThan(0);
    expect(sourceRaise).toBeGreaterThan(0);
    expect(firstRaise).toBeLessThan(del);
    expect(sourceRaise).toBeLessThan(del);
    // Locks both rows before reading them.
    expect(fnBody.indexOf('FOR UPDATE')).toBeLessThan(firstRaise);
    // Not an owner-rights escape hatch.
    expect(fnBody).not.toMatch(/SECURITY DEFINER/i);
    expect(fnBody).toMatch(/SET search_path = public/);
  });

  it('claim_guest_player refuses a banned or suspended source (55000) before any write', () => {
    const del = fnBody.indexOf('DELETE FROM public.players WHERE id = p_source_id;');
    const statusCheck = fnBody.indexOf("IF v_source.status IS DISTINCT FROM 'active' THEN");
    expect(statusCheck).toBeGreaterThan(0);
    expect(statusCheck).toBeLessThan(del);
    expect(fnBody.slice(statusCheck, del)).toMatch(/RAISE EXCEPTION [^;]*USING ERRCODE = '55000';/);
  });

  it('claim_guest_player refuses (23503) while a CASCADE / SET NULL reference still holds source rows, before the DELETE', () => {
    // Regression: the DELETE used to cascade into the source's presets, cast sessions, AI generations,
    // achievements, ... and the claim still returned success.
    const del = fnBody.indexOf('DELETE FROM public.players WHERE id = p_source_id;');
    const loop = fnBody.indexOf("AND c.confrelid = 'public.players'::regclass AND c.confdeltype IN ('c', 'n', 'd')");
    expect(loop).toBeGreaterThan(0);
    expect(loop).toBeLessThan(del);
    const check = fnBody.slice(loop, del);
    // Every referencing column is probed with the source id (identifiers quoted, value bound).
    expect(check).toMatch(/EXECUTE format\('SELECT EXISTS \(SELECT 1 FROM %I\.%I WHERE %I = \$1\)'/);
    expect(check).toMatch(/USING p_source_id;/);
    expect(check).toMatch(/IF v_referenced THEN RAISE EXCEPTION [^;]*USING ERRCODE = '23503';/);
    // Only tables registered as disposable per-viewer state are exempt (no table name is hard-coded here).
    expect(check).toContain(
      'AND NOT EXISTS (SELECT 1 FROM public.player_claim_disposable_refs d WHERE d.table_ref = c.conrelid)',
    );
    expect(check).not.toMatch(/relname IN \(/);
    // The public registry is seeded with its own disposable tables only; user-owned tables are never on it.
    const seed = own.match(/INSERT INTO public\.player_claim_disposable_refs \(table_ref, reason\) VALUES([^;]*);/)?.[1] ?? '';
    expect([...seed.matchAll(/'public\.(\w+)'::regclass/g)].map((m) => m[1])).toEqual([
      'epb_animation_views',
      'admin_export_limits',
    ]);
    // The registry is service-role only with RLS on.
    expect(own).toMatch(/ALTER TABLE public\.player_claim_disposable_refs ENABLE ROW LEVEL SECURITY;/);
    expect(own).toMatch(/REVOKE ALL ON TABLE public\.player_claim_disposable_refs FROM PUBLIC, anon, authenticated;/);
  });

  it('claim_guest_player is executable by service_role only', () => {
    expect(own).toMatch(
      /REVOKE ALL ON FUNCTION public\.claim_guest_player\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(own).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_guest_player\(uuid, uuid\) TO service_role;/);
    expect(own).not.toMatch(/GRANT [^;]*claim_guest_player[^;]* TO [^;]*(anon|authenticated|PUBLIC)/i);
  });
});
