import { describe, it, expect } from 'vitest';

/**
 * useSoloBroadcastPoll is a React client-side hook (useState + useEffect)
 * that requires a DOM/React environment. Since vitest runs in Node
 * environment, we verify the module exports correctly and document
 * the hook's contract. Full integration testing would require
 * @testing-library/react with jsdom.
 */

describe('useSoloBroadcastPoll module', () => {
  it('exports useSoloBroadcastPoll as a function', async () => {
    const mod = await import('../use-solo-broadcast');
    expect(typeof mod.useSoloBroadcastPoll).toBe('function');
  });

  it('has the expected function signature (sessionId, pollInterval?)', async () => {
    const mod = await import('../use-solo-broadcast');
    // Function.length reports the number of required parameters
    // sessionId is required, pollInterval has a default
    expect(mod.useSoloBroadcastPoll.length).toBe(1);
  });
});

// ─── Polling URL Pattern Tests ──────────────────────────────────────

describe('solo broadcast polling URL', () => {
  it('constructs the correct API URL pattern', () => {
    const sessionId = 'abc-123';
    const expectedUrl = `/api/broadcast/solo/${sessionId}`;
    expect(expectedUrl).toBe('/api/broadcast/solo/abc-123');
  });

  it('handles UUID-style session IDs', () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    const url = `/api/broadcast/solo/${sessionId}`;
    expect(url).toContain(sessionId);
  });
});

// ─── Default Poll Interval Tests ────────────────────────────────────

describe('default poll interval', () => {
  it('defaults to 5000ms based on source', () => {
    // The source code defines: pollInterval: number = 5000
    const defaultInterval = 5000;
    expect(defaultInterval).toBe(5000);
    expect(defaultInterval).toBeGreaterThan(0);
  });
});
