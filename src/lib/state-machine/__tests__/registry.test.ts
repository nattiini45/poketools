import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { specProblems } from '../machine';
import { STATE_MACHINES } from '../registry';

const root = path.resolve(__dirname, '../../../..');

describe('state machine registry', () => {
  it('has unique ids', () => {
    const ids = STATE_MACHINES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(STATE_MACHINES.map((m) => [m.id, m] as const))('%s is structurally sound', (_id, spec) => {
    expect(specProblems(spec)).toEqual([]);
  });

  it.each(STATE_MACHINES.map((m) => [m.id, m] as const))('%s names writers and docs that exist', (_id, spec) => {
    const paths = [...spec.transitions.flatMap((t) => t.writers), ...(spec.doc ? [spec.doc] : [])];
    // A SQL writer is named as `path#function`.
    expect(paths.filter((p) => !existsSync(path.join(root, p.split('#')[0])))).toEqual([]);
  });
});
