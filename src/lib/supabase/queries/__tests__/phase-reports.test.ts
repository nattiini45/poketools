import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tables } from '@/types/database';

const q = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown };
  const results: Result[] = [];
  const next = () => Promise.resolve(results.shift() ?? { data: null, error: null });
  const builder = {
    select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn(),
    range: vi.fn(next), single: vi.fn(next), maybeSingle: vi.fn(next),
    then: (resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) => next().then(resolve, reject),
  };
  for (const method of [builder.select, builder.eq, builder.in, builder.order, builder.update, builder.insert, builder.delete]) method.mockReturnValue(builder);
  return { results, builder, from: vi.fn(() => builder) };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: q.from } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

import { createPhaseReport, deletePhaseReport, getPhaseReport, getPhaseReports, updatePhaseReport } from '../phase-reports';
import { toPublicPhaseReport } from '@/lib/league-phase/public-report';

const row: Tables<'phase_reports'> = {
  id: 'report', phase_id: 'phase', round_id: 'round', report_type: 'round_recap', model_id: 'model',
  content: {}, prompt_tokens: 12, completion_tokens: 34, generation_time_ms: 56,
  status: 'pending', error: 'private diagnostics', created_at: 'created', updated_at: 'updated',
};

beforeEach(() => {
  vi.clearAllMocks();
  q.results.length = 0;
});

describe('native phase report persistence', () => {
  it('scopes reads to the native phase and round', async () => {
    q.results.push({ data: row, error: null });
    await expect(getPhaseReport('phase', 'round', 'round_recap')).resolves.toMatchObject({ phase_id: 'phase' });
    expect(q.from).toHaveBeenCalledWith('phase_reports');
    expect(q.builder.eq).toHaveBeenCalledWith('phase_id', 'phase');
    expect(q.builder.eq).toHaveBeenCalledWith('round_id', 'round');
    expect(q.builder.eq).not.toHaveBeenCalledWith('tournament_id', expect.anything());
  });

  it('reads past max_rows in a stable newest-first order', async () => {
    q.results.push({ data: Array.from({ length: 1000 }, () => row), error: null }, { data: [{ ...row, id: 'last' }], error: null });
    await expect(getPhaseReports('phase')).resolves.toHaveLength(1001);
    expect(q.builder.order.mock.calls).toEqual([['created_at', { ascending: false }], ['id'], ['created_at', { ascending: false }], ['id']]);
    expect(q.builder.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it('starts pending in native storage without invoking a model', async () => {
    q.results.push({ data: row, error: null });
    await expect(createPhaseReport('phase', 'round', 'round_recap', 'model')).resolves.toMatchObject({ status: 'pending' });
    expect(q.builder.insert).toHaveBeenCalledWith({ phase_id: 'phase', round_id: 'round', report_type: 'round_recap', model_id: 'model', status: 'pending' });
  });

  it.each(['completed', 'failed'] as const)('settles only its pending row as %s', async (status) => {
    q.results.push({ data: [{ id: 'report' }], error: null });
    const content = { headline: '', narrative: '', matchup_previews: [], standings_context: '', players_to_watch: [], bold_prediction: '' };
    await expect(updatePhaseReport('report', { status, content, model_id: 'actual-model' })).resolves.toBe(true);
    expect(q.builder.update).toHaveBeenCalledWith(expect.objectContaining({ status, content, model_id: 'actual-model' }));
    expect(q.builder.eq).toHaveBeenCalledWith('id', 'report');
    expect(q.builder.in).toHaveBeenCalledWith('status', ['pending']);
  });

  it('drops a generation when its pending row was discarded or already settled', async () => {
    q.results.push({ data: [], error: null });
    await expect(updatePhaseReport('report', { status: 'completed' })).resolves.toBe(false);
  });

  it('guards regeneration discard by captured id and status', async () => {
    q.results.push({ data: row, error: null }, { data: [], error: null });
    await expect(deletePhaseReport('phase', 'round', 'round_recap')).resolves.toBe(false);
    expect(q.builder.eq).toHaveBeenCalledWith('id', row.id);
    expect(q.builder.eq).toHaveBeenCalledWith('status', 'pending');
    q.results.push({ data: { ...row, status: 'completed' }, error: null }, { data: [{ id: row.id }], error: null });
    await expect(deletePhaseReport('phase', 'round', 'round_recap')).resolves.toBe(true);
  });

  it('does not mask read, creation or settlement failures', async () => {
    for (const operation of [
      () => getPhaseReport('phase', 'round', 'round_recap'), () => getPhaseReports('phase'),
      () => createPhaseReport('phase', 'round', 'round_recap', 'model'),
      () => updatePhaseReport('report', { status: 'failed' }),
    ]) {
      q.results.push({ data: null, error: new Error('report failed') });
      await expect(operation()).rejects.toThrow('report failed');
    }
  });

  it('publishes an explicit allowlist without token usage or model diagnostics', async () => {
    q.results.push({ data: row, error: null });
    const report = await getPhaseReport('phase', 'round', 'round_recap');
    expect(report).not.toBeNull();
    if (!report) throw new Error('Missing report fixture');
    expect(toPublicPhaseReport(report)).toEqual({
      id: row.id, phase_id: row.phase_id, round_id: row.round_id, report_type: row.report_type,
      content: {}, status: row.status, created_at: row.created_at, updated_at: row.updated_at,
    });
  });
});
