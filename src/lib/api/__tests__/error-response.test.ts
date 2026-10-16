import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

// AuthError is defined in auth/helpers but importing that file pulls in
// next-auth -> next/server which isn't resolvable in the test runner.
// Re-create the class inside the factory (vi.mock is hoisted, so it
// cannot reference top-level variables).

vi.mock('@/lib/auth/helpers', () => ({
  AuthError: (() => {
    class AuthError extends Error {
      statusCode: number;
      code?: string;
      constructor(message: string, statusCode: number, code?: string) {
        super(message);
        this.name = 'AuthError';
        this.statusCode = statusCode;
        this.code = code;
      }
    }
    return AuthError;
  })(),
}));

import { safeErrorResponse } from '../error-response';
import { UserFacingError } from '../user-facing-error';
import { AuthError } from '@/lib/auth/helpers';

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── safeErrorResponse ────────────────────────────────────────────────

describe('safeErrorResponse', () => {
  it('passes through AuthError message and statusCode', async () => {
    const err = new AuthError('Not authenticated', 401);
    const response = safeErrorResponse(err, 'Something went wrong');
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, error: 'Not authenticated' });
  });

  it('passes through AuthError with 403 status', async () => {
    const err = new AuthError('Admin access required', 403);
    const response = safeErrorResponse(err, 'Fallback');
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'Admin access required' });
  });

  it('hides generic Error message and returns fallback', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('SQL syntax error near line 42');
    const response = safeErrorResponse(err, 'Failed to create resource');
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Failed to create resource' });
    // Must NOT contain internal error details
    expect(body.error).not.toContain('SQL');
    consoleSpy.mockRestore();
  });

  it('logs generic errors to console.error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('Internal kaboom');
    safeErrorResponse(err, 'Failed to process');

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith('[API] Failed to process:', err);
    consoleSpy.mockRestore();
  });

  it('does not log AuthError to console.error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new AuthError('Forbidden', 403);
    safeErrorResponse(err, 'Fallback');

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('uses default 500 status for non-auth errors when no status provided', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = safeErrorResponse(new Error('oops'), 'Fallback');
    expect(response.status).toBe(500);
    consoleSpy.mockRestore();
  });

  it('uses custom status for non-auth errors when provided', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = safeErrorResponse(new Error('bad input'), 'Bad request', 400);
    expect(response.status).toBe(400);
    consoleSpy.mockRestore();
  });

  it('handles non-Error throwables (string)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = safeErrorResponse('string error', 'Something failed');
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Something failed' });
    expect(consoleSpy).toHaveBeenCalledWith('[API] Something failed:', 'string error');
    consoleSpy.mockRestore();
  });

  it('handles null/undefined throwables', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = safeErrorResponse(null, 'Null error fallback');
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Null error fallback' });
    consoleSpy.mockRestore();
  });

  it('passes through UserFacingError message, code, and status', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new UserFacingError('Fire/Water/Grass is already assigned', {
      code: 'core_types_conflict',
      status: 409,
    });
    const response = safeErrorResponse(err, 'Fallback');
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      success: false,
      error: 'Fire/Water/Grass is already assigned',
      code: 'core_types_conflict',
    });
    consoleSpy.mockRestore();
  });

  it('defaults UserFacingError to status 400 and omits code when unset', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = safeErrorResponse(new UserFacingError('Pool is empty'), 'Fallback');
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ success: false, error: 'Pool is empty' });
    expect(body).not.toHaveProperty('code');
    consoleSpy.mockRestore();
  });

  it('logs UserFacingError to console.error (unlike AuthError)', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new UserFacingError('Domain failure', { code: 'PHASE_NOT_FOUND' });
    safeErrorResponse(err, 'Fallback');

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith('[API] Fallback:', err);
    consoleSpy.mockRestore();
  });

  it('does not let the AuthError duck-type absorb UserFacingError (branch ordering)', async () => {
    // UserFacingError also carries a numeric statusCode; if the AuthError
    // duck-type check ran first it would swallow the code field and skip
    // the server-side log. Guard the branch order.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new UserFacingError('Specific domain message', { code: 'SEASON_CLOSED' });
    const response = safeErrorResponse(err, 'Fallback');
    const body = await response.json();

    expect(body.code).toBe('SEASON_CLOSED');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it('subclasses of UserFacingError pass through', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    class DomainError extends UserFacingError {
      constructor() {
        super('Subclass message', { code: 'duplicate_replay' });
        this.name = 'DomainError';
      }
    }
    const response = safeErrorResponse(new DomainError(), 'Fallback');
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ success: false, error: 'Subclass message', code: 'duplicate_replay' });
    consoleSpy.mockRestore();
  });

  // ── code / params (i18n-core §4.1, G0-ERR) ──────────────────────────

  it('passes UserFacingError params through next to the code', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new UserFacingError('Seed 3 is already held by another participant', {
      code: 'SEED_CONFLICT',
      params: { seed: 3 },
      status: 409,
    });
    const response = safeErrorResponse(err, 'Fallback');
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      success: false,
      error: 'Seed 3 is already held by another participant',
      code: 'SEED_CONFLICT',
      params: { seed: 3 },
    });
    consoleSpy.mockRestore();
  });

  it('omits params when the UserFacingError has none', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = await safeErrorResponse(
      new UserFacingError('Phase not found in this league', { code: 'PHASE_NOT_FOUND', status: 404 }),
      'Fallback',
    ).json();

    expect(body).toEqual({ success: false, error: 'Phase not found in this league', code: 'PHASE_NOT_FOUND' });
    expect(body).not.toHaveProperty('params');
    consoleSpy.mockRestore();
  });

  it('passes the AuthError code through when the throw site sets one', async () => {
    const response = safeErrorResponse(new AuthError('Your account has been banned', 403, 'account_banned'), 'F');
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'Your account has been banned', code: 'account_banned' });
  });

  it('drops an AuthError-shaped code that is not an errors/common key', async () => {
    const err = Object.assign(new Error('Nope'), { statusCode: 403, code: 'not_a_catalog_code' });
    const response = safeErrorResponse(err, 'F');
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'Nope' });
  });

  it('adds fallbackCode to the static fallback, keeping the log line', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('db exploded');
    const response = safeErrorResponse(err, 'Failed to save the language setting', 500, 'locale_save_failed');
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: 'Failed to save the language setting',
      code: 'locale_save_failed',
    });
    expect(consoleSpy).toHaveBeenCalledWith('[API] Failed to save the language setting:', err);
    consoleSpy.mockRestore();
  });

  it('never applies fallbackCode to a UserFacingError or an AuthError', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ufe = await safeErrorResponse(new UserFacingError('Pool is empty'), 'F', 500, 'unknown_error').json();
    expect(ufe).toEqual({ success: false, error: 'Pool is empty' });
    const auth = await safeErrorResponse(new AuthError('Nope', 401), 'F', 500, 'unknown_error').json();
    expect(auth).toEqual({ success: false, error: 'Nope' });
    consoleSpy.mockRestore();
  });

  it('returns proper JSON content structure on all paths', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // AuthError path
    const authResp = safeErrorResponse(new AuthError('No', 401), 'F');
    const authBody = await authResp.json();
    expect(authBody).toHaveProperty('success', false);
    expect(authBody).toHaveProperty('error');

    // Generic error path
    const genResp = safeErrorResponse(new Error('x'), 'F');
    const genBody = await genResp.json();
    expect(genBody).toHaveProperty('success', false);
    expect(genBody).toHaveProperty('error');

    consoleSpy.mockRestore();
  });
});
