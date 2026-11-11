'use client';

import type { ReactNode } from 'react';
import { motion } from '@/components/shared/motion';
import { SPRING } from '@/lib/motion/tokens';
import { cn } from '@/lib/utils/cn';

export type SkewPlateVariant = 'nav' | 'tab' | 'button' | 'rank';

interface SkewPlateProps {
  variant: SkewPlateVariant;
  children: ReactNode;
  /** nav and tab: the current item. Its plate (nav) or underside (tab) is drawn; a heavier label never resizes it. */
  active?: boolean;
  /** button: the amber primary or the surface secondary. */
  tone?: 'primary' | 'secondary';
  /** rank: the top-four plate colour. */
  tier?: 1 | 2 | 3 | 4;
  /** Shared by the items of one nav or tab row, so the active plate glides between them with the moderate spring. */
  glideId?: string;
  className?: string;
}

const TIER_FILL = { 1: 'bg-tier-1', 2: 'bg-tier-2', 3: 'bg-tier-3', 4: 'bg-tier-4' } as const;

/**
 * Direction B's skewed plate (docs/design.md, "Skewed plates"): a plate sheared by `--skew` behind an upright,
 * selectable label. Place it inside the link or button it labels; the focus ring follows the plate.
 */
export default function SkewPlate({ variant, children, active = false, tone = 'primary', tier = 1, glideId, className }: SkewPlateProps) {
  const fill = (() => {
    switch (variant) {
      case 'nav':
        return active ? 'bg-tier-1' : null;
      case 'tab':
        return 'border border-hairline-strong bg-surface';
      case 'button':
        return tone === 'primary' ? 'bg-accent-fill' : 'border border-hairline-strong bg-surface';
      case 'rank':
        return TIER_FILL[tier];
    }
  })();
  const ink =
    variant === 'rank' || (variant === 'nav' && active) || (variant === 'button' && tone === 'primary') ? 'text-tier-ink' : 'text-fg';
  const heavy = variant === 'button' || variant === 'rank' || active;
  const glides = glideId !== undefined && (variant === 'nav' || variant === 'tab');

  return (
    <span className={cn('skew-plate', ink, variant === 'rank' ? 'px-2 py-0.5' : 'px-3 py-1.5', className)} data-variant={variant}>
      {fill &&
        (glides && variant === 'nav' ? (
          <motion.span layoutId={glideId} transition={SPRING.moderate} aria-hidden="true" className={cn('skew-plate-bg', fill)} />
        ) : (
          <span aria-hidden="true" className={cn('skew-plate-bg', fill)} />
        ))}
      {variant === 'tab' &&
        active &&
        (glides ? (
          <motion.span layoutId={glideId} transition={SPRING.moderate} aria-hidden="true" className="skew-plate-underside" />
        ) : (
          <span aria-hidden="true" className="skew-plate-underside" />
        ))}
      <span className="grid">
        <span aria-hidden="true" className="invisible col-start-1 row-start-1 font-[550]">
          {children}
        </span>
        <span className={cn('col-start-1 row-start-1', heavy ? 'font-[550]' : 'font-normal')}>{children}</span>
      </span>
    </span>
  );
}
