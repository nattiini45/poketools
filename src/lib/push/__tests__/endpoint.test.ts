import { describe, expect, it } from 'vitest';
import { isAllowedPushEndpoint, parsePushEndpoint, pushEndpointHost, PUSH_ENDPOINT_MAX_LENGTH } from '../endpoint';

describe('push endpoint allow-list', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:APA91b',
    'https://fcm.googleapis.com/wp/abc',
    'https://jmt17.google.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://autopush.prod.mozaws.net.push.services.mozilla.com/wpush/v2/x',
    'https://db5p.notify.windows.com/w/?token=BQYAAAB',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
    'https://web.push.apple.com/QGh1abc',
    'https://api.development.push.apple.com/3/device/abc',
  ])('accepts %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ['plain http', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['an unknown host', 'https://push.example.com/abc'],
    ['an internal address', 'https://127.0.0.1/abc'],
    ['localhost', 'https://localhost/abc'],
    ['a cloud metadata host', 'https://169.254.169.254/latest/meta-data'],
    ['a look-alike prefix', 'https://evilfcm.googleapis.com/x'],
    ['an allowed host as a subdomain of another domain', 'https://fcm.googleapis.com.evil.test/x'],
    ['the suffix itself without a label', 'https://notify.windows.com/x'],
    ['a suffix glued to another label', 'https://evilnotify.windows.com/x'],
    ['credentials in the URL', 'https://user:pass@fcm.googleapis.com/x'],
    ['an explicit port', 'https://fcm.googleapis.com:8443/x'],
    ['a fragment', 'https://fcm.googleapis.com/x#frag'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:text/plain,hi'],
    ['not a URL', 'fcm.googleapis.com/x'],
    ['an empty string', ''],
  ])('refuses %s', (_label, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  it('refuses non-strings and over-long endpoints', () => {
    expect(isAllowedPushEndpoint(undefined)).toBe(false);
    expect(isAllowedPushEndpoint(42)).toBe(false);
    expect(isAllowedPushEndpoint(null)).toBe(false);
    const long = `https://fcm.googleapis.com/${'a'.repeat(PUSH_ENDPOINT_MAX_LENGTH)}`;
    expect(isAllowedPushEndpoint(long)).toBe(false);
  });

  it('treats the host case-insensitively (URL lower-cases it) and keeps the parsed URL', () => {
    expect(parsePushEndpoint('https://FCM.GoogleAPIs.com/fcm/send/x')?.hostname).toBe('fcm.googleapis.com');
  });

  it('logs only the host of an endpoint', () => {
    expect(pushEndpointHost('https://fcm.googleapis.com/fcm/send/secret-token')).toBe('fcm.googleapis.com');
    expect(pushEndpointHost('nonsense')).toBe('invalid');
  });
});
