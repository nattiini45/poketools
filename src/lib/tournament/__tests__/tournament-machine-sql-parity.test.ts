import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tournamentMachine } from '../tournament-state';

// The system moves of tournaments.status happen inside SQL functions that keep their own guards under the phase row lock
// (ADR 0004). This reads the last definition of each function in supabase/migrations and holds its guards equal to the
// from-sets of tournamentMachine.
const DIR = path.join(process.cwd(), 'supabase', 'migrations');

function lastDefinition(fn: string): string {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  let body: string | null = null;
  for (const file of files) {
    const text = readFileSync(path.join(DIR, file), 'utf8')
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    const marker = `CREATE OR REPLACE FUNCTION public.${fn}(`;
    let at = text.indexOf(marker);
    while (at >= 0) {
      body = text.slice(at, text.indexOf('END $$;', at));
      at = text.indexOf(marker, at + marker.length);
    }
  }
  if (body === null) throw new Error(`no definition of ${fn}`);
  return body;
}

const fromOf = (event: string, to: string, actor: 'admin' | 'system') =>
  tournamentMachine.spec.transitions
    .filter((t) => t.event === event && t.to === to && (t.actors as readonly string[]).includes(actor))
    .flatMap((t) => t.from)
    .sort();

describe('tournamentMachine and the SQL writers of tournaments.status', () => {
  it('round_write starts an upcoming phase only, keeps any other status and refuses a completed one', () => {
    const body = lastDefinition('round_write');
    expect(fromOf('start', 'active', 'system')).toEqual(['upcoming']);
    expect(body).toMatch(/IF v_status = 'completed' THEN\s+RAISE EXCEPTION 'rounds_phase_completed'/);
    const update = body.slice(body.indexOf('UPDATE public.tournaments t'));
    expect(update).toMatch(/SET status = CASE WHEN t\.status = 'upcoming' THEN 'active'::public\.tournament_status ELSE t\.status END/);
    expect(update).toMatch(/WHERE t\.id = p_tournament_id AND \(t\.status = 'upcoming' OR t\.current_round < v_round\.round_number\)/);
    // The only status values the function names are the start move's source, its target and the refused completed.
    const named = new Set([...body.matchAll(/status\s*(?:=|<>)\s*'(\w+)'/g)].map((m) => m[1]));
    expect([...named].sort()).toEqual(['completed', 'upcoming']);
  });

  it('phase_complete_at_stage_end completes an active phase only', () => {
    const body = lastDefinition('phase_complete_at_stage_end');
    expect(fromOf('complete', 'completed', 'system')).toEqual(['active']);
    expect(tournamentMachine.sourcesOf('completed', 'system')).toEqual(['active']);
    expect(body).toMatch(/FROM public\.tournaments WHERE id = p_phase_id FOR UPDATE;\s+IF NOT FOUND OR v_row\.status <> 'active' THEN\s+RETURN jsonb_build_object\('outcome', 'not_active'\)/);
    expect(body).toMatch(/UPDATE public\.tournaments SET status = 'completed' WHERE id = p_phase_id/);
  });
});
