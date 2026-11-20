import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamLibraryEntry } from '@/types/team';

/**
 * The merged library listing: legacy mode is exactly the legacy read, and phase mode answers any offset from the two
 * heads instead of approximating one (a page that starts inside the second store's rows is still correct).
 */

const m = vi.hoisted(() => ({
  mode: vi.fn(),
  listLibraryTeams: vi.fn(),
  listLibraryHead: vi.fn(),
  listPhaseLibraryHead: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: m.mode }));
vi.mock('@/lib/supabase/queries/teams', () => ({ listLibraryTeams: m.listLibraryTeams, listLibraryHead: m.listLibraryHead }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({ listPhaseLibraryHead: m.listPhaseLibraryHead }));

import { listLibraryPage } from '../library-listing';

const entry = (id: string, published: string): TeamLibraryEntry => ({
  id,
  player_id: 'p1',
  pokemon: [{ species: 'Pikachu', moves: [] } as never],
  library_title: id,
  library_description: null,
  library_tags: null,
  library_published_at: published,
  forked_from_team_id: null,
  created_at: published,
  updated_at: published,
});

const phaseRow = (id: string, published: string) => ({
  ...entry(id, published),
  phase_id: 'phase-1',
  season_id: null,
  name: id,
  match_id: null,
  import_source: 'manual' as const,
  locked: false,
  is_draft_team: false,
  draft_pool_id: null,
  forked_from_phase_team_id: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.listLibraryHead.mockResolvedValue({ data: [entry('legacy-new', '2026-11-03T00:00:00Z'), entry('legacy-old', '2026-11-01T00:00:00Z')], total: 2 });
  m.listPhaseLibraryHead.mockResolvedValue({ rows: [phaseRow('native-mid', '2026-11-02T00:00:00Z')], total: 1 });
});

describe('listLibraryPage', () => {
  it('is exactly the legacy read in the default generation, with no phase query', async () => {
    m.mode.mockResolvedValue('legacy');
    m.listLibraryTeams.mockResolvedValue({ data: [entry('legacy-new', '2026-11-03T00:00:00Z')], total: 1 });
    const result = await listLibraryPage({ limit: 10, offset: 0 });
    expect(result.total).toBe(1);
    expect(m.listLibraryTeams).toHaveBeenCalledExactlyOnceWith({ limit: 10, offset: 0 });
    expect(m.listPhaseLibraryHead).not.toHaveBeenCalled();
  });

  it('merges both stores newest first and sums the exact totals', async () => {
    m.mode.mockResolvedValue('phase');
    const result = await listLibraryPage({ limit: 10, offset: 0 });
    expect(result.data.map((row) => row.id)).toEqual(['legacy-new', 'native-mid', 'legacy-old']);
    expect(result.total).toBe(3);
    expect(m.listLibraryHead).toHaveBeenCalledExactlyOnceWith(10, { limit: 10, offset: 0 });
    expect(m.listPhaseLibraryHead).toHaveBeenCalledExactlyOnceWith(10, { limit: 10, offset: 0 });
  });

  it('answers an offset that starts inside the merged list exactly, reading offset+limit rows from each head', async () => {
    m.mode.mockResolvedValue('phase');
    const result = await listLibraryPage({ limit: 2, offset: 1 });
    expect(result.data.map((row) => row.id)).toEqual(['native-mid', 'legacy-old']);
    expect(m.listLibraryHead).toHaveBeenCalledExactlyOnceWith(3, { limit: 2, offset: 1 });
  });

  it('breaks a publication tie by id, so the merge order is stable and total', async () => {
    m.mode.mockResolvedValue('phase');
    m.listLibraryHead.mockResolvedValue({ data: [entry('b-team', '2026-11-02T00:00:00Z')], total: 1 });
    m.listPhaseLibraryHead.mockResolvedValue({ rows: [phaseRow('a-team', '2026-11-02T00:00:00Z')], total: 1 });
    const result = await listLibraryPage({ limit: 5, offset: 0 });
    expect(result.data.map((row) => row.id)).toEqual(['a-team', 'b-team']);
  });
});
