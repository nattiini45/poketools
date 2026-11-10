/**
 * Confirm page: which of confirm / dispute the viewer is offered (match machine, docs/state-machines.md). The page
 * runs for real with its reads mocked; the client is stubbed to record the props it receives.
 */
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({
  player: null as unknown,
  match: null as unknown,
  clientProps: [] as Record<string, unknown>[],
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@/components/shared/AuthGuard', () => ({
  default: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
}));
vi.mock('@/components/match/MatchStatusBadge', () => ({
  default: ({ status }: { status: string }) => createElement('span', null, status),
}));
vi.mock('@/components/match/GameList', () => ({ default: () => null }));
vi.mock('@/lib/auth/redirect-to-sign-in', () => ({
  requireLiveIdentityOrSignIn: vi.fn(async () => ({ player: mocks.player })),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(async () => mocks.match),
}));
vi.mock('../ConfirmMatchClient', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.clientProps.push(props);
    return createElement('form', { 'data-testid': 'confirm-client' });
  },
}));

import ConfirmMatchPage from '../page';

function match(status: string, submitterId: string | null) {
  return {
    id: 'm1',
    tournament_id: 't1',
    status,
    player_1_id: 'p1',
    player_2_id: 'p2',
    player_1_name: 'Ash',
    player_2_name: 'Gary',
    winner_id: 'p1',
    submitter_id: submitterId,
    games: [],
  };
}

async function render(viewer: { playerId: string; isAdmin: boolean }, status: string, submitterId: string | null) {
  mocks.player = { ...viewer, name: 'Viewer' };
  mocks.match = match(status, submitterId);
  const element = await ConfirmMatchPage({ params: Promise.resolve({ mid: 'm1' }) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  mocks.clientProps = [];
});

describe('confirm page: the actions it offers', () => {
  it('the opponent of the submitter may confirm and dispute', async () => {
    await render({ playerId: 'p2', isAdmin: false }, 'pending_confirmation', 'p1');
    expect(mocks.clientProps[0]).toMatchObject({ canConfirm: true, canDispute: true });
  });

  it('the submitter may dispute but not confirm their own result', async () => {
    await render({ playerId: 'p1', isAdmin: false }, 'pending_confirmation', 'p1');
    expect(mocks.clientProps[0]).toMatchObject({ canConfirm: false, canDispute: true });
  });

  it('an admin who submitted may confirm', async () => {
    await render({ playerId: 'p1', isAdmin: true }, 'pending_confirmation', 'p1');
    expect(mocks.clientProps[0]).toMatchObject({ canConfirm: true, canDispute: true });
  });

  it('an admin who does not play may confirm but is not offered the dispute here', async () => {
    await render({ playerId: 'a1', isAdmin: true }, 'pending_confirmation', 'p1');
    expect(mocks.clientProps[0]).toMatchObject({ canConfirm: true, canDispute: false });
  });

  it.each(['scheduled', 'in_progress', 'completed', 'disputed'])('%s: no action, the not-needed note', async (status) => {
    const html = await render({ playerId: 'p2', isAdmin: false }, status, 'p1');
    expect(mocks.clientProps).toHaveLength(0);
    expect(html).not.toContain('confirm-client');
  });

  it('a player outside the match is sent to the dashboard', async () => {
    await expect(render({ playerId: 'x', isAdmin: false }, 'pending_confirmation', 'p1')).rejects.toThrow('REDIRECT /dashboard');
  });
});
