import { describe, expect, it } from 'vitest';
import {
  computeDraftTokens,
  computeRedraftReserve,
  validateTokenAllocation,
  computeKillTokens,
  getTeraEligibility,
  earnsEvolutionPoint,
  shouldSuspend,
  suspensionEndMatchday,
} from '../point-buy-engine';
import { comebackTokensForLoss } from '../tokens';
import { epbPack, teraEligibilityForStage } from '@/lib/format-pack';

/** Tokens the pack's comeback table gives a shutout won with `winner` survivors. */
function tableTokens(winner: number): number {
  let tokens = 0;
  for (const row of epbPack.comeback.table) if (winner >= row.minWinnerSurvivors) tokens = row.tokens;
  return tokens;
}

// ─── Draft Tokens ──────────────────────────────────────────────────

describe('computeDraftTokens', () => {
  it('returns 0 when remaining < ratio', () => {
    expect(computeDraftTokens(2, 3, 2)).toBe(0);
    expect(computeDraftTokens(0, 3, 2)).toBe(0);
  });

  it('computes floor(remaining / ratio)', () => {
    expect(computeDraftTokens(6, 3, 2)).toBe(2);
    expect(computeDraftTokens(7, 3, 2)).toBe(2);
    expect(computeDraftTokens(3, 3, 2)).toBe(1);
    expect(computeDraftTokens(5, 3, 2)).toBe(1);
  });

  it('caps at max', () => {
    expect(computeDraftTokens(9, 3, 2)).toBe(2);
    expect(computeDraftTokens(100, 3, 2)).toBe(2);
  });

  it('example: 90 of 100 spent = 10 remaining (5 points per token, max 2)', () => {
    const remaining = 100 - 90;
    expect(computeDraftTokens(remaining, 5, 2)).toBe(2);
    expect(computeRedraftReserve(remaining, 2, 5)).toBe(0);
    expect(computeRedraftReserve(remaining, 1, 5)).toBe(5);
    expect(computeRedraftReserve(remaining, 0, 5)).toBe(10);
  });
});

describe('validateTokenAllocation', () => {
  it('returns null for valid allocation', () => {
    expect(validateTokenAllocation(
      [{ base_pokemon: 'Charmander', count: 1 }, { base_pokemon: 'Squirtle', count: 1 }],
      2, 1
    )).toBeNull();
  });

  it('rejects exceeding max total', () => {
    const err = validateTokenAllocation(
      [{ base_pokemon: 'A', count: 1 }, { base_pokemon: 'B', count: 1 }, { base_pokemon: 'C', count: 1 }],
      2, 1
    );
    expect(err).toContain('Cannot allocate more than 2');
  });

  it('rejects exceeding max per line', () => {
    const err = validateTokenAllocation(
      [{ base_pokemon: 'A', count: 2 }],
      2, 1
    );
    expect(err).toContain('Cannot allocate more than 1');
  });

  it('rejects duplicate lines', () => {
    const err = validateTokenAllocation(
      [{ base_pokemon: 'A', count: 1 }, { base_pokemon: 'A', count: 1 }],
      2, 1
    );
    expect(err).toContain('same line more than once');
  });
});

// ─── Kill Tokens ───────────────────────────────────────────────────

describe('computeKillTokens', () => {
  it('returns 0 when the loser has surviving Pokémon', () => {
    expect(computeKillTokens(1, 3)).toBe(0);
    expect(computeKillTokens(2, 5)).toBe(0);
  });

  it('returns 0 for a shutout below the first comeback-table row', () => {
    const first = epbPack.comeback.table[0]?.minWinnerSurvivors ?? 7;
    for (let winner = 0; winner < Math.min(first, 7); winner++) {
      expect(computeKillTokens(0, winner)).toBe(0);
    }
  });

  it('returns the comeback-table tokens for shutout scorelines', () => {
    for (let winner = 0; winner <= 6; winner++) {
      expect(computeKillTokens(0, winner)).toBe(tableTokens(winner));
    }
  });

  it('example pack: 0:4 earns 1 token, 0:3 none', () => {
    expect(computeKillTokens(0, 3)).toBe(0);
    expect(computeKillTokens(0, 4)).toBe(1);
    expect(computeKillTokens(0, 6)).toBe(1);
  });
});

