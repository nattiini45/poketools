import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

const call = (id: string) => GET(new NextRequest(`http://localhost/api/pkmn/presets/${id}/rules`), { params: Promise.resolve({ id }) });

describe('GET /api/pkmn/presets/[id]/rules (public)', () => {
  it('resolves a catalog preset to its rules, cacheable for an hour', async () => {
    const res = await call('gen9ou');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600');
    expect(body.data).toMatchObject({ id: 'gen9ou', gen: 9, universe: 'standard', doubles: false, mod: 'gen9' });
    expect(body.data.pokemon).toMatchObject({ mode: 'block' });
    expect(body.data.pokemon.ids).toContain('koraidon');
    expect(body.data.clauses).toContain('speciesclause');
  });

  it('a draft preset with a roster comes back in allow mode (Champions)', async () => {
    const body = await (await call('gen9championsdraft')).json();
    expect(body.data.pokemon.mode).toBe('allow');
    expect(body.data.pokemon.ids.length).toBeGreaterThan(50);
  });

  it('an id the catalog does not know is a 404 with the ruleset code', async () => {
    const res = await call('gen99zz');
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('ruleset_preset_unknown');
  });
});
