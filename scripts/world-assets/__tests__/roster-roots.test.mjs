import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPrivateRoster, rosterRootSpecies } from '../lib.mjs';

// The roster roots of the world-asset pipeline: the private pack's world-roster.json when it
// exists, else the example list. A file that exists but yields nothing must fail loudly.

let dir;
let warn;
const write = (body) => {
  const file = join(dir, 'world-roster.json');
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'roster-roots-'));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

describe('readPrivateRoster', () => {
  it('returns null when the file is absent (a public checkout)', () => {
    expect(readPrivateRoster(join(dir, 'missing.json'))).toBeNull();
  });

  it('reads well-formed roots', () => {
    expect(readPrivateRoster(write({ baseDexIds: [1, 4], baseSpeciesExtra: ['Geodude-Alola'] }))).toEqual({
      baseDexIds: [1, 4],
      baseSpeciesExtra: ['Geodude-Alola'],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty object', {}],
    ['empty lists', { baseDexIds: [], baseSpeciesExtra: [] }],
    ['only malformed entries', { baseDexIds: [0, -3, 1.5, '4'], baseSpeciesExtra: [null, ''] }],
    ['a JSON array', [1, 4]],
    ['JSON null', null],
  ])('throws on %s instead of yielding an empty roster', (_label, body) => {
    expect(() => readPrivateRoster(write(body))).toThrow(/lists no roster roots/);
  });

  it.each([
    ['both fields', { baseDexIds: '1,4', baseSpeciesExtra: 7 }],
    ['one field while the other is valid', { baseDexIds: [1], baseSpeciesExtra: 'Geodude-Alola' }],
    ['a null field', { baseDexIds: null, baseSpeciesExtra: ['Geodude-Alola'] }],
  ])('throws when a present field is not an array (%s), never dropping it silently', (_label, body) => {
    expect(() => readPrivateRoster(write(body))).toThrow(/must be an array/);
  });

  it('throws a clear error on invalid JSON', () => {
    expect(() => readPrivateRoster(write('{ nope'))).toThrow(/is not valid JSON/);
  });

  it('warns about malformed entries it drops', () => {
    expect(readPrivateRoster(write({ baseDexIds: [1, 'x', 0] }))).toEqual({ baseDexIds: [1], baseSpeciesExtra: [] });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/ignored 2 malformed roster entries/));
  });
});

describe('rosterRootSpecies', () => {
  it('resolves dex numbers and extra species', () => {
    expect(rosterRootSpecies(write({ baseDexIds: [1, 4], baseSpeciesExtra: ['Geodude-Alola'] }))).toEqual([
      'Bulbasaur',
      'Charmander',
      'Geodude-Alola',
    ]);
  });

  it('warns about dex numbers and names @pkmn/dex does not know, and keeps the rest', () => {
    expect(rosterRootSpecies(write({ baseDexIds: [1, 99999], baseSpeciesExtra: ['Notamon'] }))).toEqual(['Bulbasaur']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/does not know: 99999, Notamon/));
  });

  it('throws when no root resolves', () => {
    expect(() => rosterRootSpecies(write({ baseDexIds: [99999] }))).toThrow(/none of its roster roots resolve/);
  });

  it('falls back to the example list when the private file is absent', () => {
    const roots = rosterRootSpecies(join(dir, 'missing.json'));
    expect(roots.length).toBeGreaterThan(0);
    expect(new Set(roots).size).toBe(roots.length);
  });
});
