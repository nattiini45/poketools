import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));

import { revalidateMatchPages } from '../revalidation';
import { revalidatePath } from 'next/cache';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';

const mockRevalidatePath = vi.mocked(revalidatePath);
const mockGetTournamentById = vi.mocked(getTournamentById);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────

describe('revalidateMatchPages', () => {
  it('revalidates tournament detail and stats pages', async () => {
    mockGetTournamentById.mockResolvedValue(null as never);

    await revalidateMatchPages('t-123');

    expect(mockRevalidatePath).toHaveBeenCalledWith('/tournaments/t-123');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/tournaments/t-123/stats');
  });

  it('revalidates the tournaments list page', async () => {
    mockGetTournamentById.mockResolvedValue(null as never);

    await revalidateMatchPages('t-123');

    expect(mockRevalidatePath).toHaveBeenCalledWith('/tournaments');
  });

  it('revalidates league pages when tournament has a season_id', async () => {
    mockGetTournamentById.mockResolvedValue({
      id: 't-123',
      season_id: 's-456',
    } as never);

    await revalidateMatchPages('t-123');

    expect(mockRevalidatePath).toHaveBeenCalledWith('/leagues/s-456');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/leagues/s-456/stats');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/leagues');
  });

  it('revalidates league team pages and matchup analysis when tournament has a season_id', async () => {
    mockGetTournamentById.mockResolvedValue({
      id: 't-123',
      season_id: 's-456',
    } as never);

    await revalidateMatchPages('t-123');

    expect(mockRevalidatePath).toHaveBeenCalledWith('/leagues/s-456/teams');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/leagues/s-456/matchup');
  });

  it('does not revalidate league team pages or matchup when tournament has no season_id', async () => {
    mockGetTournamentById.mockResolvedValue({
      id: 't-123',
      season_id: null,
    } as never);

    await revalidateMatchPages('t-123');

    expect(mockRevalidatePath).not.toHaveBeenCalledWith('/leagues/s-456/teams');
    expect(mockRevalidatePath).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\/leagues\/[^/]+\/(teams|matchup)$/),
    );
  });

  it('revalidates the public teams directory always (even without a season_id)', async () => {
    mockGetTournamentById.mockResolvedValue(null as never);

    await revalidateMatchPages('t-123');

    expect(mockRevalidatePath).toHaveBeenCalledWith('/teams');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/teams/library');
  });

  it('revalidates the public teams directory when a season_id is present', async () => {
    mockGetTournamentById.mockResolvedValue({
      id: 't-123',
      season_id: 's-456',
    } as never);

    await revalidateMatchPages('t-123');

    expect(mockRevalidatePath).toHaveBeenCalledWith('/teams');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/teams/library');
  });

  it('does not revalidate league pages when tournament has no season_id', async () => {
    mockGetTournamentById.mockResolvedValue({
      id: 't-123',
      season_id: null,
    } as never);

    await revalidateMatchPages('t-123');

    expect(mockRevalidatePath).not.toHaveBeenCalledWith(expect.stringContaining('/leagues/'));
    expect(mockRevalidatePath).not.toHaveBeenCalledWith('/leagues');
  });

  it('revalidates admin matches page', async () => {
    mockGetTournamentById.mockResolvedValue(null as never);

    await revalidateMatchPages('t-123');

    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/matches');
  });

  it('revalidates specific admin match page when matchId is provided', async () => {
    mockGetTournamentById.mockResolvedValue(null as never);

    await revalidateMatchPages('t-123', 'm-789');

    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/matches/m-789');
  });

  it('does not revalidate specific admin match page when matchId is omitted', async () => {
    mockGetTournamentById.mockResolvedValue(null as never);

    await revalidateMatchPages('t-123');

    // Should have /admin/matches but not /admin/matches/<specific>
    const specificMatchCalls = mockRevalidatePath.mock.calls.filter(
      (call) => typeof call[0] === 'string' && /^\/admin\/matches\//.test(call[0]),
    );
    expect(specificMatchCalls).toHaveLength(0);
  });

  it('revalidates leaderboard page', async () => {
    mockGetTournamentById.mockResolvedValue(null as never);

    await revalidateMatchPages('t-123');

    expect(mockRevalidatePath).toHaveBeenCalledWith('/leaderboard');
  });

  it('revalidates home page', async () => {
    mockGetTournamentById.mockResolvedValue(null as never);

    await revalidateMatchPages('t-123');

    expect(mockRevalidatePath).toHaveBeenCalledWith('/');
  });

  it('revalidates pokemon detail layout for usage blocks', async () => {
    mockGetTournamentById.mockResolvedValue(null as never);

    await revalidateMatchPages('t-123');

    expect(mockRevalidatePath).toHaveBeenCalledWith('/pokemon', 'layout');
  });

  it('calls getTournamentById with the correct tournament ID', async () => {
    mockGetTournamentById.mockResolvedValue(null as never);

    await revalidateMatchPages('t-999');

    expect(mockGetTournamentById).toHaveBeenCalledWith('t-999');
  });

  it('revalidates all expected paths for a tournament with season (comprehensive)', async () => {
    mockGetTournamentById.mockResolvedValue({
      id: 't-123',
      season_id: 's-456',
    } as never);

    await revalidateMatchPages('t-123', 'm-789');

    const allPaths = mockRevalidatePath.mock.calls.map((c) => c[0]);
    expect(allPaths).toContain('/tournaments/t-123');
    expect(allPaths).toContain('/tournaments/t-123/stats');
    expect(allPaths).toContain('/tournaments');
    expect(allPaths).toContain('/teams');
    expect(allPaths).toContain('/teams/library');
    expect(allPaths).toContain('/leagues/s-456');
    expect(allPaths).toContain('/leagues/s-456/stats');
    expect(allPaths).toContain('/leagues/s-456/teams');
    expect(allPaths).toContain('/leagues/s-456/matchup');
    expect(allPaths).toContain('/leagues');
    expect(allPaths).toContain('/admin/matches');
    expect(allPaths).toContain('/admin/matches/m-789');
    expect(allPaths).toContain('/leaderboard');
    expect(allPaths).toContain('/');
    expect(allPaths).toContain('/pokemon');
  });
});
