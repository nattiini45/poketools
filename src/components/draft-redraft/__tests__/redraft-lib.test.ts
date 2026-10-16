import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RedraftSubmissionDTO } from '@/types/draft-queue';
import { buildFixtureCatalog } from '@/lib/draft-finder/__tests__/fixture-index';
import { entriesById, makePreEvolutionLabel } from '../line-label';
import { refundOf, sameLineSet, toOwnLineVMs } from '../own-lines';
import { createHttpRedraftSource, isRedraftSubmission } from '../redraft-source';

const catalog = buildFixtureCatalog();

const SUB: RedraftSubmissionDTO = {
  line_ids: ['gastly--gengar'],
  updated_at: null,
  locked: false,
  deadline_at: '2026-10-12T21:59:00.000Z',
  max: 3,
  own_lines: [
    { line_id: 'gastly--gengar', real_kills: 2, price: 29, droppable: true },
    { line_id: 'cosmog--solgaleo', real_kills: 1, price: 27, droppable: true },
    { line_id: 'teddiursa--ursaluna', real_kills: -1, price: 28, droppable: false },
    { line_id: 'unknown--line', real_kills: 0, price: 10, droppable: true },
  ],
  leftover_budget: 6,
};

describe('makePreEvolutionLabel', () => {
  const byId = entriesById(catalog);

  it('names the stages before the final one through the pkmn layer', () => {
    expect(makePreEvolutionLabel(byId, 'en')('cosmog--solgaleo')).toBe('Cosmog/Cosmoem');
    expect(makePreEvolutionLabel(byId, 'de')('cosmog--solgaleo')).toBe('Cosmog/Cosmovum');
  });

  it('falls back to the raw id for an unknown line', () => {
    expect(makePreEvolutionLabel(byId, 'en')('unknown--line')).toBe('unknown--line');
  });
});

describe('toOwnLineVMs', () => {
  it('keeps server order, locks Cosmog (catalog flag) and non-droppable lines, clamps KOs', () => {
    expect(toOwnLineVMs(SUB, catalog)).toEqual([
      { lineId: 'gastly--gengar', price: 29, realKills: 2, locked: null },
      { lineId: 'cosmog--solgaleo', price: 27, realKills: 1, locked: 'cosmog' },
      { lineId: 'teddiursa--ursaluna', price: 28, realKills: 0, locked: 'no_redraft' },
      { lineId: 'unknown--line', price: 10, realKills: 0, locked: null },
    ]);
  });

  it('refunds only chosen lines; set comparison ignores order', () => {
    const lines = toOwnLineVMs(SUB, catalog);
    expect(refundOf(lines, new Set(['gastly--gengar', 'unknown--line']))).toBe(39);
    expect(refundOf(lines, new Set(['not-mine']))).toBe(0);
    expect(sameLineSet(['a', 'b'], new Set(['b', 'a']))).toBe(true);
    expect(sameLineSet(['a'], new Set(['a', 'b']))).toBe(false);
  });
});

describe('createHttpRedraftSource', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('GETs the own submission from the owner-guarded route', async () => {
    const fetchMock = stubFetch(200, { success: true, data: SUB });
    const result = await createHttpRedraftSource('pool 1').getSubmission();
    expect(result).toEqual({ ok: true, data: SUB });
    expect(fetchMock).toHaveBeenCalledWith('/api/drafts/pool%201/redraft/submission', expect.objectContaining({ method: 'GET' }));
  });

  it('PUTs the full set as { line_ids } (withdraw = [])', async () => {
    const fetchMock = stubFetch(200, { success: true, data: { ...SUB, line_ids: [] } });
    await createHttpRedraftSource('p').putSubmission([]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ line_ids: [] });
  });

  it('maps API errors and network failures to ApiErrorLike', async () => {
    stubFetch(409, { success: false, error: 'locked', code: 'SUBMISSION_LOCKED' });
    expect(await createHttpRedraftSource('p').putSubmission(['x'])).toEqual({
      ok: false,
      error: { error: 'locked', code: 'SUBMISSION_LOCKED' },
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline');
    }));
    expect(await createHttpRedraftSource('p').getSubmission()).toEqual({ ok: false, error: { code: 'network_error' } });
  });

  it('rejects a malformed success body', async () => {
    stubFetch(200, { success: true, data: { line_ids: 'nope' } });
    expect(await createHttpRedraftSource('p').getSubmission()).toEqual({ ok: false, error: { code: 'unknown_error' } });
    expect(isRedraftSubmission(SUB)).toBe(true);
  });
});
