import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Characterization of the AI-artifact writes (docs/state-machines.md, "AI artifact"): a generation settles its
 * pending row as completed or failed by id, with the fields the routes pass.
 */

const builder = vi.hoisted(() => {
  const b: Record<string, ReturnType<typeof vi.fn>> & { result: { data: unknown; error: unknown } } = {
    result: { data: [{ id: 'row-1' }], error: null },
  } as never;
  for (const m of ['from', 'update', 'eq', 'in', 'select']) b[m] = vi.fn(() => b);
  (b as unknown as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(b.result).then(resolve, reject);
  return b;
});

vi.mock('@/lib/supabase/client', () => ({ supabase: builder }));

import { updateMatchAnalysis } from '../match-analyses';
import { updateMatchPrepAnalysis } from '../match-prep-analyses';
import { updateTournamentReport } from '../tournament-reports';

beforeEach(() => {
  vi.clearAllMocks();
  builder.result = { data: [{ id: 'row-1' }], error: null };
});

const cases = [
  ['match_analyses', (status: 'completed' | 'failed') => updateMatchAnalysis('row-1', { status, analysis: { summary: 's' } as never, prompt_tokens: 1, error: null })],
  ['match_prep_analyses', (status: 'completed' | 'failed') => updateMatchPrepAnalysis('row-1', { status, has_user_team: true, prompt_tokens: 1, error: null })],
  ['tournament_reports', (status: 'completed' | 'failed') => updateTournamentReport('row-1', { status, content: {} as never, prompt_tokens: 1, error: null })],
] as const;

describe('AI artifact settle writes', () => {
  it.each(cases)('%s: completes the row by id with the given fields', async (table, settle) => {
    await settle('completed');
    expect(builder.from).toHaveBeenCalledWith(table);
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', prompt_tokens: 1, error: null }));
    expect(builder.eq).toHaveBeenCalledWith('id', 'row-1');
  });

  it.each(cases)('%s: fails the row by id', async (table, settle) => {
    await settle('failed');
    expect(builder.from).toHaveBeenCalledWith(table);
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(builder.eq).toHaveBeenCalledWith('id', 'row-1');
  });

  it.each(cases)('%s: rethrows a Supabase error', async (_table, settle) => {
    builder.result = { data: null, error: new Error('boom') };
    await expect(settle('completed')).rejects.toThrow('boom');
  });
});
