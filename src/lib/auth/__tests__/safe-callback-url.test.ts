import { describe, expect, it } from 'vitest';
import { sanitizeCallbackUrl } from '../safe-callback-url';

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
