/**
 * A real route (`GET /api/seasons/me`) behind the REAL `requirePlayer` guard, dispatched through `invokeRoute`. The
 * cookie side (`auth()`) answers nobody, so the only way the guard can see the admin is the verified-session override:
 * this proves dispatch authenticates the route as the recorded session, and that a revocation is still honoured
 * because the guard re-reads the player (`loadSessionPlayer`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';

// The react-server build, so cache() really memoises per render (same stand-in as helpers.test.ts).
vi.mock('react', async () => {
  const { createRequire } = await import('node:module');
  const path = await import('node:path');
  const nodeRequire = createRequire(import.meta.url);
  const reactDir = path.dirname(nodeRequire.resolve('react/package.json'));
  return nodeRequire(path.join(reactDir, 'cjs', 'react.react-server.development.js'));
});
vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-definitions', () => ({ getFormatDefinitionMeta: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonsByPlayer: vi.fn() }));

import { auth, loadSessionPlayer } from '@/auth';
import { authAndRecord } from '@/lib/auth/session-override';
import { getSeasonsByPlayer } from '@/lib/supabase/queries/seasons';
import type { SessionPlayer } from '@/types/auth';
import { invokeRoute } from '../invoke';
import type { DispatchContext, RouteBinding } from '../types';

const ME = '11111111-1111-4111-8111-111111111111';

const livePlayer = (overrides: Partial<SessionPlayer> = {}): SessionPlayer => ({
  playerId: ME, name: 'Admin', isAdmin: true, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active', ...overrides,
});

const leagueList: RouteBinding = {
  operation: 'my_leagues',
  method: 'GET',
  path: '/api/seasons/me',
  class: 'R',
  load: () => import('@/app/api/seasons/me/route'),
};

async function context(): Promise<DispatchContext> {
  const session: Session = {
    user: { id: ME, name: 'Admin', email: 'admin@example.com', image: null },
    provider: 'discord',
    player: null,
    expires: '2099-01-01T00:00:00.000Z',
  };
  // The request's own auth() call returns the session once; the cookie side answers nobody afterwards.
  vi.mocked(auth).mockResolvedValueOnce(session as never).mockResolvedValue(null as never);
  const recorded = await authAndRecord();
  if (recorded === null) throw new Error('expected a session');
  return {
    session: recorded,
    inbound: new Request('https://example.com/api/admin/agent/conversations/c/messages'),
    audit: { agent_conversation_id: 'c1', agent_proposal_id: 'p1', agent_step: 'list', approved_by: ME },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('invokeRoute behind the real requirePlayer guard', () => {
  it('authenticates the route as the recorded session although the cookie holds nobody', async () => {
    vi.mocked(loadSessionPlayer).mockResolvedValue(livePlayer());
    vi.mocked(getSeasonsByPlayer).mockResolvedValue([{ id: 's1' }] as never);

    const outcome = await invokeRoute(leagueList, {}, await context());

    expect(outcome).toMatchObject({ kind: 'ok', httpStatus: 200, data: [{ id: 's1' }] });
    expect(loadSessionPlayer).toHaveBeenCalledWith('discord', ME);
    expect(getSeasonsByPlayer).toHaveBeenCalledWith(ME);
  });

  it('honours a revocation: a player banned since the session was issued is refused by the guard, live', async () => {
    vi.mocked(loadSessionPlayer).mockResolvedValue(livePlayer({ isAdmin: false, status: 'banned' }));

    const outcome = await invokeRoute(leagueList, {}, await context());

    expect(outcome.kind).toBe('forbidden');
    expect(getSeasonsByPlayer).not.toHaveBeenCalled();
  });

  it('refuses when the identity has no player any more', async () => {
    vi.mocked(loadSessionPlayer).mockResolvedValue(null);

    const outcome = await invokeRoute(leagueList, {}, await context());

    expect(outcome.kind).not.toBe('ok');
    expect(getSeasonsByPlayer).not.toHaveBeenCalled();
  });
});
