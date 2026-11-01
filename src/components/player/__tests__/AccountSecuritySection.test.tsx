/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';

vi.mock('next-auth/react', () => ({ signIn: vi.fn(), signOut: vi.fn() }));

import { signOut } from 'next-auth/react';
import AccountSecuritySection from '../AccountSecuritySection';

const RESEND = 'Is it your address and still unconfirmed? Send the confirmation email again';

function stubFetch(linkAnswer: { code: string; error: string }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/account/identities') {
        return { json: async () => ({ success: true, data: { hasDiscord: true, hasEmail: false, email: null, emailConfirmed: false } }) };
      }
      return { json: async () => ({ success: false, ...linkAnswer }) };
    }),
  );
}

async function submitLink(address: string) {
  const user = userEvent.setup();
  render(withI18n(<AccountSecuritySection />));
  await user.click(await screen.findByRole('button', { name: 'Add email login' }));
  await user.type(screen.getByLabelText('Email'), address);
  await user.type(screen.getByLabelText('Password'), 'pikachu123');
  await user.type(screen.getByLabelText('Confirm password'), 'pikachu123');
  await user.click(screen.getByRole('button', { name: 'Link email login' }));
  return user;
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AccountSecuritySection: an already registered address', () => {
  it('offers to resend the confirmation email for the address that was submitted, even after the field changes (#36)', async () => {
    stubFetch({ code: 'email_already_registered', error: 'This email is already registered.' });
    const user = await submitLink('ash@example.com');
    const link = await screen.findByRole('link', { name: RESEND });
    expect(link.getAttribute('href')).toBe('/auth/verify-email?email=ash%40example.com');

    await user.type(screen.getByLabelText('Email'), '.other');
    await waitFor(() => expect(screen.getByRole('link', { name: RESEND }).getAttribute('href')).toBe('/auth/verify-email?email=ash%40example.com'));
  });

  it('offers no resend link for any other refusal', async () => {
    stubFetch({ code: 'email_login_create_failed', error: 'Could not create the email login.' });
    await submitLink('ash@example.com');
    await screen.findByRole('alert');
    expect(screen.queryByRole('link', { name: RESEND })).toBeNull();
  });
});

describe('AccountSecuritySection: sign out everywhere', () => {
  beforeEach(() => {
    vi.mocked(signOut).mockClear();
  });

  function stubSessions(answer: { success: boolean; code?: string; error?: string; data?: unknown }) {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/account/identities') {
        return { json: async () => ({ success: true, data: { hasDiscord: true, hasEmail: false, email: null, emailConfirmed: false } }) };
      }
      return { json: async () => answer };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('revokes the sessions, then ends this browser session too', async () => {
    const fetchMock = stubSessions({ success: true, data: { revoked: true } });
    const user = userEvent.setup();
    render(withI18n(<AccountSecuritySection />));

    await user.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));

    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/account/sessions/revoke', { method: 'POST' });
  });

  it('keeps the player signed in and shows the API error when the revocation fails', async () => {
    stubSessions({ success: false, code: 'session_revoke_failed', error: 'Failed to sign out everywhere' });
    const user = userEvent.setup();
    render(withI18n(<AccountSecuritySection />));

    await user.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('shows a client-side message when the request itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/account/identities') {
          return { json: async () => ({ success: true, data: { hasDiscord: true, hasEmail: false, email: null, emailConfirmed: false } }) };
        }
        throw new Error('network');
      }),
    );
    const user = userEvent.setup();
    render(withI18n(<AccountSecuritySection />));

    await user.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Could not sign you out everywhere');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('is labelled in German', async () => {
    stubSessions({ success: true, data: { revoked: true } });
    render(withI18n(<AccountSecuritySection />, { locale: 'de' }));

    expect(await screen.findByRole('button', { name: 'Überall abmelden' })).toBeTruthy();
  });
});