/**
 * The one TypeScript predicate of "which completed matches count toward
 * ratings" (test leagues do not). The SQL mirror,
 * `public.match_in_test_season`, is checked against its migration text here
 * and proven on the local stack (docs/rating.md, "Test leagues").
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRatingScope, matchCountsForRatings } from '../rating-scope';

const MIGRATION = 'supabase/migrations/20261019130000_ratings_skip_test_seasons.sql';

describe('matchCountsForRatings', () => {
  const scope = createRatingScope(['t-test-1', 't-test-2']);

  it('keeps a test-league match out of ratings', () => {
    expect(matchCountsForRatings({ tournament_id: 't-test-1' }, scope)).toBe(false);
    expect(matchCountsForRatings({ tournament_id: 't-test-2' }, scope)).toBe(false);
  });

  it('counts a normal-league or standalone-tournament match', () => {
    expect(matchCountsForRatings({ tournament_id: 't-normal' }, scope)).toBe(true);
    expect(matchCountsForRatings({ tournament_id: 't-standalone' }, scope)).toBe(true);
  });

  it('counts every match when no league is a test league', () => {
    expect(matchCountsForRatings({ tournament_id: 't-test-1' }, createRatingScope([]))).toBe(true);
  });

  it('does not share the caller-owned id list', () => {
    const ids = ['t-a'];
    const own = createRatingScope(ids);
    ids.push('t-b');
    expect(matchCountsForRatings({ tournament_id: 't-b' }, own)).toBe(true);
  });
});

describe('the SQL mirror (migration 20261019130000)', () => {
  const sql = readFileSync(join(process.cwd(), MIGRATION), 'utf8');

  it('defines match_in_test_season from the match -> tournament -> season flag, false when there is none', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.match_in_test_season\(p_match_id uuid\)\s+RETURNS boolean/);
    expect(sql).toMatch(/JOIN public\.tournaments t ON t\.id = m\.tournament_id\s+JOIN public\.seasons s ON s\.id = t\.season_id/);
    expect(sql).toMatch(/SELECT COALESCE\(\(\s+SELECT s\.is_test_season/);
  });

  it('makes the live writer skip a test-league match after the match read and before the idempotency check', () => {
    const apply = sql.slice(sql.indexOf('FUNCTION public.rating_apply_match_result'));
    const skip = apply.indexOf("IF public.match_in_test_season(p_match_id) THEN\n    RETURN 'skipped_test_season';");
    expect(skip).toBeGreaterThan(apply.indexOf("RETURN 'match_not_completed';"));
    expect(skip).toBeLessThan(apply.indexOf('-- 4. Idempotency'));
  });

  it('makes the rebuild writer refuse a test-league history row and ignore such rows in its fence', () => {
    const replace = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.rating_replace_player_history'));
    expect(replace).toMatch(/WHERE public\.match_in_test_season\(r\.match_id\)[\s\S]*?USING ERRCODE = '40001'/);
    expect(replace).toMatch(/AND NOT public\.match_in_test_season\(h\.match_id\)/);
  });

  it('grants EXECUTE on every function to service_role only', () => {
    for (const signature of [
      'public.match_in_test_season(uuid)',
      'public.rating_apply_match_result(uuid, jsonb)',
      'public.rating_replace_player_history(uuid, jsonb, jsonb, uuid[])',
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`);
    }
  });
});
