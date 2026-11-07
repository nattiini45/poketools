import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/season-member', () => ({ requireSeasonMember: vi.fn(), assertSeasonOpenForPlay: vi.fn() }));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/format-engine/runtime/views-server', () => ({ loadPlayerView: vi.fn() }));

import { assertSeasonOpenForPlay, requireSeasonMember } from '@/lib/auth/season-member';
import { refuse } from '@/lib/format-engine/runtime/refusal';
import { loadPlayerView } from '@/lib/format-engine/runtime/views-server';
import type { PlayerFormatView } from '@/lib/format-engine/runtime/view-types';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { SessionPlayer } from '@/types/auth';
import { GET } from '../route';

const SEASON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VIEWER = '11111111-1111-4111-8111-111111111111';
const HIDDEN_GIVER = '99999999-9999-4999-8999-999999999999';

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

const view: PlayerFormatView = {
  running: true,
  actions: [],
  domains: [],
  pools: [],
  items: [],
  relations: [
    {
      key: 'santa',
      label: 'Secret Santa' as never,
      shape: 'derangement',
      links: [{ from: null, to: { id: VIEWER, name: 'Mara' }, revealed: false }],
    },
  ],
  ladders: [],
};

const params = { params: Promise.resolve({ id: SEASON_ID.toUpperCase() }) };
const get = () => new NextRequest(`http://localhost/api/seasons/${SEASON_ID}/format/me`);
const ALLOWED = { allowed: true, remaining: 10, retryAfterSeconds: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireSeasonMember).mockResolvedValue({ player, seasonId: SEASON_ID });
  vi.mocked(checkRateLimit).mockResolvedValue(ALLOWED);
  vi.mocked(loadPlayerView).mockResolvedValue(view);
});

describe('GET /api/seasons/[id]/format/me', () => {
  it('answers 401 and 403 before reading anything', async () => {
    vi.mocked(requireSeasonMember).mockRejectedValueOnce(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await GET(get(), params)).status).toBe(401);
    vi.mocked(requireSeasonMember).mockRejectedValueOnce(refuse('format_not_participant'));
    const notMember = await GET(get(), params);
    expect(notMember.status).toBe(403);
    expect((await notMember.json()).code).toBe('format_not_participant');
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(loadPlayerView).not.toHaveBeenCalled();
  });

  it('passes the raw path id to the guard and loads the view of the session player for the normalised league', async () => {
    const response = await GET(get(), params);
    expect(response.status).toBe(200);
    expect(requireSeasonMember).toHaveBeenCalledWith(SEASON_ID.toUpperCase());
    expect(loadPlayerView).toHaveBeenCalledWith(SEASON_ID, VIEWER);
    expect((await response.json()).data).toEqual(view);
  });

  it('is never cached: the answer is per viewer', async () => {
    const response = await GET(get(), params);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('answers { running: false } for a league without a kit format', async () => {
    vi.mocked(loadPlayerView).mockResolvedValue({ running: false });
    const response = await GET(get(), params);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ running: false });
  });

  it('is readable in a completed or archived league: it does not apply the write gate', async () => {
    const response = await GET(get(), params);
    expect(response.status).toBe(200);
    expect(assertSeasonOpenForPlay).not.toHaveBeenCalled();
  });

  it('counts a per-player and a per-league bucket and answers 429 with Retry-After before loading anything', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 17 });
    const player429 = await GET(get(), params);
    expect(player429.status).toBe(429);
    expect(player429.headers.get('Retry-After')).toBe('17');
    expect(vi.mocked(checkRateLimit).mock.calls[0]).toEqual([
      'format-runtime-read',
      VIEWER,
      expect.objectContaining({ limit: 30, windowSeconds: 60 }),
    ]);

    vi.mocked(checkRateLimit).mockResolvedValueOnce(ALLOWED).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 5 });
    const league429 = await GET(get(), params);
    expect(league429.status).toBe(429);
    expect(league429.headers.get('Retry-After')).toBe('5');
    expect(vi.mocked(checkRateLimit).mock.calls[2]).toEqual([
      'format-runtime-read-league',
      SEASON_ID,
      expect.objectContaining({ limit: 300, windowSeconds: 60 }),
    ]);
    expect(loadPlayerView).not.toHaveBeenCalled();
  });

  it('serialises exactly the view: no private player data, no source or target columns, no hidden giver', async () => {
    const response = await GET(get(), params);
    const text = await response.text();
    const body = JSON.parse(text) as unknown;
    expectNoPrivatePlayerData(body);
    expect(text).not.toContain('target_player_id');
    expect(text).not.toContain('source_ref');
    expect(text).not.toContain(HIDDEN_GIVER);
  });

  it('hides an unexpected failure behind the static message', async () => {
    vi.mocked(loadPlayerView).mockRejectedValue(new Error('relation "format_events" does not exist'));
    const response = await GET(get(), params);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Failed to load the live format');
    expect(JSON.stringify(body)).not.toContain('format_events');
  });
});
