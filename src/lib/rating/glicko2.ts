import { GLICKO2_DEFAULTS } from '@/types/rating';

export interface Glicko2Player {
  rating: number;
  rd: number;
  volatility: number;
}

const GLICKO2_SCALE = 173.7178;
const PI_SQUARED = Math.PI ** 2;
const EPSILON = 0.000001;

function clampRd(rd: number): number {
  return Math.min(GLICKO2_DEFAULTS.RD_CEILING, Math.max(GLICKO2_DEFAULTS.RD_FLOOR, rd));
}

function toMu(rating: number): number {
  return (rating - GLICKO2_DEFAULTS.INITIAL_RATING) / GLICKO2_SCALE;
}

function toPhi(rd: number): number {
  return clampRd(rd) / GLICKO2_SCALE;
}

function toRating(mu: number): number {
  return (mu * GLICKO2_SCALE) + GLICKO2_DEFAULTS.INITIAL_RATING;
}

function toRd(phi: number): number {
  return clampRd(phi * GLICKO2_SCALE);
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * (phi ** 2)) / PI_SQUARED);
}

function e(mu: number, muOpponent: number, phiOpponent: number): number {
  return 1 / (1 + Math.exp(-g(phiOpponent) * (mu - muOpponent)));
}

function solveVolatility(
  phi: number,
  sigma: number,
  delta: number,
  variance: number
): number {
  const tau = GLICKO2_DEFAULTS.SYSTEM_TAU;
  const alpha = Math.log(sigma ** 2);

  const f = (x: number): number => {
    const ex = Math.exp(x);
    const numerator = ex * ((delta ** 2) - (phi ** 2) - variance - ex);
    const denominator = 2 * ((phi ** 2) + variance + ex) ** 2;
    return (numerator / denominator) - ((x - alpha) / (tau ** 2));
  };

  let a = alpha;
  let b: number;

  if ((delta ** 2) > ((phi ** 2) + variance)) {
    b = Math.log((delta ** 2) - (phi ** 2) - variance);
  } else {
    let k = 1;
    while (f(alpha - (k * tau)) < 0) {
      k += 1;
    }
    b = alpha - (k * tau);
  }

  let fa = f(a);
  let fb = f(b);

  while (Math.abs(b - a) > EPSILON) {
    const c = a + ((a - b) * fa) / (fb - fa);
    const fc = f(c);

    if ((fc * fb) < 0) {
      a = b;
      fa = fb;
    } else {
      fa = fa / 2;
    }

    b = c;
    fb = fc;
  }

  return Math.exp(a / 2);
}

export function expectedScore(
  playerRating: number,
  playerRD: number,
  opponentRating: number,
  opponentRD: number
): number {
  const mu = toMu(playerRating);
  const muOpponent = toMu(opponentRating);
  const combinedPhi = Math.sqrt((toPhi(playerRD) ** 2) + (toPhi(opponentRD) ** 2));

  return 1 / (1 + Math.exp(-g(combinedPhi) * (mu - muOpponent)));
}

export function inflateRD(
  rd: number,
  volatility: number,
  periodsSinceLastGame: number
): number {
  const periods = Math.max(0, periodsSinceLastGame);
  if (periods === 0) {
    return clampRd(rd);
  }

  const phi = toPhi(rd);
  const inflatedPhi = Math.sqrt((phi ** 2) + ((volatility ** 2) * periods));
  return toRd(inflatedPhi);
}

/**
 * Single-opponent Glicko-2 update for one rating period.
 * score: 1.0 = win, 0.5 = draw, 0.0 = loss
 */
export function glicko2Update(
  player: Glicko2Player,
  opponent: Glicko2Player,
  score: number
): Glicko2Player {
  const boundedScore = Math.max(0, Math.min(1, score));

  const mu = toMu(player.rating);
  const phi = toPhi(player.rd);
  const sigma = player.volatility;

  const muOpponent = toMu(opponent.rating);
  const phiOpponent = toPhi(opponent.rd);

  const gPhi = g(phiOpponent);
  const expected = e(mu, muOpponent, phiOpponent);
  const variance = 1 / ((gPhi ** 2) * expected * (1 - expected));
  const delta = variance * gPhi * (boundedScore - expected);

  const sigmaPrime = solveVolatility(phi, sigma, delta, variance);
  const phiStar = Math.sqrt((phi ** 2) + (sigmaPrime ** 2));
  const phiPrime = 1 / Math.sqrt((1 / (phiStar ** 2)) + (1 / variance));
  const muPrime = mu + ((phiPrime ** 2) * gPhi * (boundedScore - expected));

  return {
    rating: Number(toRating(muPrime).toFixed(2)),
    rd: Number(toRd(phiPrime).toFixed(2)),
    volatility: Number(sigmaPrime.toFixed(6)),
  };
}
