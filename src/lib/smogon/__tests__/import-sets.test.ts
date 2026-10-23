import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/sample-sets', () => ({
  upsertSampleSetBatch: vi.fn(),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// ─── Import after mocks ────────────────────────────────────────────

import { importGenerationSets, importAllSets } from '../import-sets';
import { upsertSampleSetBatch } from '@/lib/supabase/queries/sample-sets';

const mockUpsertBatch = vi.mocked(upsertSampleSetBatch);

// ─── Fixtures ──────────────────────────────────────────────────────

function makeSetsJson() {
  return {
    Pikachu: {
      'gen9ou': {
        'Standard Attacker': {
          moves: ['Thunderbolt', ['Volt Switch', 'Surf']],
          ability: 'Static',
          item: 'Light Ball',
          nature: 'Timid',
          evs: { spa: 252, spe: 252, hp: 4 },
        },
      },
    },
    Charizard: {
      'gen9ou': {
        'Dragon Dance': {
          moves: ['Dragon Dance', 'Flare Blitz'],
          ability: ['Solar Power', 'Blaze'],
          nature: ['Jolly', 'Adamant'],
          evs: [{ atk: 252, spe: 252 }, { hp: 252, atk: 252 }],
          level: [100, 50],
        },
      },
    },
  };
}

function makeAnalysesJson() {
  return {
    Pikachu: {
      'gen9ou': {
        overview: '<p>Electric <strong>mouse</strong></p>',
        sets: {
          'Standard Attacker': {
            description: '<p>Hits hard with <a href="#">Light Ball</a></p>',
          },
        },
      },
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('importGenerationSets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('imports sets and analyses successfully', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(makeSetsJson()) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(makeAnalysesJson()) });

    const result = await importGenerationSets(9);

    expect(result.status).toBe('success');
    expect(result.generation).toBe(9);
    expect(result.setsCount).toBe(2); // Pikachu + Charizard
    expect(result.analysesCount).toBe(1); // Only Pikachu has description
    expect(mockUpsertBatch).toHaveBeenCalled();
  });

  it('returns skipped when 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await importGenerationSets(10);

    expect(result.status).toBe('skipped');
    expect(result.setsCount).toBe(0);
  });

  it('returns error on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await importGenerationSets(9);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Sets fetch failed: 500');
  });

  it('continues when analyses fetch fails', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(makeSetsJson()) })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await importGenerationSets(9);

    expect(result.status).toBe('success');
    expect(result.analysesCount).toBe(0); // No analyses loaded
  });

  it('strips HTML from descriptions', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(makeSetsJson()) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(makeAnalysesJson()) });

    await importGenerationSets(9);

    const batchCall = mockUpsertBatch.mock.calls[0][0];
    const pikachuSet = batchCall.find((r: Record<string, unknown>) => r.pokemon_name === 'Pikachu');
    expect(pikachuSet!.description).toBe('Hits hard with Light Ball');
  });

  it('decodes each HTML entity exactly once and strips nested tags', async () => {
    const analyses = {
      Pikachu: {
        gen9ou: {
          sets: {
            'Standard Attacker': { description: '<p>Use &amp;lt;b&amp;gt; &amp; <scr<b>ipt>alert(1)</scr</b>ipt> &quot;x&quot; &#39;y&#39;</p>' },
          },
        },
      },
    };
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(makeSetsJson()) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(analyses) });

    await importGenerationSets(9);

    const batchCall = mockUpsertBatch.mock.calls[0][0];
    const pikachuSet = batchCall.find((r: Record<string, unknown>) => r.pokemon_name === 'Pikachu');
    // `&amp;lt;` is the literal text `&lt;`, not `<`.
    expect(pikachuSet!.description).toContain('Use &lt;b&gt; & ');
    expect(pikachuSet!.description).toContain(`"x" 'y'`);
    // `<scr<b>` goes as one tag, so no `<` survives to open a tag; the stray `ipt>` text is inert.
    expect(pikachuSet!.description).not.toContain('<');
    expect(pikachuSet!.description).toBe(`Use &lt;b&gt; & ipt>alert(1)ipt> "x" 'y'`);
  });

  it('normalizes array EVs to first spread', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(makeSetsJson()) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    await importGenerationSets(9);

    const batchCall = mockUpsertBatch.mock.calls[0][0];
    const charizard = batchCall.find((r: Record<string, unknown>) => r.pokemon_name === 'Charizard');
    expect(charizard!.moveset.evs).toEqual({ atk: 252, spe: 252 });
  });

  it('normalizes array level to first value', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(makeSetsJson()) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    await importGenerationSets(9);

    const batchCall = mockUpsertBatch.mock.calls[0][0];
    const charizard = batchCall.find((r: Record<string, unknown>) => r.pokemon_name === 'Charizard');
    expect(charizard!.moveset.level).toBe(100);
  });

  it('batches upserts in chunks of 500', async () => {
    // Create sets data with more than 500 entries
    const bigSetsJson: Record<string, Record<string, Record<string, unknown>>> = {};
    for (let i = 0; i < 550; i++) {
      bigSetsJson[`Mon${i}`] = {
        'gen9ou': {
          'Set': { moves: ['Move1'], ability: 'Ability', nature: 'Timid' },
        },
      };
    }

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(bigSetsJson) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    await importGenerationSets(9);

    expect(mockUpsertBatch).toHaveBeenCalledTimes(2); // 500 + 50
  });

  it('handles network error gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await importGenerationSets(9);
    expect(result.status).toBe('error');
    expect(result.error).toBe('Network error');
  });
});

describe('importAllSets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('imports all default generations', async () => {
    // All return 404 for simplicity
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const results = await importAllSets();

    expect(results).toHaveLength(9); // Gen 1-9
    expect(results.every((r) => r.status === 'skipped')).toBe(true);
  });

  it('imports specific generations', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const results = await importAllSets([8, 9]);

    expect(results).toHaveLength(2);
    expect(results[0].generation).toBe(8);
    expect(results[1].generation).toBe(9);
  });

  it('continues after errors', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 }) // Gen 8 errors
      .mockResolvedValueOnce({ ok: false, status: 404 }); // Gen 9 skipped

    const results = await importAllSets([8, 9]);

    expect(results[0].status).toBe('error');
    expect(results[1].status).toBe('skipped');
  });
});
