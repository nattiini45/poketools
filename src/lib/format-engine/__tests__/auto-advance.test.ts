import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
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
import { autoAdvanceTargets, runAutoAdvance } from '../auto-advance';

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

  it('leaves a target that already started alone', async () => {
    vi.mocked(getSeasonFormat).mockResolvedValue(format('kit', [edge('up', 'groups', 'playoffs', 'auto')]));
    vi.mocked(getTournamentById).mockResolvedValue({ status: 'active' } as never);
    expect(await runAutoAdvance(SEASON, 'A')).toEqual([]);
    expect(syncStandingsEnrollment).not.toHaveBeenCalled();
  });
});
