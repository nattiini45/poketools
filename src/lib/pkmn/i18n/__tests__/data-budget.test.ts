// Client bundle budget for the five German name maps.
// They are imported statically by the per-kind names/* modules, so every byte ships to browsers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const DATA_DIR = join(__dirname, '..', 'data');
const NAME_MAPS = ['species.de.json', 'moves.de.json', 'items.de.json', 'abilities.de.json', 'misc.de.json'];
const PER_FILE_CAP = 15 * 1024;
const TOTAL_CAP = 40 * 1024;

const gzipBytes = (file: string): number => gzipSync(readFileSync(join(DATA_DIR, file)), { level: 9 }).length;

describe('German name map budget (gzip level 9)', () => {
  it.each(NAME_MAPS)('%s is at most 15 KB', (file) => {
    expect(gzipBytes(file)).toBeLessThanOrEqual(PER_FILE_CAP);
  });

  it('the five name maps total at most 40 KB', () => {
    const total = NAME_MAPS.reduce((sum, file) => sum + gzipBytes(file), 0);
    expect(total).toBeLessThanOrEqual(TOTAL_CAP);
  });
});
