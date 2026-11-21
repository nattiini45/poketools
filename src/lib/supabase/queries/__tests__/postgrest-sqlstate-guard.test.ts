/**
 * Guard for the PostgREST custom-error rule (issue #130): a `40001` raised
 * inside a function never reaches the client — the request hangs until the
 * gateway times out. Refusals a PostgREST caller must see use `PT409` (or
 * another PT4xx custom code). This test replays `supabase/migrations/` in
 * order, keeps the effective body of every `CREATE OR REPLACE FUNCTION`,
 * and fails on any that still raises 40001.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = 'supabase/migrations';
const FUNCTION_START = /CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\s*\(/g;

function effectiveFunctionBodies(): Map<string, { file: string; body: string }> {
  const effective = new Map<string, { file: string; body: string }>();
  const dir = join(process.cwd(), MIGRATIONS_DIR);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const starts = [...sql.matchAll(FUNCTION_START)];
    for (const [i, start] of starts.entries()) {
      const end = i + 1 < starts.length ? starts[i + 1]!.index! : sql.length;
      effective.set(start[1]!, { file, body: sql.slice(start.index, end) });
    }
  }
  return effective;
}

describe('PostgREST-reachable functions never raise SQLSTATE 40001', () => {
  it('no effective function body raises 40001 — use PT409', () => {
    const offenders: string[] = [];
    for (const [name, { file, body }] of effectiveFunctionBodies()) {
      if (body.includes("USING ERRCODE = '40001'")) offenders.push(`${name} (${file})`);
    }
    expect(offenders).toEqual([]);
  });
});
