import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabase } from '@/lib/__tests__/helpers/supabase-mock';

// ── Supabase mock ─────────────────────────────────────────────────────
vi.mock('@/lib/supabase/client', () => ({
  supabase: createMockSupabase(),
}));

import { supabase } from '@/lib/supabase/client';
import { getTiebreakerOrdersBySeason, setRedraftPhaseOpen, toFormatRules, upsertFormatRules } from '../format-rules';
import type { FormatRules } from '@/types/format-rules';
import { epbPack } from '@/lib/format-pack';

type MockSupabase = ReturnType<typeof createMockSupabase>;
const mock = supabase as unknown as MockSupabase;

// ── Fixtures ──────────────────────────────────────────────────────────

const seasonId = '00000000-0000-4000-8000-000000000001';

// A format_rules row as it comes back from the DB (snake_case columns).
const existingRow = {
  id: '00000000-0000-4000-8000-000000000002',
  season_id: seasonId,
  banned_moves: [],
  banned_items: [],
  tera_rules: { ...epbPack.teraByStage },
  tiebreaker_order: [...epbPack.tiebreakerChain],
  draft_budget: epbPack.defaults.draftBudget,
  draft_picks: epbPack.defaults.draftPicks,
  draft_token_ratio: epbPack.defaults.tokenRatio,
  draft_token_max: epbPack.defaults.tokenMax,
  draft_token_max_per_line: epbPack.defaults.tokenMaxPerLine,
  redraft_phase_open: true,
  comeback_spend_open: false,
  created_at: '2026-08-13T00:00:00Z',
};

// The epb_set_redraft_phase_open RPC returns the updated row as jsonb.
const rpcClosedRow = { ...existingRow, redraft_phase_open: false };

describe('setRedraftPhaseOpen', () => {
  beforeEach(() => {
    mock.__reset();
  });

  it('toggles via the epb_set_redraft_phase_open RPC (not a plain update) when rules exist', async () => {
    // getFormatRules -> .maybeSingle() returns the existing row.
    (mock.maybeSingle as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({ data: existingRow, error: null })
    );
    // The RPC (await supabase.rpc(...)) resolves via .then — override it to
    // return the updated jsonb row.
    (mock.then as ReturnType<typeof vi.fn>).mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: rpcClosedRow, error: null })
    );

    const result = await setRedraftPhaseOpen(seasonId, false);

    expect(result.redraft_phase_open).toBe(false);
    expect(result.id).toBe(existingRow.id);

    // Must call the locked RPC with the season id + open flag.
    expect(mock.rpc).toHaveBeenCalledWith('epb_set_redraft_phase_open', {
      p_season_id: seasonId,
      p_open: false,
    });

    // Must NOT take the plain-update path.
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('falls back to upsertFormatRules when no rules row exists (does not call the RPC)', async () => {
    // getFormatRules -> maybeSingle() returns null (no row), so the upsert
    // fallback path is taken.
    (mock.maybeSingle as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({ data: null, error: null })
    );
    // upsertFormatRules -> .single() reads currentResult (the upserted row).
    mock.__setResult({ ...existingRow, redraft_phase_open: true });

    const result = await setRedraftPhaseOpen(seasonId, true);

    expect(result.redraft_phase_open).toBe(true);

    // The RPC is skipped entirely on the missing-row branch.
    expect(mock.rpc).not.toHaveBeenCalled();
    // The upsert path is taken instead.
    expect(mock.from).toHaveBeenCalledWith('format_rules');
    expect(mock.upsert).toHaveBeenCalledTimes(1);
  });

  it('falls back to upsertFormatRules when the RPC raises format_rules_not_found (P0002)', async () => {
    // getFormatRules -> maybeSingle() returns the existing row (so the RPC
    // branch is taken), but the RPC then raises P0002 (defensive: the row
    // vanished between the get and the locked update).
    (mock.maybeSingle as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({ data: existingRow, error: null })
    );
    const rpcErr = Object.assign(new Error('format_rules_not_found'), { code: 'P0002' });
    (mock.then as ReturnType<typeof vi.fn>).mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: rpcErr })
    );
    // upsertFormatRules fallback -> .single() reads currentResult.
    mock.__setResult({ ...existingRow, redraft_phase_open: false });

    const result = await setRedraftPhaseOpen(seasonId, false);

    expect(result.redraft_phase_open).toBe(false);
    // The locked RPC was attempted, then the upsert fallback ran.
    expect(mock.rpc).toHaveBeenCalledWith('epb_set_redraft_phase_open', {
      p_season_id: seasonId,
      p_open: false,
    });
    expect(mock.upsert).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-P0002 RPC errors verbatim', async () => {
    (mock.maybeSingle as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({ data: existingRow, error: null })
    );
    const rpcErr = Object.assign(new Error('boom'), { code: '23505' });
    (mock.then as ReturnType<typeof vi.fn>).mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: rpcErr })
    );

    await expect(setRedraftPhaseOpen(seasonId, false)).rejects.toBe(rpcErr);
  });

  it('maps the returned jsonb row through toFormatRules (typed FormatRules)', async () => {
    (mock.maybeSingle as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({ data: existingRow, error: null })
    );
    (mock.then as ReturnType<typeof vi.fn>).mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: rpcClosedRow, error: null })
    );

    const result = await setRedraftPhaseOpen(seasonId, false);

    // toFormatRules maps snake_case columns to the FormatRules shape.
    const expected: Pick<FormatRules, 'redraft_phase_open' | 'draft_budget' | 'draft_token_ratio'> = {
      redraft_phase_open: false,
      draft_budget: epbPack.defaults.draftBudget,
      draft_token_ratio: epbPack.defaults.tokenRatio,
    };
    expect(result).toMatchObject(expected);
  });
});
describe('comeback_spend_open', () => {
  beforeEach(() => {
    mock.__reset();
  });

  it('toFormatRules maps comeback_spend_open', () => {
    expect(toFormatRules({ ...existingRow, comeback_spend_open: true }).comeback_spend_open).toBe(true);
    expect(toFormatRules({ ...existingRow, comeback_spend_open: false }).comeback_spend_open).toBe(false);
  });

  it('toFormatRules reads a jsonb RPC row without the column as closed', () => {
    const { comeback_spend_open: _omit, ...legacy } = existingRow;
    void _omit;
    expect(toFormatRules(legacy as typeof existingRow).comeback_spend_open).toBe(false);
  });

  it('upsertFormatRules passes comeback_spend_open through when given', async () => {
    mock.__setResult({ ...existingRow, comeback_spend_open: true });
    const result = await upsertFormatRules(seasonId, { comeback_spend_open: true });
    expect(result.comeback_spend_open).toBe(true);
    expect(mock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ season_id: seasonId, comeback_spend_open: true }),
      { onConflict: 'season_id' },
    );
  });

  it('upsertFormatRules leaves comeback_spend_open alone when not given', async () => {
    mock.__setResult(existingRow);
    await upsertFormatRules(seasonId, { draft_budget: 200 });
    const row = (mock.upsert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty('comeback_spend_open');
  });
});

