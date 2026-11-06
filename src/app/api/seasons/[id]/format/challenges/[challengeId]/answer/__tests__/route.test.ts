import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/season-member', () => ({ requireSeasonMember: vi.fn(), assertSeasonOpenForPlay: vi.fn() }));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/format-engine/challenge-server', () => ({ makeChallenge: vi.fn(), answerChallenge: vi.fn(), withdrawChallenge: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/views-server', () => ({ loadParticipantNames: vi.fn() }));

import { logAuditEvent } from '@/lib/audit/log';
import { assertSeasonOpenForPlay, requireSeasonMember } from '@/lib/auth/season-member';
import { answerChallenge } from '@/lib/format-engine/challenge-server';
import { refuse } from '@/lib/format-engine/runtime/refusal';
import { loadParticipantNames } from '@/lib/format-engine/runtime/views-server';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { FormatChallengeError } from '@/lib/supabase/queries/format-challenges';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { SessionPlayer } from '@/types/auth';
import { POST } from '../route';

const SEASON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PHASE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const MATCH_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const DEFENDER = '11111111-1111-4111-8111-111111111111';
const CHALLENGER = '22222222-2222-4222-8222-222222222222';
const CHALLENGE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
  ) {
    super(message);
  }
}

const player: SessionPlayer = {
  playerId: DEFENDER,
  name: 'Jonas',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
};

const row = (over: Record<string, unknown> = {}) =>
  ({
    id: CHALLENGE_ID,
    season_id: SEASON_ID,
    phase_id: PHASE_ID,
    challenger_id: CHALLENGER,
    defender_id: DEFENDER,
    status: 'accepted',
    round: 3,
    created_at: '2026-11-05T10:00:00.000Z',
    expires_at: '2026-11-08T10:00:00.000Z',
    responded_at: '2026-11-05T11:00:00.000Z',
    match_id: MATCH_ID,
    ...over,
  }) as never;

const params = (challengeId = CHALLENGE_ID) => ({ params: Promise.resolve({ id: SEASON_ID.toUpperCase(), challengeId }) });
const post = (body: unknown, raw?: string) =>
  new NextRequest(`http://localhost/api/seasons/${SEASON_ID}/format/challenges/${CHALLENGE_ID}/answer`, {
    method: 'POST',
    body: raw ?? JSON.stringify(body),
  });
const ALLOWED = { allowed: true, remaining: 10, retryAfterSeconds: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireSeasonMember).mockResolvedValue({ player, seasonId: SEASON_ID });
  vi.mocked(assertSeasonOpenForPlay).mockResolvedValue(undefined);
  vi.mocked(checkRateLimit).mockResolvedValue(ALLOWED);
  vi.mocked(answerChallenge).mockResolvedValue(row());
  vi.mocked(loadParticipantNames).mockResolvedValue(
    new Map([
      [DEFENDER, 'Jonas'],
      [CHALLENGER, 'Mara'],
    ]),
  );
});

describe('POST /api/seasons/[id]/format/challenges/[challengeId]/answer', () => {
  it('answers 401 and 403 before reading anything', async () => {
    vi.mocked(requireSeasonMember).mockRejectedValueOnce(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await POST(post({ accept: true }), params())).status).toBe(401);
    vi.mocked(requireSeasonMember).mockRejectedValueOnce(refuse('format_not_participant'));
    expect((await POST(post({ accept: true }), params())).status).toBe(403);
    expect(answerChallenge).not.toHaveBeenCalled();
  });

  it('answers 404 INVALID_CHALLENGE_ID for a malformed id, before any read', async () => {
    const response = await POST(post({ accept: true }), params('not-a-uuid'));
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('INVALID_CHALLENGE_ID');
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(answerChallenge).not.toHaveBeenCalled();
  });

  it('accepts as the session player in the league of the URL and answers the view with the match', async () => {
    const response = await POST(post({ accept: true }), params(CHALLENGE_ID.toUpperCase()));
    expect(response.status).toBe(200);
    expect(answerChallenge).toHaveBeenCalledWith({ seasonId: SEASON_ID, challengeId: CHALLENGE_ID, playerId: DEFENDER, accept: true });
    const text = await response.text();
    expect(JSON.parse(text).data.challenge).toMatchObject({ id: CHALLENGE_ID, state: 'accepted', match_id: MATCH_ID });
    expectNoPrivatePlayerData(JSON.parse(text));
  });

  it('declines, and audits both answers with ids only', async () => {
    vi.mocked(answerChallenge).mockResolvedValueOnce(row({ status: 'declined', match_id: null }));
    const declined = await POST(post({ accept: false }), params());
    expect((await declined.json()).data.challenge.state).toBe('declined');
    expect(answerChallenge).toHaveBeenLastCalledWith(expect.objectContaining({ accept: false }));
    expect(logAuditEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'season.format.challenge.answer',
        actor_id: DEFENDER,
        resource_id: SEASON_ID,
        metadata: { challenge_id: CHALLENGE_ID, phase_id: PHASE_ID, accept: false, match_id: null },
      }),
    );

    await POST(post({ accept: true }), params());
    expect(logAuditEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ metadata: { challenge_id: CHALLENGE_ID, phase_id: PHASE_ID, accept: true, match_id: MATCH_ID } }),
    );
  });

  it('refuses a completed or archived league with 409 format_season_closed', async () => {
    vi.mocked(assertSeasonOpenForPlay).mockRejectedValueOnce(refuse('format_season_closed'));
    const response = await POST(post({ accept: true }), params());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('format_season_closed');
    expect(answerChallenge).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After and writes nothing', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 61 });
    const response = await POST(post({ accept: true }), params());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('61');
    expect(checkRateLimit).toHaveBeenCalledWith('format-challenge-write', DEFENDER, expect.objectContaining({ limit: 60, windowSeconds: 3600 }));
    expect(answerChallenge).not.toHaveBeenCalled();
  });

  it('rejects a malformed body and an extra member with 400', async () => {
    for (const bad of [{}, { accept: 'yes' }, { accept: true, player_id: CHALLENGER }]) {
      const response = await POST(post(bad), params());
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('validation_failed');
    }
    expect(answerChallenge).not.toHaveBeenCalled();
  });

  it('maps the database rules: another league 404, not the defender 403, expired and not open 409', async () => {
    const cases: [ConstructorParameters<typeof FormatChallengeError>[0], number][] = [
      ['challenge_not_found', 404],
      ['challenge_not_defender', 403],
      ['challenge_expired', 409],
      ['challenge_not_open', 409],
    ];
    for (const [code, status] of cases) {
      vi.mocked(answerChallenge).mockRejectedValueOnce(new FormatChallengeError(code));
      const response = await POST(post({ accept: true }), params());
      expect(response.status, code).toBe(status);
      expect((await response.json()).code).toBe(code);
    }
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('hides an unexpected failure behind the static message', async () => {
    vi.mocked(answerChallenge).mockRejectedValueOnce(new Error('insert into matches failed: constraint x'));
    const response = await POST(post({ accept: true }), params());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Failed to answer the challenge');
    expect(JSON.stringify(body)).not.toContain('constraint');
  });
});
