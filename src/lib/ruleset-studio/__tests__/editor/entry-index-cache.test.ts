import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogIndex } from '@/lib/pkmn/catalog-index';
import { clearCatalogCache, fetchEntryIndex, peekEntryIndex } from '../../editor/catalog-client';
import { SPECIES_ROWS } from './picker/fixtures';

// Counts the decodes of the real implementation.
const decodes = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/lib/pkmn/catalog-index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pkmn/catalog-index')>();
  return {
    ...actual,
    decodeIndex: ((index: CatalogIndex) => {
      decodes.count += 1;
      return actual.decodeIndex(index);
    }) as typeof actual.decodeIndex,
  };
});

const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }));
const failed = () => Promise.resolve(new Response(JSON.stringify({ success: false, error: 'x', code: 'unknown_error' }), { status: 500 }));

const QUERY = { kind: 'species', gen: 9, scope: 'national' } as const;
const species: CatalogIndex<'species'> = { v: 1, kind: 'species', gen: 9, scope: 'national', preset: null, rows: SPECIES_ROWS };

describe('the shared entry index accessor', () => {
  beforeEach(() => {
    clearCatalogCache();
    decodes.count = 0;
  });

  it('fetches and decodes once for concurrent callers and hands every one the same index', async () => {
    let calls = 0;
    const f = () => {
      calls += 1;
      return ok(species);
    };
    const [editor, picker] = await Promise.all([fetchEntryIndex(QUERY, { fetch: f }), fetchEntryIndex(QUERY, { fetch: f })]);
    const later = await fetchEntryIndex(QUERY, { fetch: f });

    expect(calls).toBe(1);
    expect(decodes.count).toBe(1);
    expect(editor.ok && picker.ok && later.ok).toBe(true);
    if (!editor.ok || !picker.ok || !later.ok) return;
    expect(picker.data).toBe(editor.data);
    expect(later.data).toBe(editor.data);
    expect(peekEntryIndex(QUERY)).toBe(editor.data);
  });

  it('serves the decoded index: entries, the id lookup and the id set the compile reads', async () => {
    const outcome = await fetchEntryIndex(QUERY, { fetch: () => ok(species) });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.entries).toHaveLength(SPECIES_ROWS.length);
    expect(outcome.data.byId.get('garchomp')?.name).toBe('Garchomp');
    expect(outcome.data.ids.has('koraidon')).toBe(true);
    expect(outcome.data.ids.size).toBe(SPECIES_ROWS.length);
  });

  it('keys by kind, generation, scope and preset', async () => {
    const f = () => ok(species);
    const a = await fetchEntryIndex(QUERY, { fetch: f });
    const b = await fetchEntryIndex({ ...QUERY, preset: 'gen9championsdraft' }, { fetch: f });
    expect(a.ok && b.ok && a.data !== b.data).toBe(true);
    expect(decodes.count).toBe(2);
    expect(peekEntryIndex({ ...QUERY, gen: 8 })).toBeUndefined();
  });

  it('caches neither a failed request nor a body that does not decode, so the next call asks again', async () => {
    let calls = 0;
    const f = () => {
      calls += 1;
      if (calls === 1) return failed();
      if (calls === 2) return ok({ v: 1, kind: 'species', gen: 9, scope: 'national', preset: null, rows: null });
      return ok(species);
    };
    expect((await fetchEntryIndex(QUERY, { fetch: f })).ok).toBe(false);
    expect((await fetchEntryIndex(QUERY, { fetch: f })).ok).toBe(false);
    expect(peekEntryIndex(QUERY)).toBeUndefined();
    expect((await fetchEntryIndex(QUERY, { fetch: f })).ok).toBe(true);
    expect(calls).toBe(3);
  });
});
