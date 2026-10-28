import { describe, expect, it } from 'vitest';
import { deviceLabelFromUserAgent } from '../user-agent';

describe('deviceLabelFromUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge on Windows',
    ],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0', 'Firefox on Windows'],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'Safari on macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Safari on iOS',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
      'Chrome on iPadOS',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', 'Firefox on Linux'],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
      'Samsung Internet on Android',
    ],
  ])('labels %s', (ua, label) => {
    expect(deviceLabelFromUserAgent(ua)).toBe(label);
  });

  it('returns null without a usable User-Agent and never echoes the raw string', () => {
    expect(deviceLabelFromUserAgent(null)).toBeNull();
    expect(deviceLabelFromUserAgent(undefined)).toBeNull();
    expect(deviceLabelFromUserAgent('')).toBeNull();
    expect(deviceLabelFromUserAgent('curl/8.0')).toBeNull();
    const label = deviceLabelFromUserAgent('x'.repeat(5000) + ' Firefox/1 Windows');
    expect(label === null || label.length <= 80).toBe(true);
  });
});
