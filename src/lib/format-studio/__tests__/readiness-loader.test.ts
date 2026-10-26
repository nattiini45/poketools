import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESETS, type FormatDefinition } from '@/lib/format-kit/client';
import type { SeasonStartSignals } from '@/lib/season/season-started';
import type { SeasonWithDetails } from '@/types/season';
import type { SeasonFormatRow } from '../library-types';

const mocks = vi.hoisted(() => ({
  getSeasonFormat: vi.fn<(id: string) => Promise<SeasonFormatRow | null>>(),
  getSeasonManualPhaseCount: vi.fn<(id: string) => Promise<number>>(),
  getSeasonStartSignals: vi.fn<(id: string) => Promise<SeasonStartSignals | null>>(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/queries/season-formats', () => ({
  getSeasonFormat: mocks.getSeasonFormat,
  getSeasonManualPhaseCount: mocks.getSeasonManualPhaseCount,
  getSeasonStartSignals: mocks.getSeasonStartSignals,
}));

import { loadLeagueFormatState } from '../readiness-loader';

const RULESET = '3f2b8c1e-5a47-4d09-9b6e-7c1d2a4e8f10';

function spec(id: string): FormatDefinition {
  const found = PRESETS.find((entry) => entry.id === id);
  if (!found) throw new Error(`no preset ${id}`);
  return structuredClone(found.definition);
}

function league(over: Partial<SeasonWithDetails> = {}): SeasonWithDetails {
  return {
    id: 'season-1',
    name: 'Cup night',
    description: '',
    format_type: 'custom',
    ruleset_id: RULESET,
    start_date: null,
    end_date: null,
    status: 'upcoming',
    archived: false,
    legacy: false,
    is_test_season: false,
    core_pool: null,
    point_buy_list_id: null,
    language: 'en',
    created_at: '2026-10-24T10:00:00Z',
    updated_at: '2026-10-24T10:00:00Z',
    ruleset_name: 'Rules',
    participant_count: 8,
    tournament_count: 2,
    ...over,
  } as SeasonWithDetails;
}

function attached(over: Partial<SeasonFormatRow> = {}): SeasonFormatRow {
  return {
    season_id: 'season-1',
    definition_id: 'def-1',
    version_no: 3,
    spec_hash: 'b'.repeat(64),
    tunables: {},
    engine: 'legacy',
    frozen_at: '2026-10-24T11:00:00Z',
    amendments: [],
    spec: spec('classic-league'),
    seed: 'SECRET-SEED-VALUE',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSeasonFormat.mockResolvedValue(attached());
  mocks.getSeasonManualPhaseCount.mockResolvedValue(0);
  mocks.getSeasonStartSignals.mockResolvedValue({ status: 'upcoming', phases: [{ status: 'upcoming', rounds_total: 0 }] });
});

describe('loadLeagueFormatState', () => {
  it.each(['singles', 'doubles', 'draft', 'evolution_point_buy'] as const)('is null for a %s league and reads nothing', async (format_type) => {
    expect(await loadLeagueFormatState(league({ format_type }))).toBeNull();
    expect(mocks.getSeasonFormat).not.toHaveBeenCalled();
    expect(mocks.getSeasonManualPhaseCount).not.toHaveBeenCalled();
    expect(mocks.getSeasonStartSignals).not.toHaveBeenCalled();
  });

  it('reads once per query, in one wave, for the league', async () => {
    const order: string[] = [];
    mocks.getSeasonFormat.mockImplementation(async () => {
      order.push('format:start');
      await Promise.resolve();
      order.push('format:end');
      return attached();
    });
    mocks.getSeasonManualPhaseCount.mockImplementation(async () => {
      order.push('manual:start');
      await Promise.resolve();
      order.push('manual:end');
      return 0;
    });
    mocks.getSeasonStartSignals.mockImplementation(async () => {
      order.push('signals:start');
      await Promise.resolve();
      order.push('signals:end');
      return { status: 'upcoming', phases: [] };
    });
    await loadLeagueFormatState(league());
    expect(mocks.getSeasonFormat).toHaveBeenCalledTimes(1);
    expect(mocks.getSeasonManualPhaseCount).toHaveBeenCalledTimes(1);
    expect(mocks.getSeasonStartSignals).toHaveBeenCalledTimes(1);
    for (const mock of [mocks.getSeasonFormat, mocks.getSeasonManualPhaseCount, mocks.getSeasonStartSignals]) {
      expect(mock).toHaveBeenCalledWith('season-1');
    }
    // All three started before the first one finished: one wave, not a chain.
    expect(order.slice(0, 3).every((entry) => entry.endsWith(':start'))).toBe(true);
  });

  it('describes the attached format from the frozen copy', async () => {
    const state = await loadLeagueFormatState(league({ tournament_count: 3 }));
    expect(state?.attached).toEqual({
      definition_id: 'def-1',
      version_no: 3,
      spec_hash: 'b'.repeat(64),
      frozen_at: '2026-10-24T11:00:00Z',
      name: spec('classic-league').identity.name,
      stageCount: 2,
      createdPhases: 3,
    });
  });

  it('counts the phases the format created: all phases minus the hand-made ones', async () => {
    mocks.getSeasonManualPhaseCount.mockResolvedValue(1);
    const state = await loadLeagueFormatState(league({ tournament_count: 3 }));
    expect(state?.manualPhaseCount).toBe(1);
    expect(state?.attached?.createdPhases).toBe(2);
    mocks.getSeasonManualPhaseCount.mockResolvedValue(5);
    expect((await loadLeagueFormatState(league({ tournament_count: 3 })))?.attached?.createdPhases).toBe(0);
  });

  it('keeps the deleted source: a frozen copy without a definition id', async () => {
    mocks.getSeasonFormat.mockResolvedValue(attached({ definition_id: null }));
    expect((await loadLeagueFormatState(league()))?.attached?.definition_id).toBeNull();
  });

  it('never returns the seed or the spec', async () => {
    const state = await loadLeagueFormatState(league());
    const json = JSON.stringify(state);
    expect(json).not.toContain('SECRET-SEED-VALUE');
    expect(json).not.toContain('"seed"');
    expect(json).not.toContain('"spec"');
    expect(json).not.toContain('"stages"');
    expect(state?.attached).not.toHaveProperty('spec');
    expect(state?.attached).not.toHaveProperty('seed');
  });

  it('reads started from the signals', async () => {
    expect((await loadLeagueFormatState(league()))?.started).toBe(false);
    mocks.getSeasonStartSignals.mockResolvedValue({ status: 'active', phases: [] });
    expect((await loadLeagueFormatState(league()))?.started).toBe(true);
    mocks.getSeasonStartSignals.mockResolvedValue({ status: 'upcoming', phases: [{ status: 'upcoming', rounds_total: 2 }] });
    expect((await loadLeagueFormatState(league()))?.started).toBe(true);
    mocks.getSeasonStartSignals.mockResolvedValue(null);
    expect((await loadLeagueFormatState(league()))?.started).toBe(false);
  });

  it('builds the readiness from the league row and the reads', async () => {
    const ready = await loadLeagueFormatState(league());
    expect(ready?.readiness.applicable).toBe(true);
    expect(ready?.readiness.ready).toBe(true);

    const small = await loadLeagueFormatState(league({ participant_count: 1, ruleset_id: null, tournament_count: 1 }));
    expect(small?.readiness.items.map((i) => [i.id, i.state])).toEqual([
      ['format_attached', 'met'],
      ['phases_created', 'unmet'],
      ['roster_size', 'unmet'],
      ['rulesets', 'unmet'],
    ]);
  });

  it('without an attached format: blocked, nothing attached', async () => {
    mocks.getSeasonFormat.mockResolvedValue(null);
    const state = await loadLeagueFormatState(league({ tournament_count: 0 }));
    expect(state?.attached).toBeNull();
    expect(state?.readiness.blockedReason).toBe('format_not_attached');
    expect(state?.readiness.items.map((i) => i.state)).toEqual(['unmet', 'waiting', 'waiting', 'waiting']);
  });

  it('fails closed when a read fails', async () => {
    mocks.getSeasonFormat.mockRejectedValue(new Error('db down'));
    await expect(loadLeagueFormatState(league())).rejects.toThrow('db down');
  });
});
