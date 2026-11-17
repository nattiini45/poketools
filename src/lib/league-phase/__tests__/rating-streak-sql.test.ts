import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261117123000_phase_rating_streak_streams.sql'), 'utf8');

describe('native projection writer contract', () => {
  it('removes unfenced overloads before defining their required completion and stream fences', () => {
    for (const signature of [
      'phase_rating_apply_match_result(uuid, jsonb)',
      'rating_replace_player_streams(uuid, jsonb, jsonb, uuid[])',
    ]) {
      expect(sql).toContain(`DROP FUNCTION IF EXISTS public.${signature};`);
      expect(sql.indexOf(`DROP FUNCTION IF EXISTS public.${signature};`)).toBeLessThan(sql.indexOf('CREATE FUNCTION public.rating_replace_player_streams'));
    }
  });

  it('keeps native live history separate and serializes on the shared rating namespace', () => {
    const live = sql.split('CREATE OR REPLACE FUNCTION public.phase_rating_apply_match_result')[1].split('CREATE FUNCTION public.rating_replace_player_streams')[0];
    expect(live).toContain("hashtext('rating_replace_player_history')");
    expect(live).toContain('FROM public.phase_matches');
    expect(live).toContain('INSERT INTO public.phase_rating_history');
    expect(live).not.toMatch(/INSERT INTO (?:public\.)?rating_history/);
    expect(live).toContain("RETURN 'already_applied'");
    expect(live).toContain("RETURN 'stale'");
    expect(live.indexOf('v_match.winner_id IS DISTINCT FROM v_expected_winner_id')).toBeLessThan(live.indexOf('SELECT count(*) INTO v_history_count'));
    expect(live).toContain('v_match.confirmed_at IS DISTINCT FROM v_expected_confirmed_at');
    expect(live).toContain("p_expected_completion ? 'winner_id' AND p_expected_completion ? 'confirmed_at'");
  });

  it('atomically replaces both histories and both mutually exclusive streak pointers', () => {
    expect(sql).toContain('PERFORM public.rating_replace_player_history(p_player_id, p_state, v_legacy, p_expected_history_match_ids)');
    expect(sql).toContain('DELETE FROM public.phase_rating_history WHERE player_id = p_player_id');
    expect(sql).toContain('last_phase_match_id = EXCLUDED.last_phase_match_id');
    expect(sql).toContain('last_match_id = EXCLUDED.last_match_id');
    expect(sql).toContain('v_last_match_id IS NOT NULL AND v_last_phase_match_id IS NOT NULL');
    expect(sql).toContain("p_state -> 'counted_match_ids'");
    const ownerLock = sql.indexOf('LOCK TABLE public.seasons, public.tournaments, public.league_phases IN EXCLUSIVE MODE NOWAIT');
    const matchLock = sql.indexOf('LOCK TABLE public.matches, public.phase_matches IN SHARE MODE NOWAIT');
    expect(ownerLock).toBeGreaterThan(-1);
    expect(matchLock).toBeGreaterThan(ownerLock);
    expect(sql).toContain('v_current IS DISTINCT FROM v_expected');
    expect(sql).toContain('EXCEPTION WHEN lock_not_available');
    expect(sql).toContain('winner_id uuid, confirmed_at timestamptz, date_played timestamptz, created_at timestamptz');
  });

  it('grants only service-role execution and changes no ownership graph', () => {
    for (const name of ['phase_match_in_test_season', 'phase_rating_apply_match_result', 'rating_replace_player_streams', 'streaks_replace_player_streams']) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]+FROM PUBLIC, anon, authenticated;`));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]+TO service_role;`));
    }
    expect(sql).not.toMatch(/CREATE\s+(?:TABLE|TRIGGER)|ADD\s+CONSTRAINT/i);
  });

  it('cleans excluded legacy league history inside the fenced replacement transaction', () => {
    const cleanup = sql.indexOf('DELETE FROM public.rating_history h');
    expect(cleanup).toBeGreaterThan(sql.indexOf('v_current IS DISTINCT FROM v_expected'));
    expect(sql.slice(cleanup)).toContain('h.player_id = p_player_id AND h.match_id = m.id');
    expect(sql.slice(cleanup)).toContain('m.tournament_id = t.id AND t.season_id IS NOT NULL');
    expect(cleanup).toBeLessThan(sql.indexOf('PERFORM public.rating_replace_player_history'));
  });
});
