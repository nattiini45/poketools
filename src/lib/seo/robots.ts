import type { Metadata } from 'next';

/** Page metadata for a route a crawler must not index (login, token or viewerless pages). */
export const NOINDEX: NonNullable<Metadata['robots']> = { index: false, follow: false };

/**
 * The path prefixes `robots.txt` keeps crawlers out of: every one is behind a login, is a bearer-token page,
 * a viewerless overlay or an API route. `robots.txt` alone does not stop indexing of a page linked from elsewhere,
 * so each prefix also carries `NOINDEX` page metadata (layout or page) where it renders HTML.
 */
export const ROBOTS_DISALLOW = [
  '/api/',
  '/admin/',
  '/dashboard/',
  '/teambuilder/',
  '/creator/',
  '/broadcast/',
  '/auth/',
  '/teams/shared/',
  '/draft-room/trainer-creator',
] as const;
