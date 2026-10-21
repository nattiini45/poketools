import { describe, expect, it } from 'vitest';
import { computeKillTokens } from '../point-buy-engine';
import { comebackTokensFromTable, epbPack } from '@/lib/format-pack';
import {
  comebackBalance,
  comebackSpendOpen,
  comebackTokensForLoss,
  draftKillLineRefusal,
  draftKillTokenCheck,
  draftKillTokenWindow,
  nextThresholdFor,
} from '../tokens';

describe('nextThresholdFor (cumulative thresholds)', () => {
  const threeStage = { stage2_kos: 4, stage3_kos: 14 };
  const twoStage = { stage2_kos: 3, stage3_kos: null };

  it('stage 1 → stage-2 threshold, stage 2 → stage-3 threshold, stage 3 → null', () => {
    expect(nextThresholdFor(threeStage, 1)).toBe(4);
    expect(nextThresholdFor(threeStage, 2)).toBe(14);
    expect(nextThresholdFor(threeStage, 3)).toBeNull();
  });

  it('a two-stage line is fully evolved at stage 2', () => {
    expect(nextThresholdFor(twoStage, 1)).toBe(3);
    expect(nextThresholdFor(twoStage, 2)).toBeNull();
  });
});

describe('draftKillTokenCheck — a Draft Kill Token may never directly trigger an evolution', () => {
  it('Igglybuff-like line (needs 1): refused at 0 progress', () => {
    expect(draftKillTokenCheck({ totalProgress: 0, nextThreshold: 1 })).toEqual({
      ok: false,
      code: 'TOKEN_WOULD_EVOLVE',
      params: { next: 1, progress: 0 },
    });
  });

  it('Chikorita-like line (needs 2): 0 → 1 is allowed, 1 → 2 is refused', () => {
    expect(draftKillTokenCheck({ totalProgress: 0, nextThreshold: 2 })).toEqual({ ok: true });
    expect(draftKillTokenCheck({ totalProgress: 1, nextThreshold: 2 })).toMatchObject({ ok: false, code: 'TOKEN_WOULD_EVOLVE' });
  });

  it('a line at 4/5 is refused; 3/5 is allowed', () => {
    expect(draftKillTokenCheck({ totalProgress: 4, nextThreshold: 5 })).toEqual({
      ok: false,
      code: 'TOKEN_WOULD_EVOLVE',
      params: { next: 5, progress: 4 },
    });
    expect(draftKillTokenCheck({ totalProgress: 3, nextThreshold: 5 })).toEqual({ ok: true });
  });

  it('progress already at or past the threshold (stage not yet rechecked) is refused', () => {
    expect(draftKillTokenCheck({ totalProgress: 6, nextThreshold: 5 })).toMatchObject({ code: 'TOKEN_WOULD_EVOLVE' });
  });

  it('stage 3 (no next threshold) → LINE_FULLY_EVOLVED', () => {
    const next = nextThresholdFor({ stage2_kos: 4, stage3_kos: 14 }, 3);
    expect(draftKillTokenCheck({ totalProgress: 20, nextThreshold: next })).toEqual({ ok: false, code: 'LINE_FULLY_EVOLVED' });
  });

  it('at stage 2 the token is checked against the cumulative stage-3 threshold', () => {
    const next = nextThresholdFor({ stage2_kos: 4, stage3_kos: 14 }, 2);
    expect(draftKillTokenCheck({ totalProgress: 12, nextThreshold: next })).toEqual({ ok: true });
    expect(draftKillTokenCheck({ totalProgress: 13, nextThreshold: next })).toMatchObject({ code: 'TOKEN_WOULD_EVOLVE' });
  });
});

describe('draftKillTokenWindow', () => {
  const now = new Date('2026-10-20T12:00:00Z');

  it('is "before" until the initial draft is complete', () => {
    for (const initialPhase of [null, 'setup', 'drafting', 'cancelled'] as const) {
      expect(draftKillTokenWindow({ initialPhase, closesAt: null, anyLeagueMatchConfirmed: false, now })).toBe('before');
    }
  });

  it('with an explicit cutoff: open strictly before it, closed at/after it (match results do not matter)', () => {
    const base = { initialPhase: 'complete' as const, anyLeagueMatchConfirmed: true, now };
    expect(draftKillTokenWindow({ ...base, closesAt: '2026-10-20T12:00:01Z' })).toBe('open');
    expect(draftKillTokenWindow({ ...base, closesAt: '2026-10-20T12:00:00Z' })).toBe('closed');
    expect(draftKillTokenWindow({ ...base, closesAt: '2026-10-19T00:00:00Z' })).toBe('closed');
    expect(draftKillTokenWindow({ ...base, closesAt: 'not a date' })).toBe('closed');
  });

  it('default cutoff: open until the first league match result is confirmed', () => {
    const base = { initialPhase: 'complete' as const, closesAt: null, now };
    expect(draftKillTokenWindow({ ...base, anyLeagueMatchConfirmed: false })).toBe('open');
    expect(draftKillTokenWindow({ ...base, anyLeagueMatchConfirmed: true })).toBe('closed');
  });
});

