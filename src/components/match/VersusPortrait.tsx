'use client';

import { useState } from 'react';
import Image from 'next/image';
import { pickAvatarSrc } from '@/components/shared/PlayerAvatar';
import { useT } from '@/i18n/client';
import { uiMessages } from '@/i18n/messages/ui';
import { cn } from '@/lib/utils/cn';

const SIDE_FRAME = ['bg-tier-1', 'bg-tier-3'] as const;
const SIDE_FILL = ['bg-tier-1-soft', 'bg-tier-3-soft'] as const;
const UPRIGHT = '[transform:skewX(calc(var(--skew)*-1))]';

interface VersusPortraitProps {
  name: string;
  avatarUrl?: string | null;
  /** 0 is the left trainer (gold frame), 1 the right one (blue frame). */
  side: 0 | 1;
}

/**
 * A trainer's portrait tile on the versus header: the avatar in a skewed, tier-coloured frame, like a pick card of the
 * draft wall. Without an avatar (or when it fails to load) the tile shows the trainer's initial; the name plate beside
 * it names the trainer, so that fallback is decorative.
 */
export default function VersusPortrait({ name, avatarUrl, side }: VersusPortraitProps) {
  const t = useT(uiMessages);
  const [failed, setFailed] = useState<string[]>([]);
  const src = pickAvatarSrc([avatarUrl], failed);

  return (
    <span className={cn('block size-14 shrink-0 rounded-[5px] p-[3px] [transform:skewX(var(--skew))] sm:size-[72px]', SIDE_FRAME[side])}>
      <span className={cn('relative block size-full overflow-hidden rounded-[3px]', SIDE_FILL[side])}>
        {src ? (
          <Image
            key={src}
            src={src}
            alt={t('avatar.alt', { name })}
            fill
            sizes="72px"
            className={cn('scale-125 object-cover', UPRIGHT)}
            unoptimized
            onError={() => setFailed((prev) => (prev.includes(src) ? prev : [...prev, src]))}
          />
        ) : (
          <span aria-hidden="true" className={cn('grid size-full place-items-center font-heading text-display text-tier-ink', UPRIGHT)}>
            {name.trim().charAt(0).toUpperCase()}
          </span>
        )}
      </span>
    </span>
  );
}
