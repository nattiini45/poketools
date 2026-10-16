import { POWER_TIER_COLORS, type PowerTier } from '@/types/evolution';

interface TierBadgeProps {
  tier: PowerTier;
  className?: string;
}

/**
 * Colored S/A/B/C tier badge for draft league power tiers.
 * Extracted from PickSelector for reuse across browser, pool displays, etc.
 */
export default function TierBadge({ tier, className = '' }: TierBadgeProps) {
  const colors = POWER_TIER_COLORS[tier];
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-heading font-bold ${colors.bg} ${colors.text} ${className}`}
    >
      {tier}
    </span>
  );
}
