import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/queries/season-formats', () => ({ getSeasonFormat: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-engine', () => ({ getKitPhases: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/tournament/enrollment-sync', () => ({ syncStandingsEnrollment: vi.fn() }));

import { getSeasonFormat } from '@/lib/supabase/queries/season-formats';
import { getKitPhases } from '@/lib/supabase/queries/format-engine';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import type { Edge } from '@/lib/format-kit/types';
import type { SeasonFormatRow } from '@/lib/format-studio/library-types';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logger } from '@/lib/logger';
import { AutoAdvanceError, autoAdvanceTargets, runAutoAdvance } from '../auto-advance';

const SEASON = 's-1';
const edge = (key: string, from: string, to: string, gate: Edge['gate']): Edge =>
  ({ key, from, to, select: [{ kind: 'top_n', n: 2 }], seeding: 'rank', gate }) as Edge;

function format(engine: SeasonFormatRow['engine'], edges: Edge[]): SeasonFormatRow {
  return { engine, seed: 'seed', spec: { edges } } as unknown as SeasonFormatRow;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getKitPhases).mockResolvedValue([
    { id: 'A', format_stage_key: 'groups', stage_order: 1, stage_spec: null },
    { id: 'B', format_stage_key: 'playoffs', stage_order: 2, stage_spec: null },
    { id: 'C', format_stage_key: 'consolation', stage_order: 3, stage_spec: null },
  ]);
  vi.mocked(getTournamentById).mockResolvedValue({ status: 'upcoming' } as never);
  vi.mocked(syncStandingsEnrollment).mockResolvedValue({ enrolled_count: 4 } as never);
});

describe('autoAdvanceTargets', () => {
  it('lists only the auto edges out of the phase', async () => {
    vi.mocked(getSeasonFormat).mockResolvedValue(
      format('kit', [edge('up', 'groups', 'playoffs', 'auto'), edge('down', 'groups', 'consolation', 'admin_confirm')]),
    );
    expect(await autoAdvanceTargets(SEASON, 'A')).toEqual(['B']);
    expect(await autoAdvanceTargets(SEASON, 'B')).toEqual([]);
  });

  it('leads into every phase of a foreach_group stage', async () => {
    vi.mocked(getKitPhases).mockResolvedValue([
      { id: 'A', format_stage_key: 'groups', format_group: 0, stage_order: 1, stage_spec: null },
      { id: 'B1', format_stage_key: 'playoffs', format_group: 1, stage_order: 2, stage_spec: null },
      { id: 'B2', format_stage_key: 'playoffs', format_group: 2, stage_order: 2, stage_spec: null },
    ]);
    vi.mocked(getSeasonFormat).mockResolvedValue(format('kit', [edge('up', 'groups', 'playoffs', 'auto')]));
    expect(await autoAdvanceTargets(SEASON, 'A')).toEqual(['B1', 'B2']);
    expect(await runAutoAdvance(SEASON, 'A')).toEqual([
      { target_phase_id: 'B1', enrolled_count: 4 },
      { target_phase_id: 'B2', enrolled_count: 4 },
    ]);
  });

  it('runs nothing unless the league is on the kit engine', async () => {
    vi.mocked(getSeasonFormat).mockResolvedValue(format('shadow', [edge('up', 'groups', 'playoffs', 'auto')]));
    expect(await autoAdvanceTargets(SEASON, 'A')).toEqual([]);
    vi.mocked(getSeasonFormat).mockResolvedValue(null);
    expect(await autoAdvanceTargets(SEASON, 'A')).toEqual([]);
  });
});

describe('runAutoAdvance', () => {
  it('enrolls an upcoming target from the completed phase', async () => {
    vi.mocked(getSeasonFormat).mockResolvedValue(format('kit', [edge('up', 'groups', 'playoffs', 'auto')]));
    expect(await runAutoAdvance(SEASON, 'A')).toEqual([{ target_phase_id: 'B', enrolled_count: 4 }]);
    expect(syncStandingsEnrollment).toHaveBeenCalledWith(SEASON, 'B', { source_phase_id: 'A' });
  });

  describe('when a target fails', () => {
    const twoTargets = () => {
      vi.mocked(getKitPhases).mockResolvedValue([
        { id: 'A', format_stage_key: 'groups', format_group: 0, stage_order: 1, stage_spec: null },
        { id: 'B1', format_stage_key: 'playoffs', format_group: 1, stage_order: 2, stage_spec: null },
        { id: 'B2', format_stage_key: 'playoffs', format_group: 2, stage_order: 2, stage_spec: null },
      ]);
      vi.mocked(getSeasonFormat).mockResolvedValue(format('kit', [edge('up', 'groups', 'playoffs', 'auto')]));
    };

    it('still advances the other targets, then reports both with the original error logged', async () => {
      twoTargets();
      const boom = new Error('db down');
      vi.mocked(syncStandingsEnrollment).mockRejectedValueOnce(boom).mockResolvedValueOnce({ enrolled_count: 5 } as never);

      const error = await runAutoAdvance(SEASON, 'A').catch((err: unknown) => err);

      expect(error).toBeInstanceOf(AutoAdvanceError);
      const failure = error as AutoAdvanceError;
      expect(failure.results).toEqual([{ target_phase_id: 'B2', enrolled_count: 5 }]);
      expect(failure.failures).toEqual([{ target_phase_id: 'B1', error: boom }]);
      expect(failure.code).toBeUndefined();
      expect(syncStandingsEnrollment).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith('format-engine/auto-advance', expect.any(String), expect.objectContaining({ targetId: 'B1', error: boom }));
    });

    it('exposes the code of a user-facing refusal', async () => {
      twoTargets();
      const refusal = new UserFacingError('needs a list', { code: 'advance_manual_list_required', status: 409 });
      vi.mocked(syncStandingsEnrollment).mockRejectedValueOnce(refusal).mockResolvedValueOnce({ enrolled_count: 5 } as never);

      const error = (await runAutoAdvance(SEASON, 'A').catch((err: unknown) => err)) as AutoAdvanceError;

      expect(error.code).toBe('advance_manual_list_required');
    });

    it('reports a failed target read like a failed enrollment', async () => {
      twoTargets();
      vi.mocked(getTournamentById).mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce({ status: 'upcoming' } as never);

      const error = (await runAutoAdvance(SEASON, 'A').catch((err: unknown) => err)) as AutoAdvanceError;

      expect(error.results).toEqual([{ target_phase_id: 'B2', enrolled_count: 4 }]);
      expect(error.failures.map((f) => f.target_phase_id)).toEqual(['B1']);
    });
  });

  it('leaves a target that already started alone', async () => {
    vi.mocked(getSeasonFormat).mockResolvedValue(format('kit', [edge('up', 'groups', 'playoffs', 'auto')]));
    vi.mocked(getTournamentById).mockResolvedValue({ status: 'active' } as never);
    expect(await runAutoAdvance(SEASON, 'A')).toEqual([]);
    expect(syncStandingsEnrollment).not.toHaveBeenCalled();
  });
});
