import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Static guards (no database) for format_substitute_seat in 20261106090000_format_challenges.sql, a migration that is edited in
// place before it is applied live. The behaviour is proved by format-substitute.local.test.ts; these keep the pieces that suite
// cannot see from drifting: the grants, the lock order, the refusals before the first write, and that every player column of
// every format_* table is either moved by the function or deliberately history.
const DIR = path.join(process.cwd(), 'supabase', 'migrations');
const strip = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
const read = (name: string): string => readFileSync(path.join(DIR, name), 'utf8');

const CHALLENGES = '20261106090000_format_challenges.sql';
const RUNTIME = '20261105090000_format_runtime.sql';
const SIGNATURE = 'public.format_substitute_seat(uuid, uuid, uuid, boolean, uuid[], boolean)';

const challenges = strip(read(CHALLENGES));
const start = challenges.indexOf('CREATE OR REPLACE FUNCTION public.format_substitute_seat(');
const end = challenges.indexOf('END $$;', start);
const body = challenges.slice(start, end);

describe('format_substitute_seat', () => {
  it('sits before the recycle-bin section of its migration, inside the transaction', () => {
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(challenges.indexOf('CREATE OR REPLACE FUNCTION public.round_delete('));
    expect(start).toBeLessThan(challenges.indexOf('CREATE OR REPLACE FUNCTION public.league_trash__inventory()'));
    expect(start).toBeLessThan(challenges.lastIndexOf('COMMIT;'));
  });

  it('is service-role only, never SECURITY DEFINER, and pins its search_path', () => {
    expect(body).not.toMatch(/SECURITY DEFINER/i);
    expect(body).toMatch(/LANGUAGE plpgsql SET search_path = public, pg_temp AS \$\$/);
    expect(challenges).toContain(`REVOKE ALL ON FUNCTION ${SIGNATURE} FROM PUBLIC, anon, authenticated;`);
    expect(challenges).toContain(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO service_role;`);
    expect(challenges).toContain(`COMMENT ON FUNCTION ${SIGNATURE} IS`);
    // No other grant of it, to anyone.
    expect(challenges.match(/GRANT[^;]*format_substitute_seat/g)).toHaveLength(1);
  });

  it('takes the locks in the order of the runtime writers, before it reads a row to decide or writes', () => {
    const order = [
      "hashtextextended('format_relation:'",
      'public.format__lock_action(p_season_id, v_key)',
      'FROM public.seasons s WHERE s.id = p_season_id FOR KEY SHARE',
      'FROM public.season_formats f WHERE f.season_id = p_season_id FOR NO KEY UPDATE',
      'FROM public.tournaments t',
      'ORDER BY c.id FOR UPDATE',
      'public.format__lock_grants(p_season_id',
      "RAISE EXCEPTION 'format_substitute_links_collide'",
      'UPDATE public.format_relation_links SET from_player_id',
    ].map((needle) => body.indexOf(needle));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('refuses every kind of collision before its first write', () => {
    const firstWrite = body.indexOf('UPDATE public.format_relation_links SET from_player_id');
    for (const code of ['links', 'items', 'submissions', 'attrs', 'tracks', 'challenges']) {
      const refusal = body.indexOf(`'format_substitute_${code}_collide'`);
      expect(refusal).toBeGreaterThan(-1);
      expect(refusal).toBeLessThan(firstWrite);
    }
  });

  it('moves the seat, bumps the revision and logs the move only when something moved, and rolls a preview back', () => {
    expect(body).toMatch(/IF v_total > 0 AND NOT p_dry_run THEN\s+[^;]*\n?\s*UPDATE public\.season_formats SET engine = engine WHERE season_id = p_season_id;/);
    expect(body).toMatch(/INSERT INTO public\.format_event_log[^;]*'seat_moved'[^;]*clock_timestamp\(\)\)/);
    expect(body).toMatch(/IF p_dry_run THEN\s+RAISE EXCEPTION 'format_substitute_dry_run'/);
    expect(body).toMatch(/IF v_msg IS DISTINCT FROM 'format_substitute_dry_run' THEN\s+RAISE;/);
  });

  it('moves only the OPEN challenges of the phases it is handed', () => {
    const update = body.slice(body.indexOf('UPDATE public.format_challenges'), body.indexOf('GET DIAGNOSTICS v_chal'));
    expect(update).toContain("status = 'open'");
    expect(update).toContain('phase_id = ANY (v_phases)');
  });

  it('keeps the event log, adjustments and checks out of its writes', () => {
    for (const table of ['format_event_log', 'format_adjustments', 'format_checks', 'format_flags']) {
      expect(body).not.toMatch(new RegExp(`UPDATE public\\.${table}\\b`));
      expect(body).not.toMatch(new RegExp(`DELETE FROM public\\.${table}\\b`));
    }
    // The one write to the log is the INSERT of the seat_moved event.
    expect(body.match(/INSERT INTO public\.format_event_log/g)).toHaveLength(1);
  });
});

describe('every player column of the format_* tables', () => {
  /** `table.column` of every column that references players(id) in a CREATE TABLE public.format_* of the two migrations. */
  function playerColumns(): string[] {
    const found: string[] = [];
    for (const file of [RUNTIME, CHALLENGES]) {
      const text = strip(read(file));
      const tables = text.matchAll(/CREATE TABLE public\.(format_\w+) \(([\s\S]*?)\n\);/g);
      for (const [, table, columns] of tables) {
        for (const line of columns.split('\n')) {
          const column = /^\s*(\w+)\s+uuid\b.*REFERENCES public\.players\(id\)/.exec(line);
          if (column) found.push(`${table}.${column[1]}`);
        }
      }
    }
    return found.sort();
  }

  /** Moved by the function. */
  const MOVED = [
    'format_relation_links.from_player_id',
    'format_relation_links.to_player_id',
    'format_resource_items.player_id',
    'format_action_submissions.actor_player_id',
    'format_action_submissions.target_player_id',
    'format_player_attrs.player_id',
    'format_track_progress.player_id',
    'format_challenges.challenger_id',
    'format_challenges.defender_id',
  ];
  /** Who did it, not whose seat it is: history. */
  const HISTORY = ['format_event_log.fired_by', 'format_checks.resolved_by', 'format_adjustments.admin_id'];

  it('is moved by format_substitute_seat or listed as history here, so a new table cannot be forgotten', () => {
    expect(playerColumns()).toEqual([...MOVED, ...HISTORY].sort());
  });

  it('is written by the function for every moved column', () => {
    for (const entry of MOVED) {
      const [table, column] = entry.split('.');
      expect(body).toMatch(new RegExp(`UPDATE public\\.${table}\\b[\\s\\S]*?\\b${column}\\b`));
    }
  });
});
