import { describe, it, expect } from 'vitest';
import { hasValue, checkCredentials, validateCredentials, toCredentialHint } from '../validation';
import type { SocialCredentials } from '@/types/social';

// ── hasValue ────────────────────────────────────────────────────────

describe('hasValue', () => {
  it('returns true for a non-empty string', () => {
    expect(hasValue('hello')).toBe(true);
  });

  it('returns false for an empty string', () => {
    expect(hasValue('')).toBe(false);
  });

  it('returns false for a whitespace-only string', () => {
    expect(hasValue('   ')).toBe(false);
  });

  it('returns false for null', () => {
    expect(hasValue(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasValue(undefined)).toBe(false);
  });

  it('returns true for a string with leading/trailing spaces', () => {
    expect(hasValue('  token  ')).toBe(true);
  });
});

// ── validateCredentials ─────────────────────────────────────────────

describe('validateCredentials', () => {
  describe('X provider', () => {
    it('returns null for valid X credentials', () => {
      const creds: SocialCredentials = {
        provider: 'x',
        access_token: 'tok_abc123',
      };
      expect(validateCredentials(creds)).toBeNull();
    });

    it('returns error when access_token is empty', () => {
      const creds: SocialCredentials = {
        provider: 'x',
        access_token: '',
      };
      expect(validateCredentials(creds)).toBe('X credentials require access_token');
    });

    it('returns error when access_token is whitespace', () => {
      const creds: SocialCredentials = {
        provider: 'x',
        access_token: '   ',
      };
      expect(validateCredentials(creds)).toBe('X credentials require access_token');
    });
  });

  describe('Threads provider', () => {
    it('returns null for valid Threads credentials', () => {
      const creds: SocialCredentials = {
        provider: 'threads',
        access_token: 'tok_threads',
        user_id: 'user123',
      };
      expect(validateCredentials(creds)).toBeNull();
    });

    it('returns error when access_token is missing', () => {
      const creds: SocialCredentials = {
        provider: 'threads',
        access_token: '',
        user_id: 'user123',
      };
      expect(validateCredentials(creds)).toBe('Threads credentials require access_token');
    });

    it('returns error when user_id is missing', () => {
      const creds: SocialCredentials = {
        provider: 'threads',
        access_token: 'tok_threads',
        user_id: '',
      };
      expect(validateCredentials(creds)).toBe('Threads credentials require user_id');
    });

    it('checks access_token before user_id', () => {
      const creds: SocialCredentials = {
        provider: 'threads',
        access_token: '',
        user_id: '',
      };
      expect(validateCredentials(creds)).toBe('Threads credentials require access_token');
    });
  });

  describe('Bluesky provider', () => {
    it('returns null for valid Bluesky credentials', () => {
      const creds: SocialCredentials = {
        provider: 'bluesky',
        handle: 'user.bsky.social',
        app_password: 'app-pass-1234',
      };
      expect(validateCredentials(creds)).toBeNull();
    });

    it('returns error when handle is missing', () => {
      const creds: SocialCredentials = {
        provider: 'bluesky',
        handle: '',
        app_password: 'app-pass-1234',
      };
      expect(validateCredentials(creds)).toBe('Bluesky credentials require handle');
    });

    it('returns error when app_password is missing', () => {
      const creds: SocialCredentials = {
        provider: 'bluesky',
        handle: 'user.bsky.social',
        app_password: '',
      };
      expect(validateCredentials(creds)).toBe('Bluesky credentials require app_password');
    });

    it('checks handle before app_password', () => {
      const creds: SocialCredentials = {
        provider: 'bluesky',
        handle: '',
        app_password: '',
      };
      expect(validateCredentials(creds)).toBe('Bluesky credentials require handle');
    });
  });
});

// ── checkCredentials ────────────────────────────────────────────────

describe('checkCredentials', () => {
  it('returns null for complete credentials', () => {
    expect(checkCredentials({ provider: 'x', access_token: 'tok' })).toBeNull();
  });

  it.each<[SocialCredentials, string, string]>([
    [{ provider: 'x', access_token: '' }, 'X', 'access_token'],
    [{ provider: 'threads', access_token: '', user_id: '1' }, 'Threads', 'access_token'],
    [{ provider: 'threads', access_token: 'tok', user_id: '' }, 'Threads', 'user_id'],
    [{ provider: 'bluesky', handle: '', app_password: 'pw' }, 'Bluesky', 'handle'],
    [{ provider: 'bluesky', handle: 'u.bsky.social', app_password: '' }, 'Bluesky', 'app_password'],
  ])('names the provider and field (%#)', (creds, provider, field) => {
    expect(checkCredentials(creds)).toEqual({
      message: `${provider} credentials require ${field}`,
      provider,
      field,
    });
  });
});

// ── toCredentialHint ────────────────────────────────────────────────

describe('toCredentialHint', () => {
  describe('X provider', () => {
    it('returns account_label when present', () => {
      const creds: SocialCredentials = {
        provider: 'x',
        access_token: 'tok',
        account_label: 'My X Account',
        user_id: 'uid',
      };
      expect(toCredentialHint(creds)).toBe('My X Account');
    });

    it('falls back to user_id when account_label is absent', () => {
      const creds: SocialCredentials = {
        provider: 'x',
        access_token: 'tok',
        user_id: 'uid123',
      };
      expect(toCredentialHint(creds)).toBe('uid123');
    });

    it('falls back to "X account" when both are absent', () => {
      const creds: SocialCredentials = {
        provider: 'x',
        access_token: 'tok',
      };
      expect(toCredentialHint(creds)).toBe('X account');
    });
  });

  describe('Threads provider', () => {
    it('returns account_label when present', () => {
      const creds: SocialCredentials = {
        provider: 'threads',
        access_token: 'tok',
        user_id: 'uid',
        account_label: 'My Threads',
      };
      expect(toCredentialHint(creds)).toBe('My Threads');
    });

    it('falls back to user_id when account_label is absent', () => {
      const creds: SocialCredentials = {
        provider: 'threads',
        access_token: 'tok',
        user_id: 'uid456',
      };
      expect(toCredentialHint(creds)).toBe('uid456');
    });
  });

  describe('Bluesky provider', () => {
    it('returns handle', () => {
      const creds: SocialCredentials = {
        provider: 'bluesky',
        handle: 'user.bsky.social',
        app_password: 'pass',
      };
      expect(toCredentialHint(creds)).toBe('user.bsky.social');
    });
  });
});
