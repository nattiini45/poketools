import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_OUTCOME_KINDS, MATCH_OUTCOME_KINDS } from '@/types/match-outcome';
import { matchOutcomeMachine, matchOutcomeState } from '../outcome-state';

// match_outcomes is written only by match_outcome_record() (SQL-owned machine). This pins the definition to the last
// CREATE OR REPLACE of the function and to the table's CHECK constraints, statically (no database).
const DIR = path.join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const strip = (text: string) =>
  text
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

function lastDefinition(fn: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const file of files) {
    const text = strip(readFileSync(path.join(DIR, file), 'utf8'));
    const marker = `CREATE OR REPLACE FUNCTION public.${fn}(`;
    let at = text.indexOf(marker);
    while (at !== -1) {
      found = { file, body: text.slice(at, text.indexOf('END $$;', at)) };
      at = text.indexOf(marker, at + marker.length);
    }
  }
  if (!found) throw new Error(`no definition of ${fn}`);
  return found;
}

const ADMIN_STATES = ['admin_played', 'forfeit', 'no_show'];
const { file, body } = lastDefinition('match_outcome_record');
const forceBranch = body.slice(body.indexOf('IF p_force THEN'), body.indexOf('END IF;', body.indexOf('IF p_force THEN')));
const systemBranch = body.slice(body.indexOf('END IF;', body.indexOf('IF p_force THEN')));

describe('match_outcome_record and the match outcome machine', () => {
  it('names the function as a writer of every transition that writes a row', () => {
    for (const t of matchOutcomeMachine.spec.transitions) {
      if (t.to === 'none') continue;
      expect(t.writers).toContain(`supabase/migrations/${file}#match_outcome_record`);
    }
  });

  it('declares the kinds the table allows', () => {
    const table = strip(readFileSync(path.join(DIR, '20261104090000_match_outcomes.sql'), 'utf8'));
    const check = /CONSTRAINT match_outcomes_kind_check CHECK \(kind IN \(([^)]*)\)\)/.exec(table);
    expect(check?.[1].split(',').map((k) => k.trim().replace(/'/g, '')).sort()).toEqual([...MATCH_OUTCOME_KINDS].sort());
    const kinds = new Set(matchOutcomeMachine.spec.states.filter((s) => s !== 'none').map((s) => (s === 'admin_played' ? 'played' : s)));
    expect([...kinds].sort()).toEqual([...MATCH_OUTCOME_KINDS].sort());
  });

  it('a system write (p_force false) replaces only a row whose source is not admin', () => {
    expect(systemBranch).toMatch(/ON CONFLICT \(match_id\) DO UPDATE[\s\S]*WHERE o\.source <> 'admin';/);
    for (const t of matchOutcomeMachine.transitionsFrom('none', 'system')) {
      expect(t.from.filter((s) => ADMIN_STATES.includes(s))).toEqual([]);
    }
    for (const s of ADMIN_STATES) {
      expect(matchOutcomeMachine.transitionsFrom(s as never, 'system').filter((t) => t.to !== 'none')).toEqual([]);
    }
  });

  it('an admin write (p_force true) replaces any row', () => {
    expect(forceBranch).toMatch(/ON CONFLICT \(match_id\) DO UPDATE/);
    expect(forceBranch).not.toMatch(/WHERE o\./);
    for (const t of matchOutcomeMachine.spec.transitions) {
      if (t.to === 'none' || !t.actors.includes('admin')) continue;
      expect([...t.from].sort()).toEqual([...matchOutcomeMachine.spec.states].sort());
    }
  });

  it('stages an admin row only while the match is not completed (p_open_only)', () => {
    expect(body).toMatch(/IF p_open_only THEN\s+PERFORM 1 FROM public\.matches m WHERE m\.id = p_match_id AND m\.status <> 'completed' FOR SHARE;/);
  });

  it('lets an admin set exactly the admin result kinds', () => {
    const adminTargets = matchOutcomeMachine.spec.transitions
      .filter((t) => t.event.startsWith('set_'))
      .map((t) => (t.to === 'admin_played' ? 'played' : t.to));
    expect(adminTargets.sort()).toEqual([...ADMIN_OUTCOME_KINDS].sort());
  });

  it('reads a stored row as its state', () => {
    expect(matchOutcomeState(null)).toBe('none');
    expect(matchOutcomeState({ kind: 'played', source: 'replay' })).toBe('played');
    expect(matchOutcomeState({ kind: 'played', source: 'manual' })).toBe('played');
    expect(matchOutcomeState({ kind: 'played', source: 'admin' })).toBe('admin_played');
    expect(matchOutcomeState({ kind: 'forfeit', source: 'admin' })).toBe('forfeit');
    expect(matchOutcomeState({ kind: 'unresolved', source: 'replay' })).toBe('unresolved');
  });
});
