/**
 * Pokéball-themed rating tiers for the Glicko-2 player rating.
 *
 * Tier rules (the "stricter" scheme):
 * - Poké Ball:  rating < 1400, OR provisional (rd > 100) regardless of rating
 * - Great Ball: 1400 <= rating < 1600
 * - Ultra Ball: 1600 <= rating < 1900, OR rating >= 1900 but rd > 50
 * - Master Ball: rating >= 1900 AND rd <= 50
 *
 * The `rd <= 50` Master Ball gate (≈ 20+ rated games at a settled rating)
 * keeps a high-variance early spike from earning Master Ball after a single
 * league sweep. A first-league climb from the 1500 seed typically lands a
 * player around 1650–1750 (Ultra Ball); reaching 1900 needs sustained
 * dominance across multiple events.
 *
 * `rd == 0` is the "RD unknown" sentinel used by call sites that did not
 * fetch RD (e.g. the public players directory). When RD is unknown the
 * provisional check is skipped AND Master Ball cannot be awarded, so the
 * worst that happens is a strong player shows as Ultra instead of Master.
 */

export type RatingTier = 'poke' | 'great' | 'ultra' | 'master';

export interface RatingTierMeta {
  id: RatingTier;
  label: 'Poké Ball' | 'Great Ball' | 'Ultra Ball' | 'Master Ball';
  /** Showdown item id, used by the PokeballIcon sprite renderer. */
  ballItemId: 'pokeball' | 'greatball' | 'ultraball' | 'masterball';
  /** Tailwind classes for the badge background. */
  bg: string;
  /** Tailwind classes for the badge text colour. */
  text: string;
  /** Tailwind classes for the badge border. */
  border: string;
  /** Hex colour for contexts that can't use CSS variables (broadcast overlays). */
  overlayColor: string;
}

export const RATING_TIER_META: Record<RatingTier, RatingTierMeta> = {
  poke: {
    id: 'poke',
    label: 'Poké Ball',
    ballItemId: 'pokeball',
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
    overlayColor: '#dc2626',
  },
  great: {
    id: 'great',
    label: 'Great Ball',
    ballItemId: 'greatball',
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    border: 'border-sky-200',
    overlayColor: '#0284c7',
  },
  ultra: {
    id: 'ultra',
    label: 'Ultra Ball',
    ballItemId: 'ultraball',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    overlayColor: '#d97706',
  },
  master: {
    id: 'master',
    label: 'Master Ball',
    ballItemId: 'masterball',
    bg: 'bg-fuchsia-50',
    text: 'text-fuchsia-700',
    border: 'border-fuchsia-200',
    overlayColor: '#a21caf',
  },
};

/** RD above this threshold means the rating is too provisional to tier above Poké Ball. */
const PROVISIONAL_RD = 100;
/** Master Ball requires RD at or below this value (≈ ~20+ rated games settled). */
const MASTER_RD_GATE = 50;

/**
 * Classify a Glicko-2 rating into a Pokéball tier.
 *
 * Pass `null`, `undefined`, or `0` for `rd` when the caller does not have RD
 * data — in that case the provisional check and the Master Ball gate are both
 * skipped, capping the tier at Ultra Ball for high ratings.
 */
export function getRatingTier(
  rating: number,
  rd: number | null | undefined,
): RatingTier {
  const hasRd = typeof rd === 'number' && rd > 0;

  if (hasRd && rd > PROVISIONAL_RD) {
    return 'poke';
  }
  if (rating < 1400) {
    return 'poke';
  }
  if (rating < 1600) {
    return 'great';
  }
  if (rating < 1900) {
    return 'ultra';
  }
  if (hasRd && rd <= MASTER_RD_GATE) {
    return 'master';
  }
  return 'ultra';
}

/**
 * Display-only tier classifier for the public ratings leaderboard.
 *
 * Unlike {@link getRatingTier}, the returned tier is derived purely from the
 * rating thresholds (Master Ball still requires `rd <= 50` so a single hot
 * streak can't earn it). Provisional status is surfaced separately via the
 * `provisional` flag so UIs can render the would-be tier alongside a
 * "Provisional" indicator instead of collapsing every high-RD player to Poké
 * Ball.
 *
 * The strict {@link getRatingTier} is still the source of truth for
 * gamification rewards, broadcast overlays, and achievements — do not swap
 * call sites blindly.
 */
export function getRatingTierForDisplay(
  rating: number,
  rd: number | null | undefined,
): { tier: RatingTier; provisional: boolean } {
  const hasRd = typeof rd === 'number' && rd > 0;
  const provisional = hasRd && rd > PROVISIONAL_RD;

  let tier: RatingTier;
  if (rating < 1400) {
    tier = 'poke';
  } else if (rating < 1600) {
    tier = 'great';
  } else if (rating < 1900) {
    tier = 'ultra';
  } else if (hasRd && rd <= MASTER_RD_GATE) {
    tier = 'master';
  } else {
    tier = 'ultra';
  }

  return { tier, provisional };
}
