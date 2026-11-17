import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));

import { createProcessAggregatesHandler } from '../process-aggregates';
import { AggregateQueueClaimError, AggregateQueueRunError, AggregateQueueWriteError } from '../aggregate-queue';

beforeEach(() => vi.stubEnv('CRON_SECRET', 'fixture-secret'));
afterEach(() => vi.unstubAllEnvs());

describe('aggregate maintenance failure responses', () => {
  const claim = () => new AggregateQueueClaimError({ cause: new Error('Fixture claim failure') });
  const write = () => new AggregateQueueWriteError('Fixture queue write failure', { cause: new Error('Fixture write failure') });

  it.each([
    ['one wrapped claim failure', () => [claim()], 'aggregate_claim_failed', 'Failed to claim aggregate jobs'],
    ['both claims failing', () => [claim(), claim()], 'aggregate_claim_failed', 'Failed to claim aggregate jobs'],
    ['processing failures', () => [write(), write()], 'aggregate_queue_failed', 'Failed to process aggregate jobs'],
    ['claim and processing failures', () => [claim(), write()], 'aggregate_claim_and_queue_failed', 'Aggregate jobs failed during both claiming and processing'],
    ['processing and claim failures', () => [write(), claim()], 'aggregate_claim_and_queue_failed', 'Aggregate jobs failed during both claiming and processing'],
  ] as const)('distinguishes %s', async (_label, failures, code, error) => {
    const health = vi.fn();
    const countFailed = vi.fn();
    const handler = createProcessAggregatesHandler({
      process: vi.fn().mockRejectedValue(new AggregateQueueRunError({ processed: 2, failed: 1, reclaimed: 0 }, failures())),
      health,
      countFailed,
    });
    const response = await handler(new Request('http://localhost/api/cron/process-aggregates', {
      headers: { authorization: 'Bearer fixture-secret' },
    }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error, code });
    expect(health).not.toHaveBeenCalled();
    expect(countFailed).not.toHaveBeenCalled();
  });
});
