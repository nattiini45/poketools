import { describe, expect, it } from 'vitest';
import {
  MAX_POLL_BACKOFF_MS,
  MAX_RETRY_AFTER_MS,
  nextPollDelayMs,
  parseRetryAfterMs,
  pollResultFromResponse,
} from '../poll-schedule';

describe('parseRetryAfterMs', () => {
  it('reads whole seconds', () => {
    expect(parseRetryAfterMs('10')).toBe(10_000);
    expect(parseRetryAfterMs(' 3 ')).toBe(3_000);
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('ignores a missing, negative, fractional or non-numeric value', () => {
    for (const bad of [null, undefined, '', '-4', '1.5', 'soon', 'Wed, 21 Oct 2026 07:28:00 GMT']) {
      expect(parseRetryAfterMs(bad)).toBeNull();
    }
  });
});

describe('nextPollDelayMs', () => {
  it('keeps the base interval while polls succeed', () => {
    expect(nextPollDelayMs(2000, 0, null)).toBe(2000);
  });

  it('doubles per consecutive failure and caps at 30 s', () => {
    expect(nextPollDelayMs(2000, 1, null)).toBe(4000);
    expect(nextPollDelayMs(2000, 2, null)).toBe(8000);
    expect(nextPollDelayMs(2000, 5, null)).toBe(MAX_POLL_BACKOFF_MS);
    expect(nextPollDelayMs(2000, 40, null)).toBe(MAX_POLL_BACKOFF_MS);
  });

  it('never goes below the caster-chosen base interval, even above the cap', () => {
    expect(nextPollDelayMs(60_000, 3, null)).toBe(60_000);
  });

  it('waits at least as long as the server asked', () => {
    expect(nextPollDelayMs(1000, 1, 10_000)).toBe(10_000);
    expect(nextPollDelayMs(5000, 1, 7_000)).toBe(10_000);
  });

  it('bounds an absurd Retry-After', () => {
    expect(nextPollDelayMs(1000, 1, 86_400_000)).toBe(MAX_RETRY_AFTER_MS);
  });
});

describe('pollResultFromResponse', () => {
  it('is ok for a 2xx', () => {
    expect(pollResultFromResponse(new Response('{}', { status: 200 }))).toEqual({ ok: true });
  });

  it('carries Retry-After from a 429', () => {
    const res = new Response('{}', { status: 429, headers: { 'Retry-After': '10' } });
    expect(pollResultFromResponse(res)).toEqual({ ok: false, retryAfterMs: 10_000 });
  });

  it('is a plain failure for other errors', () => {
    expect(pollResultFromResponse(new Response('{}', { status: 500 }))).toEqual({ ok: false, retryAfterMs: null });
  });
});
