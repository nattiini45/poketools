import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { VISUAL_SEED_IDS } from '../ids';

describe('visual seed ids', () => {
  it('scripts/visual/seed-ids.json holds exactly the ids of ids.ts', () => {
    const json: unknown = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'visual', 'seed-ids.json'), 'utf8'));
    expect(json).toEqual(VISUAL_SEED_IDS);
  });

  it('every id is a distinct UUID the API path guards accept', () => {
    const ids = Object.values(VISUAL_SEED_IDS);
    for (const id of ids) expect(z.uuid().safeParse(id).success, id).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
