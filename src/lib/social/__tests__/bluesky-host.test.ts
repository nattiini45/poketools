import { describe, expect, it } from 'vitest';
import {
  checkBlueskyServiceUrl,
  DEFAULT_BLUESKY_SERVICE_URL,
  parseHostAllowlist,
  type BlueskyServiceUrlRejection,
} from '../bluesky-host';

describe('checkBlueskyServiceUrl', () => {
  it.each([undefined, null, '', '   '])('treats %j as the default server', (value) => {
    expect(checkBlueskyServiceUrl(value)).toEqual({ ok: true, origin: DEFAULT_BLUESKY_SERVICE_URL });
  });

  it.each(['https://bsky.social', 'https://bsky.social/', 'https://BSKY.social', ' https://bsky.social '])(
    'accepts %s',
    (value) => {
      expect(checkBlueskyServiceUrl(value)).toEqual({ ok: true, origin: 'https://bsky.social' });
    },
  );

  it('accepts the default port written out', () => {
    expect(checkBlueskyServiceUrl('https://bsky.social:443')).toEqual({ ok: true, origin: 'https://bsky.social' });
  });

  const rejected: [string, BlueskyServiceUrlRejection][] = [
    ['not a url', 'invalid_url'],
    ['bsky.social', 'invalid_url'],
    ['http://bsky.social', 'not_https'],
    ['ftp://bsky.social', 'not_https'],
    ['https://user@bsky.social', 'userinfo'],
    ['https://user:pw@bsky.social', 'userinfo'],
    ['https://bsky.social:8443', 'port'],
    ['https://bsky.social:80', 'port'],
    ['https://127.0.0.1', 'ip_literal'],
    ['https://10.0.0.5', 'ip_literal'],
    ['https://169.254.169.254', 'ip_literal'],
    ['https://2130706433', 'ip_literal'],
    ['https://0x7f.1', 'ip_literal'],
    ['https://[::1]', 'ip_literal'],
    ['https://[fe80::1]', 'ip_literal'],
    ['https://[::ffff:127.0.0.1]', 'ip_literal'],
    ['https://localhost', 'local_host'],
    ['https://LOCALHOST', 'local_host'],
    ['https://app.localhost', 'local_host'],
    ['https://printer.local', 'local_host'],
    ['https://pds.internal', 'local_host'],
    ['https://bsky.social/xrpc', 'path'],
    ['https://bsky.social/?next=https://evil.example', 'path'],
    ['https://bsky.social/#frag', 'path'],
    ['https://evil.example', 'host_not_allowed'],
    ['https://bsky.social.evil.example', 'host_not_allowed'],
    ['https://evilbsky.social', 'host_not_allowed'],
    ['https://bsky.social.', 'host_not_allowed'],
  ];

  it.each(rejected)('rejects %s as %s', (value, reason) => {
    expect(checkBlueskyServiceUrl(value, ['pds.example.org'])).toEqual({ ok: false, reason });
  });

  it('accepts a host the operator allowlisted, and only that host', () => {
    expect(checkBlueskyServiceUrl('https://pds.example.org', ['pds.example.org'])).toEqual({
      ok: true,
      origin: 'https://pds.example.org',
    });
    expect(checkBlueskyServiceUrl('https://other.example.org', ['pds.example.org'])).toEqual({
      ok: false,
      reason: 'host_not_allowed',
    });
    expect(checkBlueskyServiceUrl('https://pds.example.org')).toEqual({ ok: false, reason: 'host_not_allowed' });
  });

  it('keeps refusing private hosts that sit in the allowlist', () => {
    expect(checkBlueskyServiceUrl('https://localhost', ['localhost'])).toMatchObject({ ok: false });
    expect(checkBlueskyServiceUrl('https://10.0.0.5', ['10.0.0.5'])).toMatchObject({ ok: false });
  });
});

describe('parseHostAllowlist', () => {
  it('returns nothing for an unset or empty value', () => {
    expect(parseHostAllowlist(undefined)).toEqual([]);
    expect(parseHostAllowlist('')).toEqual([]);
  });

  it('splits, trims and lowercases', () => {
    expect(parseHostAllowlist(' PDS.example.org , eu.example.net ')).toEqual(['pds.example.org', 'eu.example.net']);
  });

  it('drops entries that are not plain public hostnames', () => {
    expect(
      parseHostAllowlist(
        'localhost,127.0.0.1,[::1],a.local,b.internal,https://c.example,d.example:8443,e.example/x,*.example.org,ok.example.org',
      ),
    ).toEqual(['ok.example.org']);
  });
});
