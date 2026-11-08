import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    code?: string;
    constructor(message: string, statusCode: number, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));
vi.mock('@/lib/format-engine/notifications/server', () => ({ loadInboxPage: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-notifications', () => ({
  countUnreadFormatNotifications: vi.fn(),
  markFormatNotificationsRead: vi.fn(),
}));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { AuthError, requirePlayer } from '@/lib/auth/helpers';
import { loadInboxPage } from '@/lib/format-engine/notifications/server';
import { countUnreadFormatNotifications, markFormatNotificationsRead } from '@/lib/supabase/queries/format-notifications';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { GET as listGet } from '../route';
import { POST as readPost } from '../read/route';
import { GET as unreadGet } from '../unread-count/route';

const ME = 'b3f3a1c2-0d5e-4a6b-8c7d-1234567890ab';
const OTHER_ROW = '7a1f2e3d-4c5b-4a69-9786-abcdefabcdef';

const list = (query = '') => new NextRequest(`http://localhost/api/notifications${query}`);
const post = (body: unknown) =>
  new NextRequest('http://localhost/api/notifications/read', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue({ playerId: ME, name: 'Me' } as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(countUnreadFormatNotifications).mockResolvedValue(1);
  vi.mocked(loadInboxPage).mockResolvedValue({ items: [], unread: 1, has_more: false });
});

describe('GET /api/notifications', () => {
  it('answers 401 without a player and reads nothing', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Not signed in', 401, 'unauthenticated'));
    const response = await listGet(list());
    expect(response.status).toBe(401);
    expect(loadInboxPage).not.toHaveBeenCalled();
  });

  it('reads the guard\'s player, whatever the query says, and is never cached', async () => {
    const response = await listGet(list('?player_id=someone-else&offset=30'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(loadInboxPage).toHaveBeenCalledWith(ME, 30, 30);
  });

  it('caps the page size', async () => {
    await listGet(list('?limit=5000'));
    expect(loadInboxPage).toHaveBeenCalledWith(ME, 30, 0);
  });

  it('carries no private player data', async () => {
    vi.mocked(loadInboxPage).mockResolvedValue({
      items: [{
        id: 'n', kind: 'challenge_created', created_at: 'x', read: false, league: { id: 's', name: 'L' }, href: '/x', side: 'defender',
        counterparty: { id: 'p', name: 'Ada' },
      }],
      unread: 1,
      has_more: false,
    });
    const response = await listGet(list());
    expectNoPrivatePlayerData(await response.text());
  });

  it('answers a failed read with a safe 500', async () => {
    vi.mocked(loadInboxPage).mockRejectedValue(new Error('secret detail'));
    const response = await listGet(list());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret detail');
  });
});

describe('GET /api/notifications/unread-count', () => {
  it('counts for the guard\'s player', async () => {
    const response = await unreadGet();
    expect(await response.json()).toEqual({ success: true, data: { unread: 1 } });
    expect(countUnreadFormatNotifications).toHaveBeenCalledWith(ME);
  });

  it('answers 401 without a player', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Not signed in', 401, 'unauthenticated'));
    expect((await unreadGet()).status).toBe(401);
  });
});

describe('POST /api/notifications/read', () => {
  it('marks the named rows of the guard\'s player and answers the new count', async () => {
    const response = await readPost(post({ ids: [OTHER_ROW.toUpperCase()] }));
    expect(response.status).toBe(200);
    expect(markFormatNotificationsRead).toHaveBeenCalledWith(ME, [OTHER_ROW]);
    expect(await response.json()).toEqual({ success: true, data: { unread: 1 } });
  });

  it('marks everything on { all: true }', async () => {
    await readPost(post({ all: true }));
    expect(markFormatNotificationsRead).toHaveBeenCalledWith(ME, 'all');
  });

  it.each([
    ['no selection', {}],
    ['an empty list', { ids: [] }],
    ['a malformed id', { ids: ['nope'] }],
    ['too many ids', { ids: Array.from({ length: 101 }, () => OTHER_ROW) }],
    ['all: false', { all: false }],
    ['both forms', { ids: [OTHER_ROW], all: true }],
    ['a player id', { all: true, player_id: OTHER_ROW }],
  ])('refuses %s', async (_label, body) => {
    const response = await readPost(post(body));
    expect(response.status).toBe(400);
    expect(markFormatNotificationsRead).not.toHaveBeenCalled();
  });

  it('answers 429 over the limit and writes nothing', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 9 } as never);
    expect((await readPost(post({ all: true }))).status).toBe(429);
    expect(markFormatNotificationsRead).not.toHaveBeenCalled();
  });

  it('answers 401 without a player', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Not signed in', 401, 'unauthenticated'));
    expect((await readPost(post({ all: true }))).status).toBe(401);
  });
});
