import { describe, expect, it } from 'vitest';
import { CostGuard } from '../cost-guard';
import { baseModelId, callCostUsd, estimateTokens, priceOf, pricedModels, worstCaseCostUsd } from '../pricing';

describe('pricing', () => {
  it('prices Sonnet 5.5 at $2 in, $10 out, $0.20 cache read, $2.50 cache write per million tokens', () => {
    const price = priceOf('claude-sonnet-5-5')!;
    expect(price).toEqual({ inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 });
    expect(callCostUsd('claude-sonnet-5-5', { promptTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, completionTokens: 0 })).toBeCloseTo(2, 10);
    expect(callCostUsd('claude-sonnet-5-5', { promptTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, completionTokens: 1_000_000 })).toBeCloseTo(10, 10);
  });

  it('prices Haiku 5.5 at $0.10 in and $0.50 out', () => {
    expect(callCostUsd('claude-haiku-5-5', { promptTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, completionTokens: 1_000_000 })).toBeCloseTo(0.6, 10);
  });

  it('splits the prompt into fresh input, cache reads and cache writes (the prompt total includes both)', () => {
    // 100k prompt tokens: 60k read from the cache, 10k written, 30k fresh; 1k output.
    const cost = callCostUsd('claude-sonnet-5-5', { promptTokens: 100_000, cacheReadTokens: 60_000, cacheWriteTokens: 10_000, completionTokens: 1_000 });
    expect(cost).toBeCloseTo((30_000 * 2 + 60_000 * 0.2 + 10_000 * 2.5 + 1_000 * 10) / 1_000_000, 10);
  });

  it('treats a dated id as its base id and refuses a model it cannot price', () => {
    expect(baseModelId('claude-sonnet-5-5-20261001')).toBe('claude-sonnet-5-5');
    expect(priceOf('claude-sonnet-5-5-20261001')).toEqual(priceOf('claude-sonnet-5-5'));
    expect(priceOf('claude-unknown-9')).toBeNull();
    expect(callCostUsd('claude-unknown-9', { promptTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, completionTokens: 1 })).toBeNull();
    expect(() => worstCaseCostUsd('claude-unknown-9', 1, 1)).toThrow(/no price/);
    expect(pricedModels()).toContain('claude-haiku-5-5');
  });

  it('the worst case of a call is the whole prompt plus a full output cap', () => {
    expect(worstCaseCostUsd('claude-sonnet-5-5', 10_000, 16_000)).toBeCloseTo((10_000 * 2 + 16_000 * 10) / 1_000_000, 10);
  });

  it('estimates tokens on the high side', () => {
    expect(estimateTokens('x'.repeat(300))).toBe(100);
  });
});

describe('CostGuard', () => {
  it('reserves, settles with the real cost and tracks the total', async () => {
    const guard = new CostGuard(1);
    const r = await guard.reserve(0.4);
    expect(r).not.toBeNull();
    expect(guard.committedUsd).toBeCloseTo(0.4);
    guard.settle(r!, 0.05);
    expect(guard.spentUsd).toBeCloseTo(0.05);
    expect(guard.committedUsd).toBeCloseTo(0.05);
    guard.settle(r!, 99); // settling twice changes nothing
    expect(guard.spentUsd).toBeCloseTo(0.05);
  });

  it('refuses a call whose worst case could pass the cap and stays stopped afterwards, even for a smaller call', async () => {
    const guard = new CostGuard(0.5);
    const first = await guard.reserve(0.3);
    guard.settle(first!, 0.3);
    expect(await guard.reserve(0.3)).toBeNull();
    expect(guard.stopped).toBe(true);
    expect(guard.stoppedAt).toBeCloseTo(0.3);
    expect(await guard.reserve(0.01)).toBeNull();
  });

  it('never lets spent plus reserved pass the cap', async () => {
    const guard = new CostGuard(1);
    const a = await guard.reserve(0.6);
    const b = guard.reserve(0.6); // does not fit next to `a`: waits for it
    let settled = false;
    void b.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(guard.committedUsd).toBeCloseTo(0.6);
    guard.settle(a!, 0.1); // the call was cheaper than its worst case
    const second = await b;
    expect(second).not.toBeNull();
    expect(guard.committedUsd).toBeLessThanOrEqual(1);
  });

  it('refuses a waiting call once nothing is in flight and it still does not fit', async () => {
    const guard = new CostGuard(0.5);
    const a = await guard.reserve(0.4);
    const b = guard.reserve(0.4);
    guard.settle(a!, 0.4);
    expect(await b).toBeNull();
    expect(guard.stopped).toBe(true);
  });

  it('counts what an earlier run spent toward the cap', async () => {
    const guard = new CostGuard(1, 0.9);
    expect(await guard.reserve(0.2)).toBeNull();
    expect(guard.stoppedAt).toBeCloseTo(0.9);
  });

  it('rejects a cap that is not a positive number', () => {
    expect(() => new CostGuard(0)).toThrow();
    expect(() => new CostGuard(Number.NaN)).toThrow();
  });
});
