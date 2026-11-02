/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';

const order: string[] = [];
const signOutMock = vi.hoisted(() => vi.fn());
const clearMock = vi.hoisted(() => vi.fn());

vi.mock('next-auth/react', () => ({
  signOut: signOutMock,
  useSession: () => ({ data: { user: { name: 'Ash' } }, status: 'authenticated' }),
}));
vi.mock('@/lib/pwa/caches', () => ({ clearPwaCaches: clearMock }));

import DiscordLoginButton from '../DiscordLoginButton';

beforeEach(() => {
  order.length = 0;
  clearMock.mockReset().mockImplementation(async () => {
    await Promise.resolve();
    order.push('clear');
  });
  signOutMock.mockReset().mockImplementation(async () => {
    order.push('signOut');
  });
});
afterEach(() => vi.clearAllMocks());

describe('DiscordLoginButton sign-out', () => {
  it('clears the service worker caches before it signs out', async () => {
    render(withI18n(<DiscordLoginButton />));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign Out' }));
    await vi.waitFor(() => expect(order).toEqual(['clear', 'signOut']), { timeout: 5000 });
  });
});