describe('computeKillTokens = comebackTokensForLoss (one rule)', () => {
  it('agrees on every loser/winner survivor pair', () => {
    for (let loser = 0; loser <= 6; loser++) {
      for (let winner = 0; winner <= 6; winner++) {
        expect(computeKillTokens(loser, winner)).toBe(comebackTokensForLoss(loser, winner));
      }
    }
  });
  // The former 2:1 Comeback conversion of the participation line is dropped:
  // every line takes Comeback Tokens 1:1.
});

describe('validateTokenAllocation (line ids)', () => {
  it('treats the two branches of one base as two lines', () => {
    expect(
      validateTokenAllocation(
        [
          { base_pokemon: 'Oshawott', line_id: 'oshawott--samurott', count: 1 },
          { base_pokemon: 'Oshawott', line_id: 'oshawott--samurotthisui', count: 1 },
        ],
        2,
        1
      )
    ).toBeNull();
  });

  it('still rejects the same line twice', () => {
    expect(
      validateTokenAllocation(
        [
          { base_pokemon: 'Oshawott', line_id: 'oshawott--samurott', count: 1 },
          { base_pokemon: 'Oshawott', line_id: 'oshawott--samurott', count: 1 },
        ],
        2,
        1
      )
    ).toBe('Cannot allocate tokens to the same line more than once');
  });
});

// ─── Missing-Kills Transfer ────────────────────────────────────────

describe('getTeraEligibility', () => {
  it('reads the pack per stage (stage <= 1 -> stage1, 2 -> stage2, higher -> stage3)', () => {
    expect(getTeraEligibility(0)).toBe(epbPack.teraByStage.stage1);
    expect(getTeraEligibility(1)).toBe(epbPack.teraByStage.stage1);
    expect(getTeraEligibility(2)).toBe(epbPack.teraByStage.stage2);
    expect(getTeraEligibility(3)).toBe(epbPack.teraByStage.stage3);
    expect(getTeraEligibility(4)).toBe(epbPack.teraByStage.stage3);
  });
  it('equals teraEligibilityForStage', () => {
    for (let s = 0; s <= 4; s++) expect(getTeraEligibility(s)).toBe(teraEligibilityForStage(s));
  });
  it('example pack: any / any / stab_only', () => {
    expect([1, 2, 3].map(getTeraEligibility)).toEqual(['any', 'any', 'stab_only']);
  });
});

// ─── Evolution Points ──────────────────────────────────────────────

describe('earnsEvolutionPoint', () => {
  it('returns 1 if any line evolved', () => {
    expect(earnsEvolutionPoint(1)).toBe(1);
    expect(earnsEvolutionPoint(3)).toBe(1);
  });
  it('returns 0 if no line evolved', () => {
    expect(earnsEvolutionPoint(0)).toBe(0);
  });
});

// ─── Early Stage-3 Lock ────────────────────────────────────────────

describe('shouldSuspend (pack stageLock)', () => {
  const lock = epbPack.stageLock;
  it('suspends when the lock stage is reached by the lock matchday', () => {
    for (let md = 1; md <= lock.byMatchday; md++) expect(shouldSuspend(lock.stage, md)).toBe(lock.enabled);
  });
  it('no suspension after the lock matchday', () => {
    expect(shouldSuspend(lock.stage, lock.byMatchday + 1)).toBe(false);
    expect(shouldSuspend(lock.stage, lock.byMatchday + 2)).toBe(false);
  });
  it('no suspension below the lock stage', () => {
    expect(shouldSuspend(lock.stage - 1, 1)).toBe(false);
    expect(shouldSuspend(1, 1)).toBe(false);
  });
  it('suspension ends after suspendMatchdays', () => {
    expect(suspensionEndMatchday(3)).toBe(3 + lock.suspendMatchdays);
  });
  it('example pack: stage 3 by matchday 2, one matchday', () => {
    expect(shouldSuspend(3, 2)).toBe(true);
    expect(shouldSuspend(3, 3)).toBe(false);
    expect(suspensionEndMatchday(2)).toBe(3);
  });
});
