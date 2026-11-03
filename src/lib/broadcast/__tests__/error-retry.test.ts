import { describe, expect, it } from 'vitest';
import { MAX_ERROR_RETRY_MS, createErrorRetryTracker, errorRetryDelayMs } from '../error-retry';

describe('errorRetryDelayMs', () => {
  it('starts at 2 s, doubles and caps at 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(errorRetryDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(errorRetryDelayMs(99)).toBe(MAX_ERROR_RETRY_MS);
  });

  it('treats a bad attempt number as the first one', () => {
    expect(errorRetryDelayMs(-3)).toBe(2000);
    expect(errorRetryDelayMs(Number.NaN)).toBe(2000);
  });
});

describe('createErrorRetryTracker', () => {
  it('backs off across consecutive failures', () => {
    let t = 0;
    const tracker = createErrorRetryTracker(() => t);
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      delays.push(tracker.nextDelayMs());
      t += 5_000;
    }
    expect(delays).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('starts over once the overlay has been quiet for a while', () => {
    let t = 0;
    const tracker = createErrorRetryTracker(() => t);
    tracker.nextDelayMs();
    t += 1_000;
    tracker.nextDelayMs();
    t += 10 * 60_000;
    expect(tracker.nextDelayMs()).toBe(2000);
  });
});
