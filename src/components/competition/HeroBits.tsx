import Link from 'next/link';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import SpriteImg from '@/components/shared/SpriteImg';
import { cn } from '@/lib/utils/cn';

/** One side of a hero's versus panel (the league hero and the tournament hero share it). */
export interface HeroSide {
  playerId: string;
  name: string;
  avatarUrl: string | null;
  /** Ace species (English name) for the sprite; null when the trainer has no public team lead. */
  ace: string | null;
  /** 1-based place in the table; null when the trainer is not in it. */
  rank: number | null;
  points: number | null;
}

/** A count on a skewed plate under a hero's title. */
export function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <li className="skew-plate px-4 py-2 text-fg">
      <span aria-hidden="true" className="skew-plate-bg border border-hairline-strong bg-surface" />
      <span className="flex flex-col">
        <span className="font-heading text-title tabular-nums">{value}</span>
        <span className="text-caption text-fg-muted">{label}</span>
      </span>
    </li>
  );
}

/** A trainer on a hero's dark slab: the ace sprite (else the avatar) over a name plate that links to the profile. */
export function HeroFighter({ side, standing, tier, align }: { side: HeroSide; standing: string | null; tier: 'bg-tier-1' | 'bg-tier-3'; align: 'left' | 'right' }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', align === 'right' ? 'items-end' : 'items-start')}>
      <div className="flex h-24 w-full items-end justify-center sm:h-36">
        {side.ace ? (
          <SpriteImg name={side.ace} alt={side.ace} width={144} height={144} className="h-24 w-24 object-contain sm:h-36 sm:w-36" />
        ) : (
          <PlayerAvatar avatarUrl={side.avatarUrl} name={side.name} size={72} />
        )}
      </div>
      <Link
        href={`/players/${side.playerId}`}
        className="league-hero-nameplate relative flex w-full min-w-0 flex-col gap-x-3 px-4 py-2 sm:flex-row sm:items-baseline sm:justify-between focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus"
      >
        <span aria-hidden="true" className={cn('absolute inset-y-0 w-1.5', tier, align === 'right' ? 'right-0' : 'left-0')} />
        <span className={cn('min-w-0 max-w-full truncate font-heading text-title', align === 'right' && 'self-end sm:order-2 sm:self-auto')}>{side.name}</span>
        {standing && <span className={cn('shrink-0 text-caption tabular-nums text-fg-muted', align === 'right' && 'self-end sm:self-auto')}>{standing}</span>}
      </Link>
    </div>
  );
}
