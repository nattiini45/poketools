/**
 * `draftKillTokensPerProgress` (pack field `epb.participationPoints.draftKillTokensPerProgress`): the Draft Kill Token
 * rate of a participation line, falling back to `comebackTokensPerProgress` when the pack does not set it. The active
 * pack is replaced per test, so the fallback is proven with values that differ from the example pack's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pp = vi.hoisted(() => ({
  value: { comebackTokensPerProgress: 1 } as { comebackTokensPerProgress: number; draftKillTokensPerProgress?: number },
}));

vi.mock('../active', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../active')>();
  return {
    ...actual,
    formatPack: {
      ...actual.formatPack,
      epb: {
        ...actual.formatPack.epb,
        get participationPoints() {
          return { ...actual.formatPack.epb.participationPoints, ...pp.value };
        },
      },
    },
  };
});

import { draftKillTokensPerProgress } from '..';

describe('draftKillTokensPerProgress', () => {
  beforeEach(() => {
    pp.value = { comebackTokensPerProgress: 1 };
  });

  it('is 1 on every line that is not a participation line, whatever the pack says', () => {
    pp.value = { comebackTokensPerProgress: 3, draftKillTokensPerProgress: 4 };
    expect(draftKillTokensPerProgress(false)).toBe(1);
  });

  it('falls back to the comeback rate when the pack sets no draft kill rate of its own', () => {
    pp.value = { comebackTokensPerProgress: 2 };
    expect(draftKillTokensPerProgress(true)).toBe(2);
  });

  it('uses the draft kill rate of the pack when it sets one, independent of the comeback rate', () => {
    pp.value = { comebackTokensPerProgress: 2, draftKillTokensPerProgress: 3 };
    expect(draftKillTokensPerProgress(true)).toBe(3);
    pp.value = { comebackTokensPerProgress: 1, draftKillTokensPerProgress: 2 };
    expect(draftKillTokensPerProgress(true)).toBe(2);
  });
});
