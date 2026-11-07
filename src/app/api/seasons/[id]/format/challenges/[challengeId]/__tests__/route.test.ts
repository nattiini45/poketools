import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public code?: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/auth/season-member', () => ({ requireSeasonMember: vi.fn(), assertSeasonOpenForPlay: vi.fn() }));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/format-engine/challenge-server', () => ({ makeChallenge: vi.fn(), answerChallenge: vi.fn(), withdrawChallenge: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/views-server', () => ({ loadParticipantNames: vi.fn() }));

import { logAuditEvent } from '@/lib/audit/log';
import { AuthError, requireResourceAdmin } from '@/lib/auth/helpers';
import { assertSeasonOpenForPlay, requireSeasonMember } from '@/lib/auth/season-member';
import { withdrawChallenge } from '@/lib/format-engine/challenge-server';
import { refuse } from '@/lib/format-engine/runtime/refusal';
import { loadParticipantNames } from '@/lib/format-engine/runtime/views-server';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { FormatChallengeError } from '@/lib/supabase/queries/format-challenges';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { SessionPlayer } from '@/types/auth';
import { DELETE } from '../route';

const SEASON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PHASE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const CHALLENGER = '11111111-1111-4111-8111-111111111111';
const DEFENDER = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const CHALLENGE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const sessionPlayer = (playerId: string, name: string): SessionPlayer => ({
  playerId,
  name,
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
});

const challenger = sessionPlayer(CHALLENGER, 'Mara');
const admin = sessionPlayer(ADMIN_ID, 'League Admin');

const cancelled = {
  id: CHALLENGE_ID,
  season_id: SEASON_ID,
  phase_id: PHASE_ID,
  challenger_id: CHALLENGER,
  defender_id: DEFENDER,
  status: 'cancelled',
  round: 3,
  created_at: '2026-11-05T10:00:00.000Z',
  expires_at: '2026-11-08T10:00:00.000Z',
  responded_at: '2026-11-05T11:00:00.000Z',
  match_id: null,
} as never;

const params = (challengeId = CHALLENGE_ID) => ({ params: Promise.resolve({ id: SEASON_ID.toUpperCase(), challengeId }) });
const del = (query = '') =>
  new NextRequest(`http://localhost/api/seasons/${SEASON_ID}/format/challenges/${CHALLENGE_ID}${query}`, { method: 'DELETE' });
const ALLOWED = { allowed: true, remaining: 10, retryAfterSeconds: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireSeasonMember).mockResolvedValue({ player: challenger, seasonId: SEASON_ID });
  vi.mocked(requireResourceAdmin).mockResolvedValue(admin);
  vi.mocked(assertSeasonOpenForPlay).mockResolvedValue(undefined);
  vi.mocked(checkRateLimit).mockResolvedValue(ALLOWED);
  vi.mocked(withdrawChallenge).mockResolvedValue(cancelled);
  vi.mocked(loadParticipantNames).mockResolvedValue(
    new Map([
      [CHALLENGER, 'Mara'],
      [DEFENDER, 'Jonas'],
    ]),
  );
});

