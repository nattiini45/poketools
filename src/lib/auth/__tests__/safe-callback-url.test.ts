import { describe, expect, it } from 'vitest';
import { sanitizeCallbackUrl, signInPath } from '../safe-callback-url';

describe('sanitizeCallbackUrl', () => {
  it('keeps a same-origin path with its query and hash', () => {
    expect(sanitizeCallbackUrl('/leagues/abc?tab=matches#round-2')).toBe('/leagues/abc?tab=matches#round-2');
    expect(sanitizeCallbackUrl('/')).toBe('/');
  });

  it('falls back for anything a browser could read as another host or a scheme (#30)', () => {
    for (const raw of [
      '//evil.example',
      '/\\evil.example',
      '/\\/evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/ /evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      'evil.example',
      '',
      '/'.padEnd(3000, 'a'),
    ]) {
      expect(sanitizeCallbackUrl(raw), JSON.stringify(raw)).toBe('/');
    }
    expect(sanitizeCallbackUrl(undefined)).toBe('/');
    expect(sanitizeCallbackUrl(null, '/dashboard')).toBe('/dashboard');
  });

  it('normalises dot segments instead of passing them through', () => {
    expect(sanitizeCallbackUrl('/a/../b')).toBe('/b');
  });
});

describe('signInPath (#56)', () => {
  it('carries the requested path as a percent-encoded callbackUrl', () => {
    expect(signInPath('/dashboard/confirm/abc')).toBe('/auth/signin?callbackUrl=%2Fdashboard%2Fconfirm%2Fabc');
  });

  it('keeps the query string and the hash inside the callbackUrl', () => {
    const href = signInPath('/dashboard/submit/m1?tab=y&x=a%20b');
    expect(href).toBe(`/auth/signin?callbackUrl=${encodeURIComponent('/dashboard/submit/m1?tab=y&x=a%20b')}`);
    expect(new URL(href, 'https://x.test').searchParams.get('callbackUrl')).toBe('/dashboard/submit/m1?tab=y&x=a%20b');
  });

  it('is the bare sign-in page without a return path', () => {
    expect(signInPath()).toBe('/auth/signin');
    expect(signInPath(null)).toBe('/auth/signin');
    expect(signInPath('')).toBe('/auth/signin');
  });

  it('never points the sign-in page at itself or another auth page', () => {
    expect(signInPath('/auth/signin')).toBe('/auth/signin');
    expect(signInPath('/auth/signin?callbackUrl=%2Fx')).toBe('/auth/signin');
    expect(signInPath('/auth/signup')).toBe('/auth/signin');
    expect(signInPath('/auth')).toBe('/auth/signin');
  });

  it('does not add a callbackUrl that would only mean the home page', () => {
    expect(signInPath('/')).toBe('/auth/signin');
  });

  it('drops hostile or malformed return paths instead of encoding them', () => {
    for (const raw of ['//evil.example', '/\\evil.example', 'https://evil.example/', 'javascript:alert(1)', '/\n/x', '/'.padEnd(3000, 'a')]) {
      expect(signInPath(raw), JSON.stringify(raw)).toBe('/auth/signin');
    }
  });

  it('round-trips through the sign-in page sanitiser', () => {
    const target = '/dashboard/settings?tab=security';
    const callback = new URL(signInPath(target), 'https://x.test').searchParams.get('callbackUrl');
    expect(sanitizeCallbackUrl(callback)).toBe(target);
  });
});
