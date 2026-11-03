import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/site-url', () => ({ siteUrl: () => new URL('https://poketools.example') }));

import robots from '../robots';

describe('robots()', () => {
  it('allows the site and disallows every login, token and viewerless prefix', () => {
    const result = robots();
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rule.userAgent).toBe('*');
    expect(rule.allow).toBe('/');
    expect(rule.disallow).toEqual([
      '/api/',
      '/admin/',
      '/dashboard/',
      '/teambuilder/',
      '/creator/',
      '/broadcast/',
      '/auth/',
      '/teams/shared/',
      '/draft-room/trainer-creator',
    ]);
  });

  it('points at an absolute sitemap URL built from the site origin', () => {
    expect(robots().sitemap).toBe('https://poketools.example/sitemap.xml');
  });
});
