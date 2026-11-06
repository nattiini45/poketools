/**
 * The player's play page: a malformed id is a 404, a signed-out race goes to the dashboard, and the page is one of five
 * things: a notice (not a custom league, not a member, format not running), the view, or the view read-only for a
 * closed league. Only plain data reaches the client island. The page runs as a plain async function (vitest 'node'
 * env) and its element tree is walked without rendering the child components.
 */
import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLiveAccess: vi.fn(),
  getSeasonWithDetails: vi.fn(),
  getSeasonParticipantRow: vi.fn(),
  loadPlayerView: vi.fn(),
}));

vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return { getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en') };
});
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));
vi.mock('next/link', () => ({ default: () => null }));
vi.mock('@/components/format-runtime/player/PlayerFormatView', () => ({ default: () => null }));
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/format-engine/runtime/views-server', () => ({ loadPlayerView: mocks.loadPlayerView }));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonWithDetails: mocks.getSeasonWithDetails,
  getSeasonParticipantRow: mocks.getSeasonParticipantRow,
}));

import PlayPage from '../page';
import PlayerFormatView from '@/components/format-runtime/player/PlayerFormatView';
import Link from 'next/link';
import { createTranslator } from '@/i18n/core';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';

const SEASON_ID = '5e150000-0000-4000-8000-000000000001';
const PLAYER_ID = '5e150000-0000-4000-8000-0000000000b1';
const t = createTranslator(formatRuntimePlayerMessages, 'en');

const league = (over: Record<string, unknown> = {}) => ({
  id: SEASON_ID,
  name: 'Wichtelcup',
  format_type: 'custom',
  status: 'active',
  archived: false,
  ...over,
});
const RUNNING = { running: true, actions: [], domains: [], items: [], relations: [], ladders: [] };

const access = (over: Record<string, unknown> = {}, isSiteAdmin = false) => ({
  player: { playerId: PLAYER_ID, name: 'Ash', isAdmin: isSiteAdmin, status: 'active', ...over },
  isSiteAdmin,
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function walk(node: ReactNode, visit: (element: { type: unknown; props: Record<string, unknown> }) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return;
  visit(node as unknown as { type: unknown; props: Record<string, unknown> });
  walk(node.props.children, visit);
}

function propsOf(node: ReactNode, type: unknown): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  walk(node, (element) => {
    if (found === null && element.type === type) found = element.props;
  });
  return found;
}

/** Every string in the tree (the page's own text; child components are not rendered). */
function textOf(node: ReactNode): string[] {
  const out: string[] = [];
  const collect = (value: ReactNode): void => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (isValidElement<{ children?: ReactNode }>(value)) collect(value.props.children);
  };
  collect(node);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLiveAccess.mockResolvedValue(access());
  mocks.getSeasonWithDetails.mockResolvedValue(league());
  mocks.getSeasonParticipantRow.mockResolvedValue({ gym_type: null, core_types: null, core_assigned_at: null });
  mocks.loadPlayerView.mockResolvedValue(RUNNING);
});

