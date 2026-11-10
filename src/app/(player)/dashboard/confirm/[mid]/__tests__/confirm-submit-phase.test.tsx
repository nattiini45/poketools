/** @vitest-environment jsdom */
/**
 * After a successful confirm or dispute the page redirects 2 s later: until then the result cannot be sent again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';
import ConfirmMatchClient from '../ConfirmMatchClient';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ui() {
  return withI18n(<ConfirmMatchClient matchId="m1" canConfirm canDispute redirectTo="/tournaments/t1/matches/m1" />);
}

describe('ConfirmMatchClient submit phase', () => {
  it('keeps both actions disabled after a success until the redirect', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: true, data: {} }) });
    const user = userEvent.setup();
    render(ui());

    await user.click(screen.getByRole('button', { name: 'Confirm Result' }));
    await screen.findByText(/confirmed/i);

    expect(screen.getByRole('button', { name: 'Confirm Result' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Dispute Result' })).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('button', { name: 'Dispute Result' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lets the viewer try again after a failure', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => ({ success: false, error: 'nope', code: 'match_state_changed' }) });
    const user = userEvent.setup();
    render(ui());

    await user.click(screen.getByRole('button', { name: 'Confirm Result' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm Result' })).toHaveProperty('disabled', false));
    fetchMock.mockResolvedValueOnce({ json: async () => ({ success: true, data: {} }) });
    await user.click(screen.getByRole('button', { name: 'Confirm Result' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
