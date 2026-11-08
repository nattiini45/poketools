import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: vi.fn(),
  getParticipantsBatch: vi.fn(),
}));

const loggerError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({ logger: { error: loggerError, warn: vi.fn(), info: vi.fn() } }));

import { loadStageEndedWarning } from '../stage-ended';
import { getParticipantsBatch, getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';

const ended = {
  id: 'groups',
  name: 'Group stage',
  status: 'completed' as const,
  season_id: 'season-1',
  season_format_type: 'custom' as const,
};

type Stages = Awaited<ReturnType<typeof getStagesBySeasonId>>;
type Roster = Awaited<ReturnType<typeof getParticipantsBatch>>;

function stage(id: string, name: string, enrollment_source: unknown) {
  return { id, name, enrollment_source };
}

function roster(entries: Record<string, [string, string][]>): Roster {
  return new Map(
    Object.entries(entries).map(([phaseId, players]) => [phaseId, players.map(([id, name]) => ({ id, name }))])
  ) as unknown as Roster;
}

beforeEach(() => {
  vi.clearAllMocks();
});

type Phase = Parameters<typeof loadStageEndedWarning>[0];

describe('loadStageEndedWarning: when there is nothing to say', () => {
  const quiet: [string, Phase, boolean][] = [
    ['the result was not taken back', { ...ended }, false],
    ['the phase is still running', { ...ended, status: 'active' }, true],
    ['the phase has not started either', { ...ended, status: 'upcoming' }, true],
    ['the league is not a custom league', { ...ended, season_format_type: 'singles' }, true],
    ['the phase belongs to no league', { ...ended, season_id: null }, true],
  ];

  it.each(quiet)('reads nothing and answers null when %s', async (_name, phase, takenBack) => {
    expect(await loadStageEndedWarning(phase, takenBack)).toBeNull();
    expect(getStagesBySeasonId).not.toHaveBeenCalled();
    expect(getParticipantsBatch).not.toHaveBeenCalled();
  });
});

describe('loadStageEndedWarning: which players advanced', () => {
  it('lists the block the ended phase contributed to each next phase, in the order it advanced them', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([
      stage('groups', 'Group stage', null),
      stage('playoffs', 'Playoffs', {
        type: 'standings',
        source_phase_id: 'other',
        synced_at: '2026-11-01T00:00:00Z',
        frozen: false,
        contributions: [
          { source_phase_id: 'other', player_ids: ['p9'] },
          { source_phase_id: 'groups', player_ids: ['p2', 'p1'] },
        ],
      }),
    ] as unknown as Stages);
    vi.mocked(getParticipantsBatch).mockResolvedValue(
      roster({ playoffs: [['p1', 'Ash'], ['p2', 'Misty'], ['p9', 'Brock']] })
    );

    const warning = await loadStageEndedWarning(ended, true);

    expect(warning).toEqual({
      phase_id: 'groups',
      phase_name: 'Group stage',
      advanced: [{ phase_id: 'playoffs', phase_name: 'Playoffs', players: [{ id: 'p2', name: 'Misty' }, { id: 'p1', name: 'Ash' }] }],
    });
    expect(getParticipantsBatch).toHaveBeenCalledWith(['playoffs']);
  });

  it('takes a next phase without contribution blocks that names the ended phase as its source whole', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([
      stage('groups', 'Group stage', null),
      stage('finals', 'Finals', { type: 'standings', source_phase_id: 'groups', synced_at: '2026-11-01T00:00:00Z', frozen: true }),
    ] as unknown as Stages);
    vi.mocked(getParticipantsBatch).mockResolvedValue(roster({ finals: [['p1', 'Ash'], ['p2', 'Misty']] }));

    const warning = await loadStageEndedWarning(ended, true);

    expect(warning?.advanced).toEqual([
      { phase_id: 'finals', phase_name: 'Finals', players: [{ id: 'p1', name: 'Ash' }, { id: 'p2', name: 'Misty' }] },
    ]);
  });

  it('leaves out a player who is no longer in the next phase, and a next phase that ends up empty', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([
      stage('groups', 'Group stage', null),
      stage('playoffs', 'Playoffs', {
        type: 'standings', source_phase_id: 'groups', synced_at: 'x', frozen: false,
        contributions: [{ source_phase_id: 'groups', player_ids: ['p1', 'gone'] }],
      }),
      stage('consolation', 'Consolation', {
        type: 'standings', source_phase_id: 'groups', synced_at: 'x', frozen: false,
        contributions: [{ source_phase_id: 'groups', player_ids: ['gone-too'] }],
      }),
    ] as unknown as Stages);
    vi.mocked(getParticipantsBatch).mockResolvedValue(roster({ playoffs: [['p1', 'Ash']], consolation: [] }));

    const warning = await loadStageEndedWarning(ended, true);

    expect(warning?.advanced).toEqual([{ phase_id: 'playoffs', phase_name: 'Playoffs', players: [{ id: 'p1', name: 'Ash' }] }]);
  });

  it('answers an empty list, not null, when no phase took players from it (nobody advanced yet)', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([
      stage('groups', 'Group stage', null),
      stage('playoffs', 'Playoffs', {
        type: 'standings', source_phase_id: 'other', synced_at: 'x', frozen: false,
        contributions: [{ source_phase_id: 'other', player_ids: ['p9'] }],
      }),
      stage('roster-fed', 'Cup', { type: 'roster', source_phase_id: null, synced_at: 'x', frozen: false }),
      stage('manual', 'Manual', null),
    ] as unknown as Stages);

    const warning = await loadStageEndedWarning(ended, true);

    expect(warning).toEqual({ phase_id: 'groups', phase_name: 'Group stage', advanced: [] });
    expect(getParticipantsBatch).not.toHaveBeenCalled();
  });

  it('a failed read is logged and reported as an advancement that could not be read, never as nobody', async () => {
    const failure = new Error('database unavailable');
    vi.mocked(getStagesBySeasonId).mockRejectedValue(failure);

    const warning = await loadStageEndedWarning(ended, true);

    expect(warning).toEqual({ phase_id: 'groups', phase_name: 'Group stage', advanced: null });
    expect(loggerError).toHaveBeenCalledWith(
      'match/stage-ended',
      expect.any(String),
      expect.objectContaining({ phaseId: 'groups', error: failure })
    );
  });
});
