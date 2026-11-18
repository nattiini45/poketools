import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_PATH_HEADER } from '@/lib/auth/request-path';
import AdminLayout from '../../../layout';

const mocks = vi.hoisted(() => ({
  path: '',
  getLiveAccess: vi.fn(),
  getPhaseRouteMode: vi.fn(),
  readNativeAdminMatchOwner: vi.fn(),
  canAdministerPhaseAccess: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ [REQUEST_PATH_HEADER]: mocks.path }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: mocks.getPhaseRouteMode }));
vi.mock('../match-target', () => ({ readNativeAdminMatchOwner: mocks.readNativeAdminMatchOwner }));
vi.mock('@/lib/auth/phase-access', () => ({ canAdministerPhaseAccess: mocks.canAdministerPhaseAccess }));
vi.mock('@/lib/pack-extensions', () => ({ extensionAdminLinks: async () => [] }));
vi.mock('@/components/shared/SkipToContent', () => ({ default: () => null }));
vi.mock('@/components/shared/PageTransitionWrapper', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/shared/AdminGuard', () => ({ default: () => 'Ordinary admin gate' }));
vi.mock('@/components/admin/AdminShell', () => ({ default: () => 'General admin shell' }));
vi.mock('@/components/admin/assistant/AssistantDrawer', () => ({ default: () => 'Admin assistant' }));

const MATCH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GAME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PHASE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PLAYER = { playerId: 'phase-organizer', status: 'active', isAdmin: false };
const DETAIL = `/admin/matches/${MATCH}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.path = DETAIL;
  mocks.getLiveAccess.mockResolvedValue({ player: PLAYER, isAnyAdmin: false });
  mocks.getPhaseRouteMode.mockResolvedValue('phase');
  mocks.readNativeAdminMatchOwner.mockResolvedValue({ phase_id: PHASE });
  mocks.canAdministerPhaseAccess.mockResolvedValue(true);
});

async function renderEntry() {
  return renderToStaticMarkup(await AdminLayout({ children: <p>Scoped page slot</p> }));
}

describe('phase-only correction layout entry', () => {
  it.each([DETAIL, `${DETAIL}/games/${GAME}/edit?back=status%3Ddisputed`])(
    'renders only the scoped page slot at %s',
    async (path) => {
      mocks.path = path;
      const html = await renderEntry();

      expect(html).toContain('Scoped page slot');
      expect(html).not.toMatch(/General admin shell|Admin assistant|Ordinary admin gate/);
      expect(mocks.readNativeAdminMatchOwner).toHaveBeenCalledWith(MATCH);
      expect(mocks.canAdministerPhaseAccess).toHaveBeenCalledWith(PLAYER, PHASE);
    },
  );

  it.each(['/admin/data', '/admin/matches', `${DETAIL}/import-replay`, `${DETAIL}/games/no-id/edit`])(
    'cannot bypass the ordinary admin gate on %s',
    async (path) => {
      mocks.path = path;
      expect(await renderEntry()).toContain('Ordinary admin gate');
      expect(mocks.getPhaseRouteMode).not.toHaveBeenCalled();
      expect(mocks.readNativeAdminMatchOwner).not.toHaveBeenCalled();
    },
  );

  it('refuses the phase-only route when the current role does not cover the match', async () => {
    mocks.canAdministerPhaseAccess.mockResolvedValue(false);
    expect(await renderEntry()).not.toContain('Scoped page slot');
  });

  it.each(['legacy', 'frozen_phase'])('does not look up a native owner in %s mode', async (mode) => {
    mocks.getPhaseRouteMode.mockResolvedValue(mode);
    expect(await renderEntry()).not.toContain('Scoped page slot');
    expect(mocks.readNativeAdminMatchOwner).not.toHaveBeenCalled();
  });

  it('keeps the ordinary admin shell for an existing admin', async () => {
    mocks.getLiveAccess.mockResolvedValue({ player: PLAYER, isAnyAdmin: true });
    expect(await renderEntry()).toContain('General admin shell');
    expect(mocks.getPhaseRouteMode).not.toHaveBeenCalled();
  });
});
