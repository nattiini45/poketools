import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { FakeAuthError } = vi.hoisted(() => ({
  FakeAuthError: class extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public readonly code?: string,
    ) {
      super(message);
    }
  },
}));
const auth = vi.hoisted(() => ({ requireCreator: vi.fn() }));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
);
const cookieJar = vi.hoisted(() => ({ locale: undefined as string | undefined }));

vi.mock('@/lib/auth/helpers', () => ({ ...auth, AuthError: FakeAuthError }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'x-poketools-path' ? '/creator/studio/s1?x=1' : null) }),
  cookies: async () => ({
    get: (name: string) =>
      name === 'plc_locale' && cookieJar.locale !== undefined ? { name, value: cookieJar.locale } : undefined,
  }),
}));

import { gateCreatorPage } from '../creator-page-gate';
import ResourceForbidden from '../ResourceForbidden';

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.locale = undefined;
});

describe('gateCreatorPage (#56)', () => {
  it('hands the creator id to the page', async () => {
    auth.requireCreator.mockResolvedValue({ playerId: 'p1' });
    expect(await gateCreatorPage()).toEqual({ ok: true, playerId: 'p1' });
  });

  it('sends a signed-out visitor to sign-in with the studio page as the return path', async () => {
    auth.requireCreator.mockRejectedValue(new FakeAuthError('Not authenticated', 401, 'unauthenticated'));
    await expect(gateCreatorPage()).rejects.toThrow(
      `redirect:/auth/signin?callbackUrl=${encodeURIComponent('/creator/studio/s1?x=1')}`,
    );
  });

  it('shows the forbidden panel, not a silent redirect, to a signed-in non-creator', async () => {
    auth.requireCreator.mockRejectedValue(new FakeAuthError('Content creator access required', 403, 'forbidden'));
    const gate = await gateCreatorPage();
    expect(redirect).not.toHaveBeenCalled();
    if (gate.ok) throw new Error('expected a denial');
    const html = renderToStaticMarkup(await ResourceForbidden(gate.view.props as Parameters<typeof ResourceForbidden>[0]));
    expect(html).toContain('Access Denied');
    expect(html).toContain('content creator privileges');
  });

  it('shows the same panel in German', async () => {
    cookieJar.locale = 'de';
    auth.requireCreator.mockRejectedValue(new FakeAuthError('Content creator access required', 403, 'forbidden'));
    const gate = await gateCreatorPage();
    if (gate.ok) throw new Error('expected a denial');
    const html = renderToStaticMarkup(await ResourceForbidden(gate.view.props as Parameters<typeof ResourceForbidden>[0]));
    expect(html).toContain('Kein Zugriff');
    expect(html).toContain('Creator-Rechte');
  });

  it('does not swallow a failure that is not an auth decision', async () => {
    auth.requireCreator.mockRejectedValue(new Error('db down'));
    await expect(gateCreatorPage()).rejects.toThrow('db down');
  });
});
