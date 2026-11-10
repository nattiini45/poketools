import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchEventSources, matchMachine, matchTimestampsFor } from '../match-state';

// The SQL writer of the match machine (format_forfeit_complete, event forfeit, actor system) must write the same
// completion stamps as matchTimestampsFor and guard its UPDATE with the status the caller read. Static: reads the last
// CREATE OR REPLACE of the function from supabase/migrations.
const DIR = path.join(process.cwd(), 'supabase', 'migrations');

function lastDefinition(fn: string): { file: string; body: string } {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  let found: { file: string; body: string } | null = null;
  for (const file of files) {
    const text = readFileSync(path.join(DIR, file), 'utf8')
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    const marker = `CREATE OR REPLACE FUNCTION public.${fn}(`;
    let at = text.indexOf(marker);
    while (at !== -1) {
      const end = text.indexOf('END $$;', at);
      found = { file, body: text.slice(at, end) };
      at = text.indexOf(marker, at + marker.length);
    }
  }
  if (!found) throw new Error(`no definition of ${fn}`);
  return found;
}

describe('format_forfeit_complete (match machine, event forfeit)', () => {
  const { file, body } = lastDefinition('format_forfeit_complete');

  it('is a writer the match machine names', () => {
    const forfeit = matchMachine.spec.transitions.find((t) => t.event === 'forfeit');
    expect(forfeit?.writers).toContain(`supabase/migrations/${file}#format_forfeit_complete`);
    expect(forfeit?.actors).toEqual(['system']);
  });

  it('completes the match with the completion stamps of matchTimestampsFor', () => {
    const update = body.slice(body.indexOf('UPDATE public.matches'), body.indexOf('GET DIAGNOSTICS'));
    expect(update).toMatch(/SET status = 'completed'/);
    const stamps = matchTimestampsFor('scheduled', 'completed', { now: 'now()' });
    for (const [column, value] of Object.entries(stamps)) {
      expect(update).toMatch(new RegExp(`\\b${column} = ${value === null ? 'NULL' : 'now\\(\\)'}`));
    }
  });

  it('guards the write with the status the caller read, one of the forfeit sources', () => {
    expect(body).toMatch(/WHERE m\.id = p_match_id\s+AND m\.status = p_expected_status/);
    expect(matchEventSources('forfeit')).toEqual(['scheduled', 'in_progress']);
  });
});
