import { describe, it, expect } from 'vitest';
import { parsePagination, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../pagination';

function sp(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe('parsePagination', () => {
  it('defaults limit and offset when absent', () => {
    const result = parsePagination(sp(''));
    expect(result.limit).toBe(DEFAULT_PAGE_LIMIT);
    expect(result.offset).toBe(0);
    expect(result.search).toBeUndefined();
  });

  it('passes an in-range limit through', () => {
    expect(parsePagination(sp('limit=30')).limit).toBe(30);
  });

  it('clamps limit=0 up to 1 (not the default)', () => {
    expect(parsePagination(sp('limit=0')).limit).toBe(1);
  });

  it('clamps negative limits up to 1', () => {
    expect(parsePagination(sp('limit=-5')).limit).toBe(1);
  });

  it('clamps oversized limits down to maxLimit', () => {
    expect(parsePagination(sp('limit=1000000')).limit).toBe(MAX_PAGE_LIMIT);
  });

  it('falls back to the default for non-numeric limit', () => {
    expect(parsePagination(sp('limit=abc')).limit).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('honors custom defaultLimit and maxLimit options', () => {
    expect(parsePagination(sp(''), { defaultLimit: 20 }).limit).toBe(20);
    expect(parsePagination(sp('limit=500'), { maxLimit: 100 }).limit).toBe(100);
    expect(parsePagination(sp('limit=0'), { defaultLimit: 20 }).limit).toBe(1);
  });

  it('clamps negative and non-numeric offsets to 0', () => {
    expect(parsePagination(sp('offset=-3')).offset).toBe(0);
    expect(parsePagination(sp('offset=abc')).offset).toBe(0);
    expect(parsePagination(sp('offset=25')).offset).toBe(25);
  });

  it('trims search and treats empty/whitespace as undefined', () => {
    expect(parsePagination(sp('search=%20%20')).search).toBeUndefined();
    expect(parsePagination(sp('search=%20pika%20')).search).toBe('pika');
    expect(parsePagination(sp('')).search).toBeUndefined();
  });
});
