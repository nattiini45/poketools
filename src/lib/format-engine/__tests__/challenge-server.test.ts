/**
 * The challenge ladder's server module: what it reads before a challenge (the stage's `challenge` settings and the
 * players' places in the stage table), the errors it raises, and the public reads it expires after an accepted challenge
 * created a match. The database's own rules live in format_challenge_* (format-challenges.local.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/revalidation', () => ({ expireTournamentReads: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/load', () => ({ loadFreshKitContext: vi.fn(), phaseById: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/stage-table', () => ({ loadStageTable: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-challenges', () => {
  class FormatChallengeError extends Error {
    readonly code: string;
    readonly statusCode = 409;
    constructor(code: string) {
      super(code);
      this.name = 'FormatChallengeError';
      this.code = code;
    }
  }
  return {
    FormatChallengeError,
    createFormatChallenge: vi.fn(),
    respondToFormatChallenge: vi.fn(),
    cancelFormatChallenge: vi.fn(),
    expireFormatChallenges: vi.fn(),
  };
});

import { expireTournamentReads } from '@/lib/revalidation';
import { loadFreshKitContext, phaseById } from '@/lib/format-engine/runtime/load';
import { loadStageTable } from '@/lib/format-engine/runtime/stage-table';
import {
  FormatChallengeError,
  cancelFormatChallenge,
  createFormatChallenge,
  expireFormatChallenges,
  respondToFormatChallenge,
} from '@/lib/supabase/queries/format-challenges';
import { answerChallenge, expireChallenges, makeChallenge, withdrawChallenge } from '../challenge-server';

const SEASON = 'season-1';
const PHASE = 'phase-1';
const P1 = 'p1';
const P2 = 'p2';

const ladder = { kind: 'challenge', rounds: 8, rank_range: 3, max_open: 2, cooldown_rounds: 1, accept_window_hours: 72 } as const;

const challengeRow = (over: Record<string, unknown> = {}) => ({
  id: 'c-1',
  season_id: SEASON,
  phase_id: PHASE,
  challenger_id: P2,
  defender_id: P1,
  status: 'open',
  round: 2,
  match_id: null,
  ...over,
});

const phase = (pairing: unknown) => ({ id: PHASE, stage: { key: 'main', pairing }, members: [P1, P2] });

const table = [
  { player_id: P1, rank: 1 },
  { player_id: P2, rank: 2 },
];

const input = (over: Partial<Parameters<typeof makeChallenge>[0]> = {}) => ({
  seasonId: SEASON,
  phaseId: PHASE,
  challengerId: P2,
  defenderId: P1,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadFreshKitContext).mockResolvedValue({ phases: [] } as never);
  vi.mocked(phaseById).mockReturnValue(phase(ladder) as never);
  vi.mocked(loadStageTable).mockResolvedValue(table as never);
  vi.mocked(createFormatChallenge).mockResolvedValue(challengeRow() as never);
  vi.mocked(respondToFormatChallenge).mockResolvedValue(challengeRow({ status: 'accepted', match_id: 'm-1' }) as never);
  vi.mocked(cancelFormatChallenge).mockResolvedValue(challengeRow({ status: 'cancelled' }) as never);
  vi.mocked(expireFormatChallenges).mockResolvedValue(2);
});

describe('makeChallenge', () => {
  it('makes the challenge with the stage settings and the players’ places in the stage table', async () => {
    const result = await makeChallenge(input());

    expect(result).toMatchObject({ status: 'open' });
    expect(createFormatChallenge).toHaveBeenCalledWith({
      seasonId: SEASON,
      phaseId: PHASE,
      challengerId: P2,
      defenderId: P1,
      challengerRank: 2,
      defenderRank: 1,
      rankRange: 3,
      maxOpen: 2,
      cooldownRounds: 1,
      acceptWindowHours: 72,
    });
  });

  it('refuses a league that does not run a kit format, without reading a table', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);

    await expect(makeChallenge(input())).rejects.toMatchObject({ code: 'challenge_not_ladder' });
    expect(loadStageTable).not.toHaveBeenCalled();
    expect(createFormatChallenge).not.toHaveBeenCalled();
  });

  it('refuses an unknown phase and a phase that is not a challenge ladder', async () => {
    vi.mocked(phaseById).mockReturnValue(undefined);
    await expect(makeChallenge(input())).rejects.toBeInstanceOf(FormatChallengeError);
    await expect(makeChallenge(input())).rejects.toMatchObject({ code: 'challenge_phase_not_found' });
    expect(createFormatChallenge).not.toHaveBeenCalled();

    vi.mocked(phaseById).mockReturnValue(phase({ kind: 'swiss', rounds: 3, avoid_repeats: true }) as never);
    await expect(makeChallenge(input())).rejects.toMatchObject({ code: 'challenge_not_ladder' });
    expect(loadStageTable).not.toHaveBeenCalled();
  });

  it('refuses a player who is not in the stage table (or a phase without one)', async () => {
    await expect(makeChallenge(input({ challengerId: 'p9' }))).rejects.toMatchObject({ code: 'challenge_not_participant' });
    vi.mocked(loadStageTable).mockResolvedValue(null);
    await expect(makeChallenge(input())).rejects.toMatchObject({ code: 'challenge_not_participant' });
    expect(createFormatChallenge).not.toHaveBeenCalled();
  });

  it('lets a refusal of the database function through unchanged', async () => {
    vi.mocked(createFormatChallenge).mockRejectedValue(new FormatChallengeError('challenge_rank_range'));

    await expect(makeChallenge(input())).rejects.toMatchObject({ code: 'challenge_rank_range' });
  });
});

describe('answerChallenge', () => {
  it('expires the phase’s public reads when the defender accepts (a match was created)', async () => {
    const row = await answerChallenge({ seasonId: SEASON, challengeId: 'c-1', playerId: P1, accept: true });

    expect(respondToFormatChallenge).toHaveBeenCalledWith({ seasonId: SEASON, challengeId: 'c-1', playerId: P1, accept: true });
    expect(row).toMatchObject({ status: 'accepted' });
    expect(expireTournamentReads).toHaveBeenCalledTimes(1);
    expect(expireTournamentReads).toHaveBeenCalledWith(PHASE, SEASON);
  });

  it('expires nothing when the defender declines', async () => {
    vi.mocked(respondToFormatChallenge).mockResolvedValue(challengeRow({ status: 'declined', responded_at: 't' }) as never);

    await expect(answerChallenge({ seasonId: SEASON, challengeId: 'c-1', playerId: P1, accept: false })).resolves.toMatchObject({ status: 'declined' });
    expect(expireTournamentReads).not.toHaveBeenCalled();
  });

  it('passes the league to the database, so a challenge of another league is challenge_not_found', async () => {
    vi.mocked(respondToFormatChallenge).mockRejectedValue(new FormatChallengeError('challenge_not_found'));

    await expect(answerChallenge({ seasonId: 'season-2', challengeId: 'c-1', playerId: P1, accept: true })).rejects.toMatchObject({
      code: 'challenge_not_found',
    });
    expect(respondToFormatChallenge).toHaveBeenCalledWith(expect.objectContaining({ seasonId: 'season-2' }));
    expect(expireTournamentReads).not.toHaveBeenCalled();
  });

  it('expires nothing when the response is refused (a late answer is challenge_expired)', async () => {
    vi.mocked(respondToFormatChallenge).mockRejectedValue(new FormatChallengeError('challenge_expired'));

    await expect(answerChallenge({ seasonId: SEASON, challengeId: 'c-1', playerId: P1, accept: true })).rejects.toMatchObject({ code: 'challenge_expired' });
    expect(expireTournamentReads).not.toHaveBeenCalled();
  });
});

describe('withdrawChallenge and expireChallenges', () => {
  it('passes a NULL player for an admin withdrawal', async () => {
    await withdrawChallenge(SEASON, 'c-1', null);
    expect(cancelFormatChallenge).toHaveBeenCalledWith(SEASON, 'c-1', null);
  });

  it('passes the league and the withdrawing player to the database', async () => {
    await withdrawChallenge(SEASON, 'c-1', P2);
    expect(cancelFormatChallenge).toHaveBeenCalledWith(SEASON, 'c-1', P2);
  });

  it('expires every lapsed challenge of all leagues by default, or of one league', async () => {
    await expect(expireChallenges()).resolves.toBe(2);
    expect(expireFormatChallenges).toHaveBeenCalledWith(null);
    await expect(expireChallenges(SEASON)).resolves.toBe(2);
    expect(expireFormatChallenges).toHaveBeenCalledWith(SEASON);
  });
});
