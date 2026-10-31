/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';

vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));

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