describe('redraft_phase_open (L7)', () => {
  beforeEach(() => {
    mock.__reset();
  });

  it('upsertFormatRules leaves an open redraft phase untouched when not given', async () => {
    mock.__setResult(existingRow);
    const result = await upsertFormatRules(seasonId, { draft_budget: 200 });
    const row = (mock.upsert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty('redraft_phase_open');
    expect(result.redraft_phase_open).toBe(true);
  });

  it('upsertFormatRules writes redraft_phase_open when given', async () => {
    mock.__setResult({ ...existingRow, redraft_phase_open: false });
    await upsertFormatRules(seasonId, { redraft_phase_open: false });
    expect(mock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ season_id: seasonId, redraft_phase_open: false }),
      { onConflict: 'season_id' },
    );
  });
});

describe('upsertFormatRules fallbacks (format pack)', () => {
  beforeEach(() => {
    mock.__reset();
  });

  it('fills every missing column from the active format pack', async () => {
    mock.__setResult(existingRow);
    await upsertFormatRules(seasonId, {});
    const row = (mock.upsert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row).toEqual({
      season_id: seasonId,
      banned_moves: [],
      banned_items: [],
      tera_rules: { ...epbPack.teraByStage },
      tiebreaker_order: [...epbPack.tiebreakerChain],
      draft_budget: epbPack.defaults.draftBudget,
      draft_picks: epbPack.defaults.draftPicks,
      draft_token_ratio: epbPack.defaults.tokenRatio,
      draft_token_max: epbPack.defaults.tokenMax,
      draft_token_max_per_line: epbPack.defaults.tokenMaxPerLine,
    });
  });

  it('keeps given values over the pack defaults', async () => {
    mock.__setResult(existingRow);
    await upsertFormatRules(seasonId, { draft_budget: 200, tiebreaker_order: ['match_points'] });
    const row = (mock.upsert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({ draft_budget: 200, tiebreaker_order: ['match_points'] });
  });
});

describe('getTiebreakerOrdersBySeason', () => {
  beforeEach(() => {
    mock.__reset();
  });

  it('reads the stored order of every given season in ONE query and omits seasons without a row', async () => {
    const rows = [
      { season_id: 'season-a', tiebreaker_order: ['evolution_points', 'match_points'] },
      { season_id: 'season-b', tiebreaker_order: ['match_points'] },
    ];
    // `then` keeps the implementation an earlier test installed (reset only clears calls): set it explicitly.
    (mock.then as ReturnType<typeof vi.fn>).mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: rows, error: null }),
    );

    const orders = await getTiebreakerOrdersBySeason(['season-a', 'season-b', 'season-none']);

    expect(mock.from).toHaveBeenCalledTimes(1);
    expect(mock.from).toHaveBeenCalledWith('format_rules');
    expect(mock.select).toHaveBeenCalledWith('season_id, tiebreaker_order');
    expect(mock.in).toHaveBeenCalledWith('season_id', ['season-a', 'season-b', 'season-none']);
    expect(Object.fromEntries(orders)).toEqual({
      'season-a': ['evolution_points', 'match_points'],
      'season-b': ['match_points'],
    });
  });

  it('reads nothing for no seasons', async () => {
    expect((await getTiebreakerOrdersBySeason([])).size).toBe(0);
    expect(mock.from).not.toHaveBeenCalled();
  });

  it('throws a failed read instead of ranking by the pack chain', async () => {
    const failure = new Error('format_rules unavailable');
    (mock.then as ReturnType<typeof vi.fn>).mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: failure }),
    );

    await expect(getTiebreakerOrdersBySeason(['season-a'])).rejects.toBe(failure);
  });
});
