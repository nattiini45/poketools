import { describe, expect, it } from 'vitest';
import { isLegacyBoardPool, isLegacyPlaceholder, isQueuePool, requestedPoolId, selectPool } from '@/lib/draft-ui/select-pool';
import type { AdminPoolSummary } from '@/lib/draft-ui/snapshot-types';

const INITIAL = 'a0000000-0000-4000-8000-000000000001';
const REDRAFT = 'a0000000-0000-4000-8000-000000000002';
const LEGACY = 'a0000000-0000-4000-8000-000000000003';

function pool(id: string, over: Partial<AdminPoolSummary> = {}): AdminPoolSummary {
  return { id, engine: 'queue', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete', ...over };
}

describe('selectPool', () => {
  it('treats an unstarted legacy pool as no pool: a placeholder the initial queue pool replaces', () => {
    const placeholder = pool(LEGACY, { engine: 'legacy', status: 'pending', phase: 'setup' });
    expect(isLegacyPlaceholder(placeholder)).toBe(true);
    expect(isLegacyBoardPool(placeholder)).toBe(false);
    expect(isLegacyBoardPool(pool(LEGACY, { engine: 'legacy' }))).toBe(true);
    expect(isLegacyPlaceholder(pool(INITIAL, { status: 'pending', phase: 'setup' }))).toBe(false);
    expect(selectPool([placeholder])).toEqual({ pool: null, reason: 'none', legacyPools: [] });
  });

  it('returns none without pools', () => {
    expect(selectPool([])).toEqual({ pool: null, reason: 'none', legacyPools: [] });
  });

  it('prefers a valid ?pool= of this season', () => {
    const pools = [pool(INITIAL), pool(REDRAFT, { kind: 'redraft', status: 'in_progress', phase: 'drafting' })];
    expect(selectPool(pools, INITIAL.toUpperCase())).toEqual({ pool: pools[0], reason: 'requested', legacyPools: [] });
    expect(selectPool(pools, [INITIAL])).toEqual({ pool: pools[0], reason: 'requested', legacyPools: [] });
  });

  it('ignores an invalid or foreign ?pool=', () => {
    const pools = [pool(INITIAL, { status: 'in_progress', phase: 'drafting' })];
    expect(selectPool(pools, 'not-a-uuid').reason).toBe('in_progress');
    expect(selectPool(pools, 'b0000000-0000-4000-8000-000000000009').reason).toBe('in_progress');
  });

  it('prefers the running redraft over the running initial pool', () => {
    const pools = [
      pool(INITIAL, { status: 'in_progress', phase: 'drafting' }),
      pool(REDRAFT, { kind: 'redraft', status: 'in_progress', phase: 'drafting' }),
    ];
    expect(selectPool(pools)).toEqual({ pool: pools[1], reason: 'in_progress', legacyPools: [] });
  });

  it('shows the redraft in its submission phase', () => {
    const pools = [pool(INITIAL), pool(REDRAFT, { kind: 'redraft', status: 'pending', phase: 'submissions' })];
    expect(selectPool(pools)).toEqual({ pool: pools[1], reason: 'submissions', legacyPools: [] });
  });

  it('falls back to the initial pool, then to the newest', () => {
    const pools = [pool(INITIAL), pool(REDRAFT, { kind: 'redraft', status: 'complete', phase: 'complete' })];
    expect(selectPool(pools)).toEqual({ pool: pools[0], reason: 'initial', legacyPools: [] });
    const onlyRedraft = [pool(REDRAFT, { kind: 'redraft', status: 'pending', phase: 'setup' })];
    expect(selectPool(onlyRedraft)).toEqual({ pool: onlyRedraft[0], reason: 'latest', legacyPools: [] });
  });
});

describe('selectPool: legacy-engine pools (pre-M2)', () => {
  const legacy = pool(LEGACY, { engine: 'legacy' });

  it('never selects a legacy pool and reports a legacy-only season', () => {
    expect(selectPool([legacy])).toEqual({ pool: null, reason: 'legacy_only', legacyPools: [legacy] });
    const running = pool(LEGACY, { engine: 'legacy', status: 'in_progress', phase: 'drafting' });
    expect(selectPool([running]).pool).toBeNull();
  });

  it('ignores a ?pool= naming a legacy pool', () => {
    expect(selectPool([legacy], LEGACY)).toEqual({ pool: null, reason: 'legacy_only', legacyPools: [legacy] });
    const redraft = pool(REDRAFT, { kind: 'redraft', status: 'pending', phase: 'submissions' });
    expect(selectPool([legacy, redraft], LEGACY)).toEqual({
      pool: redraft,
      reason: 'submissions',
      legacyPools: [legacy],
    });
  });

  it('handles the queue pool of a mixed season (legacy initial + queue redraft)', () => {
    const redraft = pool(REDRAFT, { kind: 'redraft', status: 'in_progress', phase: 'drafting' });
    expect(selectPool([legacy, redraft])).toEqual({ pool: redraft, reason: 'in_progress', legacyPools: [legacy] });
    const done = pool(REDRAFT, { kind: 'redraft', status: 'complete', phase: 'complete' });
    // The legacy initial pool is not "the initial pool": the newest queue pool wins.
    expect(selectPool([legacy, done])).toEqual({ pool: done, reason: 'latest', legacyPools: [legacy] });
  });

  it('treats only engine "queue" as a queue pool', () => {
    expect(isQueuePool({ engine: 'queue' })).toBe(true);
    expect(isQueuePool({ engine: 'legacy' })).toBe(false);
  });
});

describe('requestedPoolId', () => {
  it('accepts only uuids', () => {
    expect(requestedPoolId(undefined)).toBeNull();
    expect(requestedPoolId('')).toBeNull();
    expect(requestedPoolId('../x')).toBeNull();
    expect(requestedPoolId(INITIAL)).toBe(INITIAL);
  });
});
