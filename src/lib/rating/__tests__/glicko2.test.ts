import { describe, it, expect } from 'vitest';
import { glicko2Update, expectedScore, inflateRD } from '../glicko2';
import type { Glicko2Player } from '../glicko2';
import { GLICKO2_DEFAULTS } from '@/types/rating';

// ── Helpers ──────────────────────────────────────────────────────────

function defaultPlayer(overrides?: Partial<Glicko2Player>): Glicko2Player {
  return {
    rating: GLICKO2_DEFAULTS.INITIAL_RATING,
    rd: GLICKO2_DEFAULTS.INITIAL_RD,
    volatility: GLICKO2_DEFAULTS.INITIAL_VOLATILITY,
    ...overrides,
  };
}

// ── expectedScore ────────────────────────────────────────────────────

describe('expectedScore', () => {
  it('returns ~0.5 for equal ratings', () => {
    const score = expectedScore(1500, 350, 1500, 350);
    expect(score).toBeCloseTo(0.5, 2);
  });

  it('returns > 0.5 when player rating is higher', () => {
    const score = expectedScore(1800, 100, 1500, 100);
    expect(score).toBeGreaterThan(0.5);
  });

  it('returns < 0.5 when player rating is lower', () => {
    const score = expectedScore(1200, 100, 1500, 100);
    expect(score).toBeLessThan(0.5);
  });

  it('is approximately symmetric (p1 vs p2 + p2 vs p1 ≈ 1.0)', () => {
    const s1 = expectedScore(1600, 150, 1400, 200);
    const s2 = expectedScore(1400, 200, 1600, 150);
    expect(s1 + s2).toBeCloseTo(1.0, 1);
  });

  it('higher RD increases uncertainty (score closer to 0.5)', () => {
    const lowRD = expectedScore(1700, 50, 1500, 50);
    const highRD = expectedScore(1700, 300, 1500, 300);
    // With low RD the favorite is more confidently ahead
    expect(Math.abs(lowRD - 0.5)).toBeGreaterThan(Math.abs(highRD - 0.5));
  });
});

// ── inflateRD ────────────────────────────────────────────────────────

describe('inflateRD', () => {
  it('returns clamped RD when periods is 0', () => {
    const result = inflateRD(100, 0.06, 0);
    expect(result).toBe(100);
  });

  it('increases RD for positive periods', () => {
    const result = inflateRD(100, 0.06, 5);
    expect(result).toBeGreaterThan(100);
  });

  it('caps RD at ceiling', () => {
    const result = inflateRD(340, 0.06, 100);
    expect(result).toBeLessThanOrEqual(GLICKO2_DEFAULTS.RD_CEILING);
  });

  it('clamps RD at floor', () => {
    const result = inflateRD(10, 0.06, 0);
    expect(result).toBe(GLICKO2_DEFAULTS.RD_FLOOR);
  });

  it('treats negative periods as 0', () => {
    const result = inflateRD(100, 0.06, -3);
    expect(result).toBe(100);
  });
});

// ── glicko2Update ────────────────────────────────────────────────────

describe('glicko2Update', () => {
  it('increases rating on win', () => {
    const player = defaultPlayer();
    const opponent = defaultPlayer();
    const result = glicko2Update(player, opponent, 1.0);
    expect(result.rating).toBeGreaterThan(player.rating);
  });

  it('decreases rating on loss', () => {
    const player = defaultPlayer();
    const opponent = defaultPlayer();
    const result = glicko2Update(player, opponent, 0.0);
    expect(result.rating).toBeLessThan(player.rating);
  });

  it('changes rating only slightly on draw between equal players', () => {
    const player = defaultPlayer();
    const opponent = defaultPlayer();
    const result = glicko2Update(player, opponent, 0.5);
    // Draw between equal players should barely move rating
    expect(Math.abs(result.rating - player.rating)).toBeLessThan(5);
  });

  it('reduces RD after any game (confidence increases)', () => {
    const player = defaultPlayer();
    const opponent = defaultPlayer();
    const result = glicko2Update(player, opponent, 1.0);
    expect(result.rd).toBeLessThan(player.rd);
  });

  it('produces symmetric results for equal players', () => {
    const p1 = defaultPlayer();
    const p2 = defaultPlayer();
    const winnerResult = glicko2Update(p1, p2, 1.0);
    const loserResult = glicko2Update(p2, p1, 0.0);
    // Rating changes should be approximately equal and opposite
    const winDelta = winnerResult.rating - p1.rating;
    const lossDelta = loserResult.rating - p2.rating;
    expect(winDelta).toBeGreaterThan(0);
    expect(lossDelta).toBeLessThan(0);
    expect(Math.abs(winDelta + lossDelta)).toBeLessThan(5);
  });

  it('awards more rating for beating a higher-rated opponent', () => {
    const player = defaultPlayer({ rd: 100 });
    const weakOpponent = defaultPlayer({ rating: 1300, rd: 100 });
    const strongOpponent = defaultPlayer({ rating: 1700, rd: 100 });

    const resultWeak = glicko2Update(player, weakOpponent, 1.0);
    const resultStrong = glicko2Update(player, strongOpponent, 1.0);

    const weakGain = resultWeak.rating - player.rating;
    const strongGain = resultStrong.rating - player.rating;
    expect(strongGain).toBeGreaterThan(weakGain);
  });

  it('clamps score to [0, 1]', () => {
    const player = defaultPlayer();
    const opponent = defaultPlayer();
    // Score > 1 should act like 1.0
    const over = glicko2Update(player, opponent, 2.0);
    const exact = glicko2Update(player, opponent, 1.0);
    expect(over.rating).toBe(exact.rating);

    // Score < 0 should act like 0.0
    const under = glicko2Update(player, opponent, -1.0);
    const zero = glicko2Update(player, opponent, 0.0);
    expect(under.rating).toBe(zero.rating);
  });

  it('returns numeric values rounded to 2 decimal places (rating, rd)', () => {
    const player = defaultPlayer();
    const opponent = defaultPlayer();
    const result = glicko2Update(player, opponent, 1.0);
    expect(result.rating.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
    expect(result.rd.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
  });
});
