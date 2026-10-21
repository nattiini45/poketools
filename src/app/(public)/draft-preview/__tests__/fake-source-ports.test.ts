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

  it('spendComeback follows the per-line rate: tokens stay tokens, progress = tokens / rate', async () => {
    const s = buildPreviewScenario('tokens-comeback', previewNow());
    const tokens = s.init.tokens;
    if (!tokens) throw new Error('tokens-open has a token fixture');
    const [first] = tokens.lines;
    const rated = { ...tokens, lines: tokens.lines.map((l) => (l.line_id === first.line_id ? { ...l, comeback_tokens_per_progress: 2 } : l)) };
    expect(rated.comeback.unspent).toBeGreaterThanOrEqual(2);
    const src = createFakeDataSource({ ...s.init, tokens: rated, latencyMs: 0 });

    const uneven = await src.spendComeback([{ line_id: first.line_id, tokens: 1 }], 'req-1');
    expect(uneven).toEqual({ ok: false, error: { code: 'COMEBACK_TOKENS_NOT_MULTIPLE', params: { ratio: 2 } } });

    const ok = await src.spendComeback([{ line_id: first.line_id, tokens: 2 }], 'req-2');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.comeback.spent).toBe(rated.comeback.spent + 2);
      const after = ok.data.lines.find((l) => l.line_id === first.line_id);
      expect(after?.comeback_token_progress).toBe(first.comeback_token_progress + 1);
      expect(after?.total_progress).toBe(first.total_progress + 1);
    }
  });

  it('overviewAll answers no rows without a token fixture', async () => {
    const s = buildPreviewScenario('live-my-turn', previewNow());
    const res = await createFakeDataSource({ ...s.init, tokens: null, latencyMs: 0 }).overviewAll?.();
    expect(res).toEqual({ ok: true, data: [] });
  });
});
