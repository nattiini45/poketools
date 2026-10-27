/**
 * `/admin/matches/[id]/import-replay` is a detour from the match page. Its
 * "back" link and the redirect after an import must return to the match page
 * WITH the Matches list query the viewer came from, re-parsed like the match
 * page does. The page runs as a plain async function (vitest 'node' env) and
 * its element tree is walked without rendering the children.
 */
import { isValidElement, type ReactNode } from 'react';
import Link from 'next/link';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveAccess } from '@/lib/auth/helpers';
import { fullMatchRow } from '@/lib/match/__tests__/private-match-fields';

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, { value: string }>(),
  getMatchById: vi.fn(),
  getLiveAccess: vi.fn<() => Promise<LiveAccess | null>>(),
  isResourceAdminFor: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => mocks.cookies.get(name) }),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: mocks.getMatchById }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: mocks.isResourceAdminFor }));
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/components/shared/AdminGuard', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/match/MatchStatusBadge', () => ({ default: () => null }));
vi.mock('@/components/match/ReplayImportForm', () => ({ default: () => null }));

import ImportReplayPage from '../page';
import ReplayImportForm from '@/components/match/ReplayImportForm';

const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
const MATCH_ID = '33333333-3333-4333-8333-333333333333';

interface Found {
  form: Record<string, unknown> | null;
  links: string[];
}

function scan(node: ReactNode, out: Found = { form: null, links: [] }): Found {
  if (Array.isArray(node)) {
    node.forEach((n) => scan(n, out));
  } else if (isValidElement<{ children?: ReactNode; action?: ReactNode; href?: string }>(node)) {
    if (node.type === ReplayImportForm) out.form = node.props as Record<string, unknown>;
    if (node.type === Link && typeof node.props.href === 'string') out.links.push(node.props.href);
    scan(node.props.children, out);
    scan(node.props.action, out);
  }
  return out;
}

async function render(back?: string) {
  return scan(
    await ImportReplayPage({
      params: Promise.resolve({ id: MATCH_ID }),
      ...(back === undefined ? {} : { searchParams: Promise.resolve({ back }) }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.clear();
  mocks.getMatchById.mockResolvedValue(fullMatchRow({ id: MATCH_ID, tournament_id: TOURNAMENT_ID, status: 'scheduled' }));
  mocks.getLiveAccess.mockResolvedValue({
    player: { playerId: 'viewer-1' } as LiveAccess['player'],
    isSiteAdmin: true,
    isAnyAdmin: true,
    isCreator: false,
    isSuperadmin: false,
  });
});

describe('ImportReplayPage: the way back keeps the list query', () => {
  it('returns to the match page with the canonical back query, after an import and by the link', async () => {
    const href = `/admin/matches/${MATCH_ID}?back=${encodeURIComponent('status=disputed&page=2')}`;
    const { form, links } = await render('page=2&status=disputed');
    expect(form?.redirectTo).toBe(href);
    expect(links).toEqual([href]);
  });

  it('drops an invalid or missing back value', async () => {
    for (const back of ['//evil.example', undefined]) {
      const { form, links } = await render(back);
      expect(form?.redirectTo).toBe(`/admin/matches/${MATCH_ID}`);
      expect(links).toEqual([`/admin/matches/${MATCH_ID}`]);
    }
  });
});
