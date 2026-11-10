import { describe, expect, it } from 'vitest';
import { canRoundEvent } from '../round-state';
import type { RoundStatus } from '@/types/round';

describe('canRoundEvent: the round manager offers what it offered before the machine', () => {
  it.each<[RoundStatus, boolean, boolean, boolean]>([
    ['pending', true, false, false],
    ['active', false, true, true],
    ['completed', false, false, true],
  ])('%s: start %s, complete %s, reset %s', (status, start, complete, reset) => {
    expect(canRoundEvent(status, 'start', 'admin')).toBe(start);
    expect(canRoundEvent(status, 'complete', 'admin')).toBe(complete);
    expect(canRoundEvent(status, 'reset', 'admin')).toBe(reset);
  });
});
