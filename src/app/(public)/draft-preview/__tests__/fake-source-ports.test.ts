/**
 * The /draft-preview fake implements the same ports as the HTTP sources:
 * `fetchMyTurn` answers a `MyTurnResult` (stop / ok) and `overviewAll`
 * serves the batched token read in one call.
 */
import { describe, expect, it, vi } from 'vitest';
import { loadTokenRows } from '@/components/draft-admin/TokenAdminSummary';
import { createFakeDataSource } from '../fake-source';
import { buildPreviewScenario, previewNow } from '../fixtures';

const signal = new AbortController().signal;

describe('createFakeDataSource ports', () => {
  it('fetchMyTurn answers ok with the viewer turn, and stop without a pool or with auth failing', async () => {
    const s = buildPreviewScenario('live-my-turn', previewNow());
    const ok = await createFakeDataSource({ ...s.init, latencyMs: 0 }).fetchMyTurn(signal);
    expect(ok.kind).toBe('ok');
    if (ok.kind === 'ok') expect(ok.dto.on_clock).toBe(true);
    expect(await createFakeDataSource({ ...s.init, authFails: true, latencyMs: 0 }).fetchMyTurn(signal)).toEqual({ kind: 'stop' });
    expect(await createFakeDataSource({ ...s.init, snapshot: null, latencyMs: 0 }).fetchMyTurn(signal)).toEqual({ kind: 'stop' });
  });

  it('overviewAll serves every participant in one call; loadTokenRows takes the batched path', async () => {
    const s = buildPreviewScenario('tokens-open', previewNow());
    const src = createFakeDataSource({ ...s.init, latencyMs: 0 });
    const ids = (s.init.snapshot?.participants ?? []).map((p) => p.player_id);
    expect(ids.length).toBeGreaterThan(1);
    const overview = vi.spyOn(src, 'overview');
    const overviewAll = vi.spyOn(src, 'overviewAll');
    const rows = await loadTokenRows(src, ids);
    expect(overviewAll).toHaveBeenCalledTimes(1);
    expect(overview).not.toHaveBeenCalled();
    for (const id of ids) {
      const row = rows[id];
      expect(row?.kind, id).toBe('ready');
      if (row?.kind === 'ready') expect(row.data.player_id).toBe(id);
    }
  });

  it('overviewAll answers no rows without a token fixture', async () => {
    const s = buildPreviewScenario('live-my-turn', previewNow());
    const res = await createFakeDataSource({ ...s.init, tokens: null, latencyMs: 0 }).overviewAll?.();
    expect(res).toEqual({ ok: true, data: [] });
  });
});
