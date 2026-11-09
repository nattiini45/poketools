import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { comparePixels, expandMatrix, expandTargets, fillTemplate, requestPolicy, verdictOf } from '../visual/lib.mjs';

const frozen = JSON.parse(readFileSync(new URL('../visual/frozen.json', import.meta.url), 'utf8'));
const routes = JSON.parse(readFileSync(new URL('../visual/routes.json', import.meta.url), 'utf8'));
const ids = JSON.parse(readFileSync(new URL('../visual/seed-ids.json', import.meta.url), 'utf8'));

function image(width, height, fill) {
  const data = new Uint8Array(width * height * 4).fill(fill);
  return { data, width, height, channels: 4 };
}

describe('visual harness request policy', () => {
  it('lets loopback and inline URLs through', () => {
    expect(requestPolicy('http://localhost:3123/draft-preview', 'document')).toBe('allow');
    expect(requestPolicy('http://127.0.0.1:54321/rest/v1/seasons', 'fetch')).toBe('allow');
    expect(requestPolicy('data:image/png;base64,AAAA', 'image')).toBe('allow');
  });

  it('serves allow-listed sprite images from the cache', () => {
    expect(requestPolicy('https://play.pokemonshowdown.com/sprites/itemicons/poke-ball.png', 'image')).toBe('cache');
    expect(requestPolicy('https://img.pokemondb.net/sprites/home/normal/garchomp.png', 'image')).toBe('cache');
  });

  it('blocks the hosted Supabase project, its Storage buckets and every other host', () => {
    expect(requestPolicy('https://abc.supabase.co/storage/v1/object/public/world-assets/x.glb', 'fetch')).toBe('block');
    expect(requestPolicy('https://abc.supabase.co/storage/v1/object/public/sprites/x.png', 'image')).toBe('block');
    expect(requestPolicy('https://play.pokemonshowdown.com/data/pokedex.json', 'fetch')).toBe('block');
    expect(requestPolicy('https://example.com/a.png', 'image')).toBe('block');
    expect(requestPolicy('not a url', 'image')).toBe('block');
  });
});

describe('visual harness target expansion', () => {
  it('fills templates and refuses unknown names', () => {
    expect(fillTemplate('/x?a={a}&b={b}', { a: 'one two', b: 2 })).toBe('/x?a=one%20two&b=2');
    expect(() => fillTemplate('/x/{missing}', {})).toThrow(/missing/);
  });

  it('expands a matrix in a stable order', () => {
    expect(expandMatrix({ b: [1, 2], a: ['x'] })).toEqual([{ a: 'x', b: 1 }, { a: 'x', b: 2 }]);
    expect(expandMatrix()).toEqual([{}]);
    expect(() => expandMatrix({ a: [] })).toThrow();
  });

  it('gives every frozen job a unique key and a root or a full-page capture', () => {
    const jobs = expandTargets(frozen, { now: frozen.now, ids });
    expect(new Set(jobs.map((j) => j.target))).toEqual(new Set(frozen.targets.map((t) => t.id)));
    expect(jobs.length).toBeGreaterThan(300);
    expect(new Set(jobs.map((j) => j.key)).size).toBe(jobs.length);
    for (const job of jobs) expect(job.fullPage || job.roots.length > 0).toBe(true);
  });

  it('covers both themes and the desktop and phone widths for the draft room and the worlds', () => {
    const jobs = expandTargets(frozen, { now: frozen.now, only: ['draft-room', 'route-world'] });
    for (const target of ['draft-room', 'route-world']) {
      const mine = jobs.filter((j) => j.target === target);
      expect(new Set(mine.map((j) => j.theme))).toEqual(new Set(['light', 'dark']));
      expect(new Set(mine.map((j) => j.viewportName))).toEqual(new Set(['desktop', 'mobile']));
    }
  });

  it('keeps the admin control-page scenarios out of the frozen draft room (they are redesigned)', () => {
    const scenarios = frozen.targets.find((t) => t.id === 'draft-room').matrix.scenario;
    for (const admin of ['admin-panel', 'admin-publish-refused', 'admin-tokens', 'admin-audit']) expect(scenarios).not.toContain(admin);
  });

  it('expands the surface manifest', () => {
    const jobs = expandTargets(routes, { ids });
    expect(new Set(jobs.map((j) => j.target))).toEqual(new Set(routes.targets.map((t) => t.id)));
    expect(new Set(jobs.map((j) => j.key)).size).toBe(jobs.length);
  });

  it('skips a seeded target when its ids are missing', () => {
    const jobs = expandTargets(frozen, { now: frozen.now, ids: {} });
    expect(jobs.some((j) => j.target === 'match-highlight-card-bo3')).toBe(false);
    expect(jobs.some((j) => j.target === 'draft-room')).toBe(true);
  });
});

describe('visual harness comparison', () => {
  it('counts changed pixels and their box', () => {
    const a = image(4, 3, 10);
    const b = image(4, 3, 10);
    b.data[(1 * 4 + 2) * 4] = 11;
    expect(comparePixels(a, a)).toMatchObject({ sameSize: true, changed: 0, box: null });
    expect(comparePixels(a, b)).toMatchObject({ changed: 1, box: { x: 2, y: 1, w: 1, h: 1 } });
    expect(comparePixels(a, b, { threshold: 1 }).changed).toBe(0);
    expect(comparePixels(a, image(4, 4, 10))).toMatchObject({ sameSize: false });
  });

  it('fails anything but an identical frozen capture unless a tolerance allows it', () => {
    const same = { sameSize: true, changed: 0, changedPct: 0 };
    const one = { sameSize: true, changed: 1, changedPct: 0.01 };
    expect(verdictOf({ base: {}, head: {}, comparison: same }).pass).toBe(true);
    expect(verdictOf({ base: {}, head: {}, comparison: one }).pass).toBe(false);
    expect(verdictOf({ base: {}, head: {}, comparison: one, tolerance: { maxChangedPct: 0.5, threshold: 8 } }).pass).toBe(true);
    expect(verdictOf({ base: null, head: {}, comparison: same })).toMatchObject({ status: 'added', pass: false });
    expect(verdictOf({ base: {}, head: null, comparison: same })).toMatchObject({ status: 'removed', pass: false });
    expect(verdictOf({ base: {}, head: {}, comparison: { sameSize: false } })).toMatchObject({ status: 'resized', pass: false });
  });
});
