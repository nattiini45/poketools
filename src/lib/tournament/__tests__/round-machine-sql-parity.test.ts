import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { roundMachine } from '../round-state';

// A round completes only inside round_complete (the unfinished-match check under the round lock). This reads its last
// definition in supabase/migrations and holds its guard equal to the from-set of the completion in roundMachine.
const DIR = path.join(process.cwd(), 'supabase', 'migrations');

function lastDefinition(fn: string): string {
  let body: string | null = null;
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const text = readFileSync(path.join(DIR, file), 'utf8')
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    const marker = `CREATE OR REPLACE FUNCTION public.${fn}(`;
    for (let at = text.indexOf(marker); at >= 0; at = text.indexOf(marker, at + marker.length)) {
      body = text.slice(at, text.indexOf('END $$;', at));
    }
  }
  if (body === null) throw new Error(`no definition of ${fn}`);
  return body;
}

describe('roundMachine and round_complete', () => {
  it('completes a round from every status but completed, which it answers as already_completed', () => {
    const body = lastDefinition('round_complete');
    expect(body).toMatch(/FROM public\.rounds WHERE id = p_round_id FOR UPDATE;/);
    expect(body).toMatch(/IF v_row\.status = 'completed' THEN\s+RETURN jsonb_build_object\('outcome', 'already_completed'\)/);
    expect(body).toMatch(/UPDATE public\.rounds SET status = 'completed' WHERE id = p_round_id/);
    const sqlSources = roundMachine.spec.states.filter((s) => s !== 'completed').sort();
    expect(roundMachine.sourcesOf('completed', 'admin').sort()).toEqual(sqlSources);
    expect(roundMachine.sourcesOf('completed', 'system')).toEqual([]);
  });

  it('no other function writes rounds.status', () => {
    const writers = new Set<string>();
    for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql'))) {
      const text = readFileSync(path.join(DIR, file), 'utf8');
      for (const m of text.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([\s\S]*?)END \$\$;/g)) {
        if (/UPDATE public\.rounds\s+SET[^;]*\bstatus\s*=/.test(m[2])) writers.add(m[1]);
      }
    }
    expect([...writers]).toEqual(['round_complete']);
  });
});
