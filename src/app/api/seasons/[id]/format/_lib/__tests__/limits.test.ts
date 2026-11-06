import { describe, expect, it } from 'vitest';
import * as limits from '../limits';

const ALL = Object.values(limits);

describe('live-format route rate limits', () => {
  it('has the nine buckets of the design, each with a valid, distinct bucket name', () => {
    expect(ALL).toHaveLength(9);
    const names = ALL.map((limit) => limit.bucket);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^format-[a-z-]+$/);
  });

  it('keeps every limit and window inside what the limiter accepts', () => {
    for (const limit of ALL) {
      expect(Number.isInteger(limit.limit) && limit.limit >= 1).toBe(true);
      expect(Number.isInteger(limit.windowSeconds) && limit.windowSeconds >= 1 && limit.windowSeconds <= 7 * 24 * 3600).toBe(true);
    }
  });

  it('fails closed on exactly the two routes that write rows after a full context load', () => {
    const closed = ALL.filter((limit) => limit.failMode === 'closed').map((limit) => limit.bucket);
    expect(closed.sort()).toEqual(['format-adjust', 'format-challenge-make']);
  });
});