describe('PlayPage: gates', () => {
  it('a malformed id is a 404 and reads nothing', async () => {
    await expect(PlayPage(params('not-a-uuid'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getSeasonWithDetails).not.toHaveBeenCalled();
    expect(mocks.loadPlayerView).not.toHaveBeenCalled();
  });

  it('a revoked session that slipped past the layout goes to the dashboard', async () => {
    mocks.getLiveAccess.mockResolvedValue(null);
    await expect(PlayPage(params(SEASON_ID))).rejects.toThrow('NEXT_REDIRECT /dashboard');
    expect(mocks.loadPlayerView).not.toHaveBeenCalled();
  });

  it('an identity without a player goes to the dashboard', async () => {
    mocks.getLiveAccess.mockResolvedValue({ player: null, isSiteAdmin: false });
    await expect(PlayPage(params(SEASON_ID))).rejects.toThrow('NEXT_REDIRECT /dashboard');
    expect(mocks.loadPlayerView).not.toHaveBeenCalled();
  });

  it('an unknown league is a 404', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(null);
    await expect(PlayPage(params(SEASON_ID))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('an upper-case id is looked up in lower case', async () => {
    await PlayPage(params(SEASON_ID.toUpperCase()));
    expect(mocks.getSeasonWithDetails).toHaveBeenCalledWith(SEASON_ID);
    expect(mocks.loadPlayerView).toHaveBeenCalledWith(SEASON_ID, PLAYER_ID);
  });
});

describe('PlayPage: notices', () => {
  it('a league that is not custom shows the notice and never loads the view', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(league({ format_type: 'singles' }));
    const page = await PlayPage(params(SEASON_ID));
    expect(textOf(page)).toContain(t('page.notCustom'));
    expect(propsOf(page, PlayerFormatView)).toBeNull();
    expect(mocks.getSeasonParticipantRow).not.toHaveBeenCalled();
    expect(mocks.loadPlayerView).not.toHaveBeenCalled();
  });

  it('a player who is not in the league gets the notice, not the view (a site admin gets no bypass)', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ name: 'Root' }, true));
    mocks.getSeasonParticipantRow.mockResolvedValue(null);
    const page = await PlayPage(params(SEASON_ID));
    expect(textOf(page)).toContain(t('page.notMember'));
    expect(propsOf(page, PlayerFormatView)).toBeNull();
    expect(mocks.getSeasonParticipantRow).toHaveBeenCalledWith(SEASON_ID, PLAYER_ID);
    expect(mocks.loadPlayerView).not.toHaveBeenCalled();
  });

  it.each(['banned', 'suspended'])(
    'a %s member gets the not-a-member notice and the view is never loaded (as GET format/me refuses them)',
    async (status) => {
      mocks.getLiveAccess.mockResolvedValue(access({ status }));
      const page = await PlayPage(params(SEASON_ID));
      expect(textOf(page)).toContain(t('page.notMember'));
      expect(propsOf(page, PlayerFormatView)).toBeNull();
      expect(mocks.getSeasonParticipantRow).not.toHaveBeenCalled();
      expect(mocks.loadPlayerView).not.toHaveBeenCalled();
    },
  );

  it('a site admin who plays keeps the view whatever the status column says (the guards let admins bypass)', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ status: 'suspended' }, true));
    const page = await PlayPage(params(SEASON_ID));
    expect(propsOf(page, PlayerFormatView)).not.toBeNull();
    expect(mocks.loadPlayerView).toHaveBeenCalledWith(SEASON_ID, PLAYER_ID);
  });

  it('a format that is not running shows the notice', async () => {
    mocks.loadPlayerView.mockResolvedValue({ running: false });
    const page = await PlayPage(params(SEASON_ID));
    expect(textOf(page)).toContain(t('page.notRunning'));
    expect(propsOf(page, PlayerFormatView)).toBeNull();
  });

  it('the notices keep the title and a link back to the league', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(league({ format_type: 'draft' }));
    const page = await PlayPage(params(SEASON_ID));
    expect(textOf(page)).toContain(t('page.title', { league: 'Wichtelcup' }));
    expect(propsOf(page, Link)?.href).toBe(`/leagues/${SEASON_ID}`);
  });
});

describe('PlayPage: the view', () => {
  it('hands the client island the view of the session player and nothing else', async () => {
    const page = await PlayPage(params(SEASON_ID));
    expect(mocks.loadPlayerView).toHaveBeenCalledWith(SEASON_ID, PLAYER_ID);
    expect(propsOf(page, PlayerFormatView)).toEqual({ seasonId: SEASON_ID, viewerId: PLAYER_ID, initialView: RUNNING, closed: false });
    expect(textOf(page)).not.toContain(t('page.closed'));
  });

  it.each([
    ['completed', { status: 'completed' }],
    ['archived', { archived: true }],
  ])('a %s league renders the view read-only with a notice', async (_name, over) => {
    mocks.getSeasonWithDetails.mockResolvedValue(league(over));
    const page = await PlayPage(params(SEASON_ID));
    expect(propsOf(page, PlayerFormatView)?.closed).toBe(true);
    expect(textOf(page)).toContain(t('page.closed'));
  });

  it('upcoming and active leagues are open', async () => {
    for (const status of ['upcoming', 'active']) {
      mocks.getSeasonWithDetails.mockResolvedValue(league({ status }));
      const page = await PlayPage(params(SEASON_ID));
      expect(propsOf(page, PlayerFormatView)?.closed).toBe(false);
    }
  });

  it('a failed read reaches the error boundary instead of an empty page', async () => {
    mocks.loadPlayerView.mockRejectedValue(new Error('read failed'));
    await expect(PlayPage(params(SEASON_ID))).rejects.toThrow('read failed');
  });
});
