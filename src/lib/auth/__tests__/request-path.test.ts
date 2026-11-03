import { describe, expect, it } from 'vitest';
import { requestPathOf } from '../request-path';

const url = (s: string) => new URL(s, 'https://x.test');

describe('requestPathOf', () => {
  it('keeps the path and the query', () => {
    expect(requestPathOf(url('/dashboard/submit/m1?tab=y'))).toBe('/dashboard/submit/m1?tab=y');
    expect(requestPathOf(url('/dashboard'))).toBe('/dashboard');
  });

  it('drops the _rsc parameter of a client navigation but keeps the rest', () => {
    expect(requestPathOf(url('/dashboard?_rsc=abc12'))).toBe('/dashboard');
    expect(requestPathOf(url('/dashboard?tab=a&_rsc=abc12'))).toBe('/dashboard?tab=a');
  });
});
