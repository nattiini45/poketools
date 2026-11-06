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
import { makeChallenge } from '@/lib/format-engine/challenge-server';
import { refuse } from '@/lib/format-engine/runtime/refusal';
import { loadParticipantNames } from '@/lib/format-engine/runtime/views-server';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { FormatChallengeError } from '@/lib/supabase/queries/format-challenges';
import { checkRateLimit, RateLimitUnavailableError } from '@/lib/utils/rate-limit';
import type { SessionPlayer } from '@/types/auth';
import { POST } from '../route';

const SEASON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PHASE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const VIEWER = '11111111-1111-4111-8111-111111111111';
const DEFENDER = '22222222-2222-4222-8222-222222222222';
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
  playerId: VIEWER,
  name: 'Mara',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
};

const challengeRow = {
  id: CHALLENGE_ID,
  season_id: SEASON_ID,
  phase_id: PHASE_ID,
  challenger_id: VIEWER,
  defender_id: DEFENDER,
  status: 'open',
  round: 3,
  created_at: '2026-11-05T10:00:00.000Z',
  expires_at: '2026-11-08T10:00:00.000Z',
  responded_at: null,
  match_id: null,
} as never;

const BODY = { phase_id: PHASE_ID, defender_id: DEFENDER };
const params = { params: Promise.resolve({ id: SEASON_ID.toUpperCase() }) };
const post = (body: unknown, raw?: string) =>
  new NextRequest(`http://localhost/api/seasons/${SEASON_ID}/format/challenges`, { method: 'POST', body: raw ?? JSON.stringify(body) });
const ALLOWED = { allowed: true, remaining: 10, retryAfterSeconds: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireSeasonMember).mockResolvedValue({ player, seasonId: SEASON_ID });
  vi.mocked(assertSeasonOpenForPlay).mockResolvedValue(undefined);
  vi.mocked(checkRateLimit).mockResolvedValue(ALLOWED);
  vi.mocked(makeChallenge).mockResolvedValue(challengeRow);
  vi.mocked(loadParticipantNames).mockResolvedValue(
    new Map([
      [VIEWER, 'Mara'],
      [DEFENDER, 'Jonas'],
    ]),
  );
});

describe('POST /api/seasons/[id]/format/challenges', () => {
  it('answers 401 and 403 before reading anything', async () => {
    vi.mocked(requireSeasonMember).mockRejectedValueOnce(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await POST(post(BODY), params)).status).toBe(401);
    vi.mocked(requireSeasonMember).mockRejectedValueOnce(refuse('format_not_participant'));
    expect((await POST(post(BODY), params)).status).toBe(403);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(makeChallenge).not.toHaveBeenCalled();
  });

  it('makes the challenge with the session player as challenger and answers 201 with the view', async () => {
    const response = await POST(post(BODY), params);
    expect(response.status).toBe(201);
    expect(makeChallenge).toHaveBeenCalledWith({ seasonId: SEASON_ID, phaseId: PHASE_ID, challengerId: VIEWER, defenderId: DEFENDER });
    const text = await response.text();
    const data = JSON.parse(text).data.challenge;
    expect(data).toMatchObject({
      id: CHALLENGE_ID,
      phase_id: PHASE_ID,
      challenger: { id: VIEWER, name: 'Mara' },
      defender: { id: DEFENDER, name: 'Jonas' },
      state: 'open',
      lapsed: false,
      round: 3,
      match_id: null,
    });
    // No season id and no raw column names beyond the DTO.
    expect(text).not.toContain('season_id');
    expect(text).not.toContain('"status"');
    expectNoPrivatePlayerData(JSON.parse(text));
  });

  it('takes the challenger from the session only: a body that names one is a 400', async () => {
    const response = await POST(post({ ...BODY, challenger_id: DEFENDER }), params);
    expect(response.status).toBe(400);
    expect(makeChallenge).not.toHaveBeenCalled();
  });

  it('audits the challenge with ids only and expires nothing (a challenge is read live per viewer)', async () => {
    await POST(post(BODY), params);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'season.format.challenge.make',
        actor_id: VIEWER,
        resource_type: 'season',
        resource_id: SEASON_ID,
        metadata: { challenge_id: CHALLENGE_ID, phase_id: PHASE_ID, defender_id: DEFENDER },
      }),
    );
  });

  it('refuses a completed or archived league with 409 format_season_closed', async () => {
    vi.mocked(assertSeasonOpenForPlay).mockRejectedValueOnce(refuse('format_season_closed'));
    const response = await POST(post(BODY), params);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('format_season_closed');
    expect(makeChallenge).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After and writes nothing', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 120 });
    const response = await POST(post(BODY), params);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('120');
    expect(checkRateLimit).toHaveBeenCalledWith(
      'format-challenge-make',
      VIEWER,
      expect.objectContaining({ limit: 20, windowSeconds: 3600, failMode: 'closed' }),
    );
    expect(makeChallenge).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('fails closed when the limiter is unavailable: 503 and no write', async () => {
    vi.mocked(checkRateLimit).mockRejectedValueOnce(new RateLimitUnavailableError());
    const response = await POST(post(BODY), params);
    expect(response.status).toBe(503);
    expect(makeChallenge).not.toHaveBeenCalled();
  });

  it('rejects a malformed body with 400', async () => {
    for (const bad of [{}, { phase_id: PHASE_ID }, { phase_id: 'not-a-uuid', defender_id: DEFENDER }, { phase_id: PHASE_ID, defender_id: 7 }]) {
      const response = await POST(post(bad), params);
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('validation_failed');
    }
    expect(makeChallenge).not.toHaveBeenCalled();
  });

  it('answers 413 for a body over 8 KiB', async () => {
    const response = await POST(post({ ...BODY, padding: 'x'.repeat(9 * 1024) }), params);
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe('format_request_too_large');
  });

  it('maps the database rules to their catalog codes and statuses', async () => {
    const cases: [ConstructorParameters<typeof FormatChallengeError>[0], number][] = [
      ['challenge_self', 400],
      ['challenge_rank_range', 400],
      ['challenge_cooldown', 409],
      ['challenge_max_open', 409],
      ['challenge_already_open', 409],
      ['challenge_no_open_round', 409],
      ['challenge_phase_not_found', 404],
      ['challenge_not_ladder', 409],
    ];
    for (const [code, status] of cases) {
      vi.mocked(makeChallenge).mockRejectedValueOnce(new FormatChallengeError(code));
      const response = await POST(post(BODY), params);
      expect(response.status, code).toBe(status);
      expect((await response.json()).code).toBe(code);
    }
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('hides an unexpected failure behind the static message', async () => {
    vi.mocked(makeChallenge).mockRejectedValueOnce(new Error('could not obtain lock on row'));
    const response = await POST(post(BODY), params);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Failed to make the challenge');
    expect(JSON.stringify(body)).not.toContain('lock');
  });
});
