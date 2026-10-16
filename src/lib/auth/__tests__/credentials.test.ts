import { describe, it, expect, vi, beforeEach } from 'vitest';

const signInWithPassword = vi.fn();

vi.mock('@/lib/supabase/auth-client', () => ({
  createAuthClient: () => ({
    auth: { signInWithPassword },
  }),
}));

import {
  authorizeCredentials,
  InvalidCredentialsError,
  EmailNotVerifiedError,
} from '../credentials';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('authorizeCredentials', () => {
  it('returns the auth user on success', async () => {
    signInWithPassword.mockResolvedValue({
      data: {
        user: {
          id: 'auth-user-1',
          user_metadata: { display_name: 'Ash' },
        },
      },
      error: null,
    });

    const user = await authorizeCredentials('Ash@Example.com ', 'hunter22');

    expect(user).toEqual({ id: 'auth-user-1', email: 'ash@example.com', displayName: 'Ash' });
    // Email is normalized before hitting GoTrue
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'ash@example.com',
      password: 'hunter22',
    });
  });

  it('falls back to the email local part when display_name is missing', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: { id: 'auth-user-1', user_metadata: {} } },
      error: null,
    });

    const user = await authorizeCredentials('misty@example.com', 'hunter22');
    expect(user.displayName).toBe('misty');
  });

  it('throws EmailNotVerifiedError when the email is not confirmed', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: 'email_not_confirmed', message: 'Email not confirmed' },
    });

    await expect(authorizeCredentials('ash@example.com', 'hunter22'))
      .rejects.toBeInstanceOf(EmailNotVerifiedError);
  });

  it('throws InvalidCredentialsError on any other GoTrue error', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });

    await expect(authorizeCredentials('ash@example.com', 'wrong'))
      .rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects empty email or password without calling GoTrue', async () => {
    await expect(authorizeCredentials('', 'hunter22'))
      .rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(authorizeCredentials('ash@example.com', ''))
      .rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
