/**
 * The Comeback Token rules in SQL (introduced by 20261018140000_epb_comeback_rules.sql). No DB:
 * reads the migration text. The live behaviour is covered by the maintainers' local-stack RPC suite.
 *
 * - The one-time precondition and CHECK (no legacy kill_token grant stock) live in that file.
 * - The rule checks run against the LATEST definition of `epb_spend_comeback_tokens`, whichever
 *   later migration replaces it, so a redefinition must keep every rule:
 *   - the balance never reads `epb_token_grants`;
 *   - each allocation's `ratio` (1..10, default 1) is validated; a count that is not a multiple of
 *     it raises COMEBACK_TOKENS_NOT_MULTIPLE before any write; the ledger keeps tokens and the
 *     tracker gets count / ratio progress.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const FILE = '20261018140000_epb_comeback_rules.sql';
const DEFINER = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.epb_spend_comeback_tokens\s*\(/;

/** Drop `--` line comments so prose never counts. */
function stripComments(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.includes('--') ? line.slice(0, line.indexOf('--')) : line))
    .join('\n');
}

const code = stripComments(readFileSync(path.join(MIGRATIONS_DIR, FILE), 'utf8'));
const fnStart = code.indexOf('CREATE OR REPLACE FUNCTION public.epb_spend_comeback_tokens(');

/** Migrations defining the function, in apply order; the last one is what the database runs. */
const definers = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => DEFINER.test(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')));
const LATEST = definers[definers.length - 1];
const latestCode = stripComments(readFileSync(path.join(MIGRATIONS_DIR, LATEST), 'utf8'));
const latestStart = latestCode.indexOf('CREATE OR REPLACE FUNCTION public.epb_spend_comeback_tokens(');
const fnBody = latestCode.slice(latestStart, latestCode.indexOf('END $$;', latestStart));

describe(`${FILE} and the latest epb_spend_comeback_tokens (${LATEST})`, () => {
  it('introduces the rules, and no migration before it is the latest definition', () => {
    expect(fnStart).toBeGreaterThan(0);
    expect(definers).toContain(FILE);
    expect(LATEST >= FILE).toBe(true);
    expect(latestStart).toBeGreaterThan(0);
  });

  it('the spend function never reads the legacy grants', () => {
    expect(fnBody).not.toMatch(/epb_token_grants/);
    expect(fnBody).not.toMatch(/kill_token'\s*\)/); // no grant_type = 'kill_token' filter
  });

  it('the migration refuses to run while a legacy kill_token grant exists', () => {
    const guard = code.slice(0, fnStart);
    expect(guard).toMatch(/FROM public\.epb_token_grants WHERE grant_type = 'kill_token'/);
    expect(guard).toMatch(/IF v_rows > 0 THEN\s+RAISE EXCEPTION/);
  });

  it('a CHECK refuses every new kill_token grant, added after the precondition', () => {
    const guard = code.slice(0, fnStart);
    const check = guard.indexOf("ADD CONSTRAINT epb_token_grants_no_kill_token CHECK (grant_type <> 'kill_token')");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(guard.indexOf('IF v_rows > 0 THEN'));
    expect(guard.slice(check - 60, check)).toMatch(/ALTER TABLE public\.epb_token_grants\s+$/);
    expect(code).not.toMatch(/NOT VALID/);
  });

  it('validates ratio as an integer 1..10 when present', () => {
    expect(fnBody).toMatch(/WHEN NOT \(a \? 'ratio'\) THEN false/);
    expect(fnBody).toMatch(/\(a->>'ratio'\)::numeric NOT BETWEEN 1 AND 10/);
  });

  it('casts count and ratio only after their JSON type test (ordered CASE, not an OR chain)', () => {
    // PostgreSQL does not promise short-circuit OR, so a cast next to its type test in one OR chain
    // could raise a cast error instead of INVALID_CONFIG.
    const shapeStart = fnBody.indexOf('WHERE CASE');
    expect(shapeStart).toBeGreaterThan(0);
    const shape = fnBody.slice(shapeStart, fnBody.indexOf('END)', shapeStart));
    const typeCount = shape.indexOf("WHEN jsonb_typeof(a->'count') IS DISTINCT FROM 'number' THEN true");
    const castCount = shape.indexOf("(a->>'count')::numeric");
    const typeRatio = shape.indexOf("WHEN jsonb_typeof(a->'ratio') IS DISTINCT FROM 'number' THEN true");
    const castRatio = shape.indexOf("(a->>'ratio')::numeric");
    expect(typeCount).toBeGreaterThan(-1);
    expect(typeRatio).toBeGreaterThan(-1);
    expect(castCount).toBeGreaterThan(typeCount);
    expect(castRatio).toBeGreaterThan(typeRatio);
    // The array test is its own IF, before jsonb_array_length / jsonb_array_elements run.
    const arrayIf = fnBody.indexOf("jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' THEN");
    expect(arrayIf).toBeGreaterThan(0);
    expect(arrayIf).toBeLessThan(fnBody.indexOf('jsonb_array_length(p_allocations)'));
    // Integer casts go through numeric, so a JSON number written as 5.0 is not a cast error.
    expect(fnBody).not.toMatch(/->>'(count|ratio)'\)::int/);
  });

  it('refuses a non-multiple with its ratio, before the balance check and before any write', () => {
    const refusal = fnBody.indexOf("RAISE EXCEPTION 'COMEBACK_TOKENS_NOT_MULTIPLE'");
    expect(refusal).toBeGreaterThan(0);
    expect(fnBody.slice(refusal, fnBody.indexOf(';', refusal))).toMatch(/DETAIL = jsonb_build_object\('ratio', v_ratio\)/);
    expect(refusal).toBeLessThan(fnBody.indexOf("RAISE EXCEPTION 'COMEBACK_BALANCE_SHORT'"));
    expect(refusal).toBeLessThan(fnBody.indexOf('INSERT INTO public.epb_comeback_token_spends'));
    expect(refusal).toBeLessThan(fnBody.indexOf('epb_apply_progress'));
  });

  it('the ledger keeps tokens, the tracker gets count / ratio progress', () => {
    expect(fnBody).toMatch(/VALUES \(p_season_id, p_player_id, v_line, v_tracker\.id, v_count, p_client_request_id, p_actor_id\)/);
    expect(fnBody).toMatch(/epb_apply_progress\(v_tracker\.id, 'kill_token', v_count \/ v_ratio,/);
    expect(fnBody).toMatch(/v_ratio := COALESCE\(\(v_alloc->>'ratio'\)::numeric::int, 1\)/);
  });

  it('keeps the window, ownership and replay checks', () => {
    expect(fnBody).toMatch(/RAISE EXCEPTION 'COMEBACK_NOT_YET'/);
    expect(fnBody).toMatch(/RAISE EXCEPTION 'TRACKER_NOT_OWNED'/);
    expect(fnBody).toMatch(/'replay', true/);
    expect(fnBody).toMatch(/pg_advisory_xact_lock\(hashtext\(p_season_id::text\)\)/);
  });
});
