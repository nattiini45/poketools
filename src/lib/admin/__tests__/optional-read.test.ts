import { afterEach, describe, expect, it, vi } from 'vitest';
import { readOptional } from '../optional-read';

afterEach(() => vi.restoreAllMocks());

describe('readOptional', () => {
  it('returns the value of a read that succeeds', async () => {
    await expect(readOptional('history', Promise.resolve(5), 0)).resolves.toEqual({ value: 5, failed: false });
  });

  it('logs a failed read and returns the fallback instead of throwing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await readOptional('history', Promise.reject(new Error('db down')), 'fallback');
    expect(result).toEqual({ value: 'fallback', failed: true });
    expect(log).toHaveBeenCalledTimes(1);
  });
});