describe('DELETE /api/seasons/[id]/format/challenges/[challengeId]', () => {
  it('as=self (the default) withdraws as the session player, who must take part in the league', async () => {
    const response = await DELETE(del(), params(CHALLENGE_ID.toUpperCase()));
    expect(response.status).toBe(200);
    expect(requireSeasonMember).toHaveBeenCalledWith(SEASON_ID.toUpperCase());
    expect(requireResourceAdmin).not.toHaveBeenCalled();
    expect(assertSeasonOpenForPlay).toHaveBeenCalledWith(SEASON_ID);
    expect(withdrawChallenge).toHaveBeenCalledWith(SEASON_ID, CHALLENGE_ID, CHALLENGER);
    const text = await response.text();
    expect(JSON.parse(text).data.challenge).toMatchObject({ id: CHALLENGE_ID, state: 'cancelled', challenger: { id: CHALLENGER, name: 'Mara' } });
    expectNoPrivatePlayerData(JSON.parse(text));
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'season.format.challenge.withdraw',
        actor_id: CHALLENGER,
        resource_id: SEASON_ID,
        metadata: { challenge_id: CHALLENGE_ID, by: 'challenger', challenger_id: CHALLENGER },
      }),
    );
  });

  it('still answers 200 once the withdrawal is committed when the name read fails (names are best effort)', async () => {
    vi.mocked(loadParticipantNames).mockRejectedValueOnce(new Error('names read failed'));
    const response = await DELETE(del(), params());
    expect(response.status).toBe(200);
    expect(withdrawChallenge).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect((await response.json()).data.challenge).toMatchObject({
      id: CHALLENGE_ID,
      challenger: { id: CHALLENGER, name: null },
      defender: { id: DEFENDER, name: null },
    });
  });

  it('as=admin uses the league-admin guard, withdraws for the challenger and works in a closed league', async () => {
    vi.mocked(assertSeasonOpenForPlay).mockRejectedValue(refuse('format_season_closed'));
    const response = await DELETE(del('?as=admin'), params());
    expect(response.status).toBe(200);
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', SEASON_ID.toUpperCase());
    expect(requireSeasonMember).not.toHaveBeenCalled();
    expect(assertSeasonOpenForPlay).not.toHaveBeenCalled();
    expect(withdrawChallenge).toHaveBeenCalledWith(SEASON_ID, CHALLENGE_ID, null);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: ADMIN_ID,
        actor_name: 'League Admin',
        metadata: { challenge_id: CHALLENGE_ID, by: 'admin', challenger_id: CHALLENGER },
      }),
    );
  });

  it('as=admin by a plain member is a 403 and withdraws nothing', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValueOnce(new AuthError('Admin access required', 403, 'forbidden'));
    const response = await DELETE(del('?as=admin'), params());
    expect(response.status).toBe(403);
    expect(withdrawChallenge).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it('answers 401 for an anonymous caller on both guards', async () => {
    vi.mocked(requireSeasonMember).mockRejectedValueOnce(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await DELETE(del(), params())).status).toBe(401);
    vi.mocked(requireResourceAdmin).mockRejectedValueOnce(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await DELETE(del('?as=admin'), params())).status).toBe(401);
    expect(withdrawChallenge).not.toHaveBeenCalled();
  });

  it('as=self by a non-participant is a 403 format_not_participant', async () => {
    vi.mocked(requireSeasonMember).mockRejectedValueOnce(refuse('format_not_participant'));
    const response = await DELETE(del(), params());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('format_not_participant');
    expect(withdrawChallenge).not.toHaveBeenCalled();
  });

  it('rejects an unknown as value with 400 before any guard', async () => {
    const response = await DELETE(del('?as=root'), params());
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('validation_failed');
    expect(requireSeasonMember).not.toHaveBeenCalled();
    expect(requireResourceAdmin).not.toHaveBeenCalled();
  });

  it('answers 404 INVALID_CHALLENGE_ID for a malformed id, before the limiter', async () => {
    const response = await DELETE(del(), params('nope'));
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('INVALID_CHALLENGE_ID');
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(withdrawChallenge).not.toHaveBeenCalled();
  });

  it('as=self is refused in a completed or archived league with 409 format_season_closed', async () => {
    vi.mocked(assertSeasonOpenForPlay).mockRejectedValueOnce(refuse('format_season_closed'));
    const response = await DELETE(del(), params());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('format_season_closed');
    expect(withdrawChallenge).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After and writes nothing', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 33 });
    const response = await DELETE(del(), params());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('33');
    expect(checkRateLimit).toHaveBeenCalledWith('format-challenge-write', CHALLENGER, expect.objectContaining({ limit: 60, windowSeconds: 3600 }));
    expect(withdrawChallenge).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('maps the database rules: another league 404 (also for an admin), not the challenger 403, not open 409', async () => {
    const cases: [string, ConstructorParameters<typeof FormatChallengeError>[0], number][] = [
      ['', 'challenge_not_found', 404],
      ['?as=admin', 'challenge_not_found', 404],
      ['', 'challenge_not_challenger', 403],
      ['', 'challenge_not_open', 409],
    ];
    for (const [query, code, status] of cases) {
      vi.mocked(withdrawChallenge).mockRejectedValueOnce(new FormatChallengeError(code));
      const response = await DELETE(del(query), params());
      expect(response.status, `${query} ${code}`).toBe(status);
      expect((await response.json()).code).toBe(code);
    }
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('hides an unexpected failure behind the static message', async () => {
    vi.mocked(withdrawChallenge).mockRejectedValueOnce(new Error('canceling statement due to statement timeout'));
    const response = await DELETE(del(), params());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Failed to withdraw the challenge');
    expect(JSON.stringify(body)).not.toContain('timeout');
  });
});
