import { describe, expect, it } from 'vitest';
import { formatShareLimitMark, isRouterPrefetch, parseShareLimitMark } from '../share-limit-marker';

describe('share limit marker', () => {
  it('round-trips an allowed and a denied verdict', () => {
    expect(parseShareLimitMark(formatShareLimitMark({ allowed: true }))).toEqual({ allowed: true });
    expect(parseShareLimitMark(formatShareLimitMark({ allowed: false, retryAfterSeconds: 41 }))).toEqual({
      allowed: false,
      retryAfterSeconds: 41,
    });
  });

  it('rounds a retry time up to whole seconds and never below one', () => {
    expect(formatShareLimitMark({ allowed: false, retryAfterSeconds: 0 })).toBe('denied:1');
    expect(formatShareLimitMark({ allowed: false, retryAfterSeconds: 2.2 })).toBe('denied:3');
  });

  it.each([null, undefined, '', 'true', '1', 'ALLOWED', 'allowed:1', 'denied', 'denied:', 'denied:0', 'denied:-3', 'denied:1.5', 'denied:123456', 'denied:5; x'])(
    'reads %j as no verdict, so the page charges for itself',
    (value) => {
      expect(parseShareLimitMark(value)).toBeNull();
    },
  );
});

describe('isRouterPrefetch', () => {
  it('recognises both prefetch markers', () => {
    expect(isRouterPrefetch(new Headers({ 'next-router-prefetch': '1' }))).toBe(true);
    expect(isRouterPrefetch(new Headers({ purpose: 'prefetch' }))).toBe(true);
  });

  it('treats a plain navigation as interactive', () => {
    expect(isRouterPrefetch(new Headers({ 'x-forwarded-for': '203.0.113.7' }))).toBe(false);
    expect(isRouterPrefetch(new Headers({ purpose: 'navigate' }))).toBe(false);
  });
});