describe('draftKillLineRefusal (SQL order of epb_purchase_draft_token)', () => {
  const eligible = {
    window: 'open' as const,
    owned: 0,
    max: 2,
    lineHasToken: false,
    unspentPoints: 5,
    cost: 5,
    totalProgress: 0,
    nextThreshold: 2,
  };

  it('null when every rule passes', () => {
    expect(draftKillLineRefusal(eligible)).toBeNull();
  });

  it('window → player limit → line limit → points → fully evolved → would evolve', () => {
    const allFailing = {
      window: 'closed' as const,
      owned: 2,
      max: 2,
      lineHasToken: true,
      unspentPoints: 2,
      cost: 5,
      totalProgress: 0,
      nextThreshold: null,
    };
    expect(draftKillLineRefusal(allFailing)).toBe('TOKEN_WINDOW_CLOSED');
    expect(draftKillLineRefusal({ ...allFailing, window: 'before' })).toBe('TOKEN_WINDOW_CLOSED');
    const open = { ...allFailing, window: 'open' as const };
    expect(draftKillLineRefusal(open)).toBe('TOKEN_PLAYER_LIMIT');
    expect(draftKillLineRefusal({ ...open, owned: 1 })).toBe('TOKEN_LINE_LIMIT');
    expect(draftKillLineRefusal({ ...open, owned: 1, lineHasToken: false })).toBe('TOKEN_POINTS_SHORT');
    expect(draftKillLineRefusal({ ...open, owned: 1, lineHasToken: false, unspentPoints: 5 })).toBe('LINE_FULLY_EVOLVED');
    expect(
      draftKillLineRefusal({ ...open, owned: 1, lineHasToken: false, unspentPoints: 5, nextThreshold: 1 }),
    ).toBe('TOKEN_WOULD_EVOLVE');
  });

  it("the player limit counts every owned token (the pack's per-player max)", () => {
    const max = epbPack.defaults.tokenMax;
    expect(draftKillLineRefusal({ ...eligible, max, owned: max - 1 })).toBeNull();
    expect(draftKillLineRefusal({ ...eligible, max, owned: max })).toBe('TOKEN_PLAYER_LIMIT');
  });
});

describe('Comeback Tokens', () => {
  it('reads the pack comeback table: highest reached row on a shutout, no shutout → 0', () => {
    for (let winner = 0; winner <= 6; winner++) {
      expect(comebackTokensForLoss(0, winner)).toBe(comebackTokensFromTable(0, winner));
    }
    expect(comebackTokensForLoss(1, 6)).toBe(0);
  });

  it('example pack: 0:4 – 0:6 → 1, below → 0', () => {
    expect(comebackTokensForLoss(0, 3)).toBe(0);
    expect(comebackTokensForLoss(0, 4)).toBe(1);
    expect(comebackTokensForLoss(0, 6)).toBe(1);
  });

  it('equals computeKillTokens (point-buy-engine) for every score', () => {
    for (let loser = 0; loser <= 6; loser++) {
      for (let winner = 0; winner <= 6; winner++) {
        expect(comebackTokensForLoss(loser, winner)).toBe(computeKillTokens(loser, winner));
      }
    }
  });

  it('balance = max(0, earned − spent)', () => {
    expect(comebackBalance(3, 1)).toBe(2);
    expect(comebackBalance(2, 2)).toBe(0);
    expect(comebackBalance(1, 3)).toBe(0);
  });

  it('spending opens after the redraft or by the admin switch', () => {
    expect(comebackSpendOpen({ redraftComplete: false, adminOpened: false })).toBe(false);
    expect(comebackSpendOpen({ redraftComplete: true, adminOpened: false })).toBe(true);
    expect(comebackSpendOpen({ redraftComplete: false, adminOpened: true })).toBe(true);
  });
});
