import type { CasterPokemonInfo } from '@/types/caster';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { broadcastCasterMessages } from '@/i18n/messages/broadcast-caster';

export interface MomentumScore {
  /** -100 (P2 dominating) to +100 (P1 dominating) */
  score: number;
  label: string;
}

/**
 * Calculate in-game momentum based on remaining pokemon,
 * KO differential, and threat level of remaining mons.
 * Returns -100 to +100 where positive favors P1.
 * `locale` is the language of `label` (default English).
 */
export function calculateMomentum(
  p1Pokemon: CasterPokemonInfo[],
  p2Pokemon: CasterPokemonInfo[],
  p1Brought: boolean[],
  p2Brought: boolean[],
  p1Koed: boolean[],
  p2Koed: boolean[],
  locale: Locale = 'en',
): MomentumScore {
  function threatLevel(info: CasterPokemonInfo): number {
    const bst = Object.values(info.baseStats).reduce((a, b) => a + b, 0);
    return bst / 600; // normalize to ~1.0 for average BST
  }

  let p1ThreatRemaining = 0;
  let p2ThreatRemaining = 0;
  let p1Alive = 0;
  let p2Alive = 0;

  for (let i = 0; i < p1Pokemon.length; i++) {
    if (p1Brought[i] && !p1Koed[i]) {
      p1Alive++;
      p1ThreatRemaining += threatLevel(p1Pokemon[i]);
    }
  }

  for (let i = 0; i < p2Pokemon.length; i++) {
    if (p2Brought[i] && !p2Koed[i]) {
      p2Alive++;
      p2ThreatRemaining += threatLevel(p2Pokemon[i]);
    }
  }

  // Weight: pokemon count (40%) + threat level (60%)
  const totalBrought = Math.max(
    p1Brought.filter(Boolean).length + p2Brought.filter(Boolean).length,
    1
  );
  const countDiff = (p1Alive - p2Alive) / (totalBrought / 2);
  const threatDiff = (p1ThreatRemaining - p2ThreatRemaining) / Math.max(p1ThreatRemaining + p2ThreatRemaining, 1);

  const raw = countDiff * 0.4 + threatDiff * 0.6;
  const score = Math.round(Math.max(-100, Math.min(100, raw * 100)));

  const t = createTranslator(broadcastCasterMessages, locale);
  const side = score > 0 ? 'P1' : 'P2';
  let label: string;
  if (Math.abs(score) < 10) label = t('generated.momentumEven');
  else if (Math.abs(score) < 30) label = t('generated.momentumSlight', { side });
  else if (Math.abs(score) < 60) label = t('generated.momentumAdvantage', { side });
  else label = t('generated.momentumDominating', { side });

  return { score, label };
}
