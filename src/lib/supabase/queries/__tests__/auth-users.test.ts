import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, resetQueryMock } from './query-mock';

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./query-mock')).mock.supabase }));

import { deleteAuthUser, getAuthUserEmailState, setAuthUserPassword } from '../auth-users';

beforeEach(resetQueryMock);

describe('getAuthUserEmailState', () => {
  it('reports the email and its confirmation', async () => {
    mock.state.authAdminResults.push({ data: { user: { email: 'a@b.test', email_confirmed_at: '2026-01-01T00:00:00Z' } } });
    await expect(getAuthUserEmailState('u1')).resolves.toEqual({ email: 'a@b.test', emailConfirmed: true });
    expect(mock.state.authAdmin).toEqual([{ method: 'getUserById', args: ['u1'] }]);
  });

  it('reports an unconfirmed email', async () => {
    mock.state.authAdminResults.push({ data: { user: { email: 'a@b.test', email_confirmed_at: null } } });
    await expect(getAuthUserEmailState('u1')).resolves.toEqual({ email: 'a@b.test', emailConfirmed: false });
  });

  it('answers null when GoTrue errors or has no user', async () => {
    mock.state.authAdminResults.push({ error: new Error('down') }, { data: { user: null } });
    await expect(getAuthUserEmailState('u1')).resolves.toBeNull();
    await expect(getAuthUserEmailState('u2')).resolves.toBeNull();
  });
});

describe('setAuthUserPassword', () => {
  it('updates the password of the given user', async () => {
    await setAuthUserPassword('u1', 'new-password');
    expect(mock.state.authAdmin).toEqual([{ method: 'updateUserById', args: ['u1', { password: 'new-password' }] }]);
  });

  it('throws the GoTrue error', async () => {
    const failure = new Error('weak');
    mock.state.authAdminResults.push({ error: failure });
    await expect(setAuthUserPassword('u1', 'x')).rejects.toBe(failure);
  });
});

describe('deleteAuthUser', () => {
  it('deletes the given user', async () => {
    await deleteAuthUser('u1');
    expect(mock.state.authAdmin).toEqual([{ method: 'deleteUser', args: ['u1'] }]);
  });

  it('throws the GoTrue error', async () => {
    const failure = new Error('gone');
    mock.state.authAdminResults.push({ error: failure });
    await expect(deleteAuthUser('u1')).rejects.toBe(failure);
  });
});
