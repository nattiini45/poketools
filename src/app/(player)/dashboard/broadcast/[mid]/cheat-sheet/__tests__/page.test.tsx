/**
 * Cheat-sheet page: only an auth refusal shows the creator-required notice;
 * a failed live read reaches the error boundary instead of being reported as
 * "not a creator" (no error masking).
 */
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({
  requireCreator: vi.fn(),
  fetchCasterData: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children),
}));
vi.mock('@/components/shared/AuthGuard', () => ({
  default: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
}));
vi.mock('@/components/broadcast/caster/CheatSheet', () => ({
  default: () => createElement('section', { 'data-testid': 'cheat-sheet' }),
}));
vi.mock('@/lib/auth/helpers', async () => {
  class AuthError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code: string,
    ) {
      super(message);
    }
  }
  return { AuthError, requireCreator: mocks.requireCreator };
});
vi.mock('@/lib/broadcast/caster-data', () => ({
  fetchCasterData: mocks.fetchCasterData,
}));

import CheatSheetPage from '../page';
import { AuthError } from '@/lib/auth/helpers';

const PROPS = { params: Promise.resolve({ mid: 'm-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cheat-sheet page auth', () => {
  it('shows the creator-required notice on an auth refusal', async () => {
    mocks.requireCreator.mockRejectedValue(new AuthError('Forbidden', 403, 'forbidden'));
    const html = renderToStaticMarkup(await CheatSheetPage(PROPS));
    expect(html).not.toContain('cheat-sheet');
    expect(mocks.fetchCasterData).not.toHaveBeenCalled();
  });

  it('rethrows a failed live read instead of reporting "not a creator"', async () => {
    mocks.requireCreator.mockRejectedValue(new Error('players read failed'));
    await expect(CheatSheetPage(PROPS)).rejects.toThrow('players read failed');
    expect(mocks.fetchCasterData).not.toHaveBeenCalled();
  });

  it('passes the live admin flag to caster data', async () => {
    mocks.requireCreator.mockResolvedValue({ playerId: 'c-1', isAdmin: false });
    mocks.fetchCasterData.mockResolvedValue(null);
    await CheatSheetPage(PROPS);
    expect(mocks.fetchCasterData).toHaveBeenCalledWith('m-1', { viewerId: 'c-1', isAdmin: false });
  });
});
