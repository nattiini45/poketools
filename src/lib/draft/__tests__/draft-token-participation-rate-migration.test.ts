/**
 * Static contract of the "Draft Kill Token rate" migration (20261027193000). No DB: reads the migration text. The
 * behaviour on a real Postgres (a normal line costs 1 x the price and counts 1; a rated line costs rate x the price and
 * counts rate; the allowance and the unspent-points refusals) is replayed by draft-token-participation-rate.live-db.test.ts.
 *
 * - epb_draft_token_purchases gets tokens_used (smallint, NOT NULL, default 1, CHECK 1..10): every existing purchase
 *   counts as one token, as before.
 * - epb_purchase_draft_token gains p_tokens_per_progress (default 1, validated 1..10) as its LAST parameter; the old
 *   signature is dropped, the new one is the latest definition in the tree, and its privileges are re-issued
 *   (service_role only).
 * - Apart from the rate it is a copy of the latest earlier definition: the refusal order, the window, the line limit
 *   (one purchase per line + the legacy tracker comparison) and the would-evolve check are untouched, and progress
 *   stays +1.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const read = (file: string): string => readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n');
const FILE = '20261027193000_draft_token_participation_rate.sql';
const BASE_FILE = '20261018180000_league_groups.sql';
const SQL = read(FILE);

function fnBody(sql: string, header: RegExp): string {
  const match = header.exec(sql);
  if (!match) throw new Error(`missing ${header}`);
  return sql.slice(match.index, sql.indexOf('END $$;', match.index) + 'END $$;'.length);
}

const code = (body: string): string[] =>
  body
    .split('\n')
    .map((l) => l.replace(/--.*$/, '').trim())
    .filter(Boolean);

const NEW = fnBody(SQL, /CREATE FUNCTION public\.epb_purchase_draft_token\(/);
const BASE = fnBody(read(BASE_FILE), /CREATE OR REPLACE FUNCTION public\.epb_purchase_draft_token\(/);

describe('20261027193000_draft_token_participation_rate.sql', () => {
  it('is the latest definition of epb_purchase_draft_token in the tree', () => {
    const definers = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql') && /FUNCTION public\.epb_purchase_draft_token\(/.test(read(f)))
      .sort();
    expect(definers.at(-1)).toBe(FILE);
    // No later file redefines it (a later migration of another subject may exist; it must not touch this function).
    expect(
      readdirSync(DIR).filter(
        (f) => f.endsWith('.sql') && f > FILE && /FUNCTION public\.epb_purchase_draft_token\(/.test(read(f)),
      ),
    ).toEqual([]);
  });

  it('adds tokens_used to the ledger: smallint, NOT NULL, default 1, CHECK 1..10', () => {
    expect(SQL).toMatch(/ALTER TABLE public\.epb_draft_token_purchases\s+ADD COLUMN tokens_used smallint NOT NULL DEFAULT 1/);
    expect(SQL).toMatch(/CHECK \(tokens_used BETWEEN 1 AND 10\)/);
  });

  it('drops the old signature first and adds the rate as the last parameter with default 1', () => {
    const drop = SQL.indexOf('DROP FUNCTION public.epb_purchase_draft_token(uuid, uuid, uuid, text, integer, uuid);');
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(SQL.indexOf('CREATE FUNCTION public.epb_purchase_draft_token('));
    expect(NEW.split('\n').slice(0, 2).join(' ')).toBe(
      'CREATE FUNCTION public.epb_purchase_draft_token(p_season_id uuid, p_player_id uuid, p_actor_id uuid, p_line_id text,' +
        '   p_next_threshold integer, p_client_request_id uuid, p_tokens_per_progress integer DEFAULT 1) RETURNS jsonb',
    );
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION/);
  });

  it('validates the rate (1..10) before taking the season lock', () => {
    const body = code(NEW).join('\n');
    expect(body).toContain('IF p_tokens_per_progress IS NULL OR p_tokens_per_progress < 1 OR p_tokens_per_progress > 10 THEN');
    expect(body).toContain("jsonb_build_object('field', 'tokens_per_progress')");
    expect(body.indexOf('p_tokens_per_progress > 10')).toBeLessThan(body.indexOf('pg_advisory_xact_lock'));
  });

  it('weights the allowance by tokens_used and prices the purchase at rate x the base price', () => {
    const body = code(NEW).join('\n');
    expect(body).toContain('COALESCE((SELECT sum(tokens_used) FROM public.epb_draft_token_purchases');
    expect(body).toContain('IF v_owned + p_tokens_per_progress > v_rules.draft_token_max THEN');
    expect(body).toContain('v_cost := p_tokens_per_progress * v_rules.draft_token_ratio;');
    expect(body).toContain('IF v_remaining < v_cost THEN');
    // The ledger row, the log and the result all carry the scaled values; progress stays +1.
    expect(body).toContain('points_spent, tokens_used, client_request_id, created_by)');
    expect(body).toContain('v_cost, p_tokens_per_progress, p_client_request_id, p_actor_id)');
    expect(body).toContain("epb_apply_progress(v_tracker.id, 'draft_token', 1, NULL, 'Draft Kill Token', p_actor_id)");
    expect(body).not.toMatch(/v_rules\.draft_token_ratio,\s*p_client_request_id/);
  });

  it('is a copy of the latest earlier definition except for the rate', () => {
    const was = code(BASE);
    const now = code(NEW);
    // Every refusal and the order they are checked in survive verbatim.
    const raised = (lines: string[]) =>
      lines.join('\n').match(/RAISE EXCEPTION '[A-Z_]+'/g) ?? [];
    const baseRaised = raised(was);
    const newRaised = raised(now);
    expect(newRaised.filter((r) => r !== "RAISE EXCEPTION 'INVALID_CONFIG'")).toEqual(
      baseRaised.filter((r) => r !== "RAISE EXCEPTION 'INVALID_CONFIG'"),
    );
    // The cap per line and the legacy tracker comparison are untouched.
    for (const line of [
      'v_line_has := EXISTS (SELECT 1 FROM public.epb_draft_token_purchases',
      'WHERE season_id = p_season_id AND player_id = p_player_id AND line_id = p_line_id)',
      'AND draft_tokens >= v_rules.draft_token_max_per_line);',
      'IF v_line_has THEN RAISE EXCEPTION \'TOKEN_LINE_LIMIT\' USING ERRCODE = \'P0001\'; END IF;',
      'IF v_tracker.total_kos + 1 >= p_next_threshold THEN',
      'IF p_next_threshold IS NULL THEN RAISE EXCEPTION \'LINE_FULLY_EVOLVED\' USING ERRCODE = \'P0001\'; END IF;',
      "IF NOT FOUND OR v_initial.phase <> 'complete' THEN",
      'v_remaining := COALESCE(public.epb__season_remaining_points(p_season_id, p_player_id), 0);',
    ]) {
      expect(was).toContain(line);
      expect(now).toContain(line);
    }
    // Lines that exist only in the old definition: the unscaled price and the one-row-one-token count.
    const removed = was.filter((l) => !now.includes(l));
    expect(removed.some((l) => l.includes('v_owned := (SELECT count(*) FROM public.epb_draft_token_purchases'))).toBe(true);
    expect(removed.some((l) => l.includes('IF v_owned >= v_rules.draft_token_max THEN'))).toBe(true);
    expect(removed.some((l) => l.includes('IF v_remaining < v_rules.draft_token_ratio THEN'))).toBe(true);
  });

  it('re-issues the privileges for the new signature: service_role only', () => {
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.epb_purchase_draft_token\(uuid, uuid, uuid, text, integer, uuid, integer\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.epb_purchase_draft_token\(uuid, uuid, uuid, text, integer, uuid, integer\) TO service_role;/,
    );
    expect(SQL).not.toMatch(/GRANT[^;]*\b(?:anon|authenticated|PUBLIC)\b/);
    // Same shape as the original block (service_role only).
    expect(read(BASE_FILE)).toMatch(/GRANT EXECUTE ON FUNCTION[^;]*public\.epb_purchase_draft_token\(uuid, uuid, uuid, text, integer, uuid\),[^;]*TO service_role;/);
  });

  it('runs in one transaction', () => {
    expect(SQL).toMatch(/^BEGIN;$/m);
    expect(SQL).toMatch(/^COMMIT;$/m);
  });
});
