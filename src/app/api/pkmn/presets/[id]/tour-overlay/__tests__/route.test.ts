import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

const call = (id: string) => GET(new NextRequest(`http://localhost/api/pkmn/presets/${id}/tour-overlay`), { params: Promise.resolve({ id }) });

describe('GET /api/pkmn/presets/[id]/tour-overlay (public)', () => {
  it('resolves the documented tour extras of a draft preset, cacheable for an hour', async () => {
    const res = await call('gen9natdexdraft');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600');
    expect(body.data.preset).toBe('gen9natdexdraft');
    expect(Array.isArray(body.data.clausesAdd)).toBe(true);
    expect(body.data.moves.every((id: string) => /^[a-z0-9]+$/.test(id))).toBe(true);
  });

  it('a preset with no documented extras and an unknown id are 404 with the ruleset code', async () => {
    for (const id of ['gen9ou', 'gen99zz']) {
      const res = await call(id);
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe('ruleset_preset_unknown');
    }
  });
});
