import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getStagesBySeasonId: vi.fn(),
  getParticipants: vi.fn(),
  replacePhaseEnrollment: vi.fn(async () => true),
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/tournament/season-standings', () => ({ computeStandingsForSeason: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn(), getSeasonParticipants: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getCompletedMatchRecords: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({ getGroupsByTournament: vi.fn() }));
vi.mock('@/lib/format-engine/advance', () => ({ kitAdvancingPlayers: vi.fn() }));

import { ENROLLMENT_SYNC_MAX_ATTEMPTS, mergeKitContributions, syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import { getParticipants, getStagesBySeasonId, getTournamentById, replacePhaseEnrollment } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { kitAdvancingPlayers } from '@/lib/format-engine/advance';
import { parseEnrollmentSource } from '@/types/tournament';
import type { EnrollmentSource } from '@/types/season';

const lastEntries = () => vi.mocked(replacePhaseEnrollment).mock.calls.at(-1)?.[1];
const adv = (...ids: string[]) => ids.map((player_id, i) => ({ player_id, seed: i + 1, select: 0 }));

describe('mergeKitContributions', () => {
  const done = [
    { id: 'S1', status: 'completed' as const },
    { id: 'S2', status: 'completed' as const },
    { id: 'S3', status: 'active' as const },
  ];

  it('starts with the block of the first source', () => {
    expect(mergeKitContributions(undefined, 'S1', ['a', 'b'], done)).toEqual([{ source_phase_id: 'S1', player_ids: ['a', 'b'] }]);
  });

  it('keeps the block of an earlier completed source and appends the new one', () => {
    const merged = mergeKitContributions([{ source_phase_id: 'S1', player_ids: ['a', 'b'] }], 'S2', ['c'], done);
    expect(merged.map((b) => b.source_phase_id)).toEqual(['S1', 'S2']);
  });

  it('replaces the block of the same source in place', () => {
    const previous = [
      { source_phase_id: 'S1', player_ids: ['a', 'b'] },
      { source_phase_id: 'S2', player_ids: ['c'] },
    ];
    expect(mergeKitContributions(previous, 'S1', ['z'], done)).toEqual([
      { source_phase_id: 'S1', player_ids: ['z'] },
      { source_phase_id: 'S2', player_ids: ['c'] },
    ]);
  });

  it('drops the block of a source that is not completed or no longer exists', () => {
    const previous = [
      { source_phase_id: 'S3', player_ids: ['x'] },
      { source_phase_id: 'gone', player_ids: ['y'] },
    ];
    expect(mergeKitContributions(previous, 'S1', ['a'], done)).toEqual([{ source_phase_id: 'S1', player_ids: ['a'] }]);
  });
});

describe('syncStandingsEnrollment into a phase fed by several kit edges', () => {
  let stored: EnrollmentSource | null;

  function arrange() {
    vi.resetAllMocks();
    stored = null;
    vi.mocked(getTournamentById).mockImplementation(
      async () => ({ id: 'T', season_id: 's1', advancement_rule: null, status: 'upcoming', enrollment_source: stored }) as never,
    );
    // The real function is a compare-and-set on enrollment_source.synced_at under a row lock.
    vi.mocked(replacePhaseEnrollment).mockImplementation(async (_id, _entries, source, expectedSyncedAt) => {
      if ((stored?.synced_at ?? null) !== expectedSyncedAt) return false;
      stored = source;
      return true;
    });
    vi.mocked(getSeasonById).mockResolvedValue({ id: 's1', name: 'League', format_type: 'custom' } as never);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([
      { id: 'S1', name: 'Group A', stage_order: 1, status: 'completed', bracket_type: 'round_robin' },
      { id: 'S2', name: 'Group B', stage_order: 2, status: 'completed', bracket_type: 'round_robin' },
      { id: 'T', name: 'Playoffs', stage_order: 3, status: 'upcoming', bracket_type: 'single_elim' },
    ] as never);
    vi.mocked(getParticipants).mockResolvedValue([]);
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  }

  beforeEach(arrange);

  it('keeps the entrants of the first source when the second one completes, seeds follow the contribution order', async () => {
    vi.mocked(kitAdvancingPlayers).mockResolvedValueOnce(adv('a1', 'a2')).mockResolvedValueOnce(adv('b1', 'b2'));

    await syncStandingsEnrollment('s1', 'T', { source_phase_id: 'S1' });
    expect(lastEntries()).toEqual([
      { player_id: 'a1', seed: 1 },
      { player_id: 'a2', seed: 2 },
    ]);

    const result = await syncStandingsEnrollment('s1', 'T', { source_phase_id: 'S2' });
    expect(lastEntries()).toEqual([
      { player_id: 'a1', seed: 1 },
      { player_id: 'a2', seed: 2 },
      { player_id: 'b1', seed: 3 },
      { player_id: 'b2', seed: 4 },
    ]);
    expect(result.enrolled_count).toBe(4);
    expect(stored?.contributions).toEqual([
      { source_phase_id: 'S1', player_ids: ['a1', 'a2'] },
      { source_phase_id: 'S2', player_ids: ['b1', 'b2'] },
    ]);
    expect(stored?.source_phase_id).toBe('S2');
  });

  it('enrolls a player that two edges select once, at his earlier seed', async () => {
    vi.mocked(kitAdvancingPlayers).mockResolvedValueOnce(adv('a1', 'x')).mockResolvedValueOnce(adv('x', 'b1'));
    await syncStandingsEnrollment('s1', 'T', { source_phase_id: 'S1' });
    await syncStandingsEnrollment('s1', 'T', { source_phase_id: 'S2' });
    expect(lastEntries()).toEqual([
      { player_id: 'a1', seed: 1 },
      { player_id: 'x', seed: 2 },
      { player_id: 'b1', seed: 3 },
    ]);
  });

  it('advancing the later source again replaces only its own block', async () => {
    vi.mocked(kitAdvancingPlayers)
      .mockResolvedValueOnce(adv('a1'))
      .mockResolvedValueOnce(adv('b1', 'b2'))
      .mockResolvedValueOnce(adv('b3'));
    await syncStandingsEnrollment('s1', 'T', { source_phase_id: 'S1' });
    await syncStandingsEnrollment('s1', 'T', { source_phase_id: 'S2' });
    await syncStandingsEnrollment('s1', 'T', { source_phase_id: 'S2' });
    expect(lastEntries()).toEqual([
      { player_id: 'a1', seed: 1 },
      { player_id: 'b3', seed: 2 },
    ]);
  });

  it('does not treat the enrollment of a phase created before its sources finished as an edge block', async () => {
    // Created-time enrollment from the phase before it (still running): no contributions recorded.
    stored = { type: 'standings', source_phase_id: 'S2', synced_at: 't', frozen: false };
    vi.mocked(kitAdvancingPlayers).mockResolvedValueOnce(adv('a1'));
    await syncStandingsEnrollment('s1', 'T', { source_phase_id: 'S1' });
    expect(lastEntries()).toEqual([{ player_id: 'a1', seed: 1 }]);
  });

  it('keeps the edge seeds of a single source', async () => {
    vi.mocked(kitAdvancingPlayers).mockResolvedValueOnce(adv('a2', 'a1'));
    await syncStandingsEnrollment('s1', 'T', { source_phase_id: 'S1' });
    expect(lastEntries()).toEqual([
      { player_id: 'a2', seed: 1 },
      { player_id: 'a1', seed: 2 },
    ]);
  });

  it('hands the synced_at it read to the write (null for a phase with no source yet)', async () => {
    vi.mocked(kitAdvancingPlayers).mockResolvedValueOnce(adv('a1')).mockResolvedValueOnce(adv('b1'));
    await syncStandingsEnrollment('s1', 'T', { source_phase_id: 'S1' });
    const first = stored;
    await syncStandingsEnrollment('s1', 'T', { source_phase_id: 'S2' });
    const calls = vi.mocked(replacePhaseEnrollment).mock.calls;
    expect(calls[0][3]).toBeNull();
    expect(calls[1][3]).toBe(first?.synced_at);
  });

  it('two sources of one phase that complete together keep both blocks (the loser reads and merges again)', async () => {
    vi.mocked(kitAdvancingPlayers).mockImplementation(async (input) =>
      input.sourcePhaseId === 'S1' ? adv('a1', 'a2') : adv('b1', 'b2'),
    );
    // Both syncs read the phase with no source before either one writes: the second write loses the compare-and-set.
    const [one, two] = await Promise.all([
      syncStandingsEnrollment('s1', 'T', { source_phase_id: 'S1' }),
      syncStandingsEnrollment('s1', 'T', { source_phase_id: 'S2' }),
    ]);
    expect(vi.mocked(replacePhaseEnrollment).mock.calls.length).toBeGreaterThan(2);
    expect(stored?.contributions).toEqual([
      { source_phase_id: 'S1', player_ids: ['a1', 'a2'] },
      { source_phase_id: 'S2', player_ids: ['b1', 'b2'] },
    ]);
    expect(lastEntries()).toEqual([
      { player_id: 'a1', seed: 1 },
      { player_id: 'a2', seed: 2 },
      { player_id: 'b1', seed: 3 },
      { player_id: 'b2', seed: 4 },
    ]);
    expect([one.enrolled_count, two.enrolled_count].sort()).toEqual([2, 4]);
  });

  it('refuses with 409 ENROLLMENT_SYNC_CONFLICT after the allowed attempts when another sync keeps winning', async () => {
    vi.mocked(kitAdvancingPlayers).mockResolvedValue(adv('a1'));
    vi.mocked(replacePhaseEnrollment).mockResolvedValue(false);
    await expect(syncStandingsEnrollment('s1', 'T', { source_phase_id: 'S1' })).rejects.toMatchObject({
      code: 'ENROLLMENT_SYNC_CONFLICT',
      statusCode: 409,
    });
    expect(replacePhaseEnrollment).toHaveBeenCalledTimes(ENROLLMENT_SYNC_MAX_ATTEMPTS);
  });

  it('records no contributions for a league that does not advance on the kit', async () => {
    vi.mocked(getSeasonById).mockResolvedValue({ id: 's1', name: 'League', format_type: 'standard' } as never);
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1', name: 'P1' }] as never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue([{ player_id: 'p1' }] as never);
    await syncStandingsEnrollment('s1', 'T', { source_phase_id: 'S1' });
    expect(kitAdvancingPlayers).not.toHaveBeenCalled();
    expect(stored?.contributions).toBeUndefined();
  });
});

describe('parseEnrollmentSource contributions', () => {
  const base = { type: 'standings', source_phase_id: 'S2', synced_at: 't', frozen: false };

  it('reads valid contributions and ignores malformed ones', () => {
    const blocks = [{ source_phase_id: 'S1', player_ids: ['a'] }];
    expect(parseEnrollmentSource({ ...base, contributions: blocks })?.contributions).toEqual(blocks);
    expect(parseEnrollmentSource({ ...base, contributions: [{ source_phase_id: 1, player_ids: [] }] })?.contributions).toBeUndefined();
    expect(parseEnrollmentSource(base)?.contributions).toBeUndefined();
  });
});
