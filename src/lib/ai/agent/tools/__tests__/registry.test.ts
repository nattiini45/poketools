import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AGENT_TOOLS, LLM_TOOL_NAMES } from '../registry';
import { executeTool, __clearToolResultCache } from '../execute';

beforeEach(() => __clearToolResultCache());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('registry', () => {
  it('registers all 10 LLM tools with descriptions and Zod schemas', () => {
    expect(LLM_TOOL_NAMES).toHaveLength(10);
    for (const name of LLM_TOOL_NAMES) {
      const tool = AGENT_TOOLS[name];
      expect(tool, `tool ${name} should be registered`).toBeDefined();
      expect(tool.name).toBe(name);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(10);
      // Zod schema with a parse method.
      expect(typeof tool.inputSchema.safeParse).toBe('function');
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('also registers the meta-tool and pokepaste publisher for dispatch', () => {
    expect(AGENT_TOOLS.buildTeam).toBeDefined();
    expect(AGENT_TOOLS.createPokepaste).toBeDefined();
  });
});

describe('executeTool', () => {
  it('rejects an unknown tool with ok:false', async () => {
    const res = await executeTool('notARealTool', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/unknown tool/i);
  });

  it('rejects invalid input with ok:false (never throws)', async () => {
    const res = await executeTool('lookupPokemon', { species: '' }); // min(1) fails
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/invalid input/i);
  });

  it('returns ok:true with data for a valid lookupPokemon call', async () => {
    const res = await executeTool('lookupPokemon', { species: 'Garchomp' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { species: string; types: string[] };
      expect(data.species).toBe('Garchomp');
      expect(data.types).toContain('Ground');
      expect(res.cached).toBeFalsy();
    }
  });

  it('serves a cached result (same reference, marked cached) on the second call', async () => {
    const first = await executeTool('lookupPokemon', { species: 'Garchomp' });
    const second = await executeTool('lookupPokemon', { species: 'Garchomp' });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.cached).toBe(true);
      expect(second.data).toBe(first.data); // same object reference from cache
    }
  });

  it('does not cache createPokepaste — both calls reach the executor', async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 303, headers: { location: '/p123' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const a = await executeTool('createPokepaste', { paste: 'x' });
    const b = await executeTool('createPokepaste', { paste: 'x' });

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // Cache would skip the second executor call; no-cache means fetch ran twice.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    if (b.ok) expect(b.cached).toBeFalsy();
  });
});
