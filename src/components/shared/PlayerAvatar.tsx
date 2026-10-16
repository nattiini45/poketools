'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useT } from '@/i18n/client';
import { uiMessages } from '@/i18n/messages/ui';

interface PlayerAvatarProps {
  /** Custom avatar URL (from Supabase Storage; a 256 px WebP thumbnail since the thumbnail wave). */
  avatarUrl?: string | null;
  /** Discord avatar URL (fallback). */
  discordAvatarUrl?: string | null;
  /** Player name (used for initials fallback). */
  name: string;
  /** Display size in pixels. */
  size?: number;
  className?: string;
}

/** Deterministic color from a name string — used for initials fallback. */
function nameToColor(name: string): string {
  const colors = [
    '#E74C3C', '#3498DB', '#2ECC71', '#F39C12',
    '#9B59B6', '#1ABC9C', '#E67E22', '#34495E',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/**
 * First image source that is set and has not failed to load, or null for the
 * initials fallback.
 */
export function pickAvatarSrc(
  candidates: ReadonlyArray<string | null | undefined>,
  failed: ReadonlyArray<string>,
): string | null {
  for (const candidate of candidates) {
    if (candidate && !failed.includes(candidate)) return candidate;
  }
  return null;
}

/**
 * Unified player avatar display.
 * Fallback chain: custom avatar → Discord avatar → colored initials circle.
 * A source that fails to load (e.g. a removed Storage object) drops to the next one.
 */
export default function PlayerAvatar({
  avatarUrl,
  discordAvatarUrl,
  name,
  size = 32,
  className = '',
}: PlayerAvatarProps) {
  const t = useT(uiMessages);
  const [failed, setFailed] = useState<string[]>([]);
  const src = pickAvatarSrc([avatarUrl, discordAvatarUrl], failed);

  if (src) {
    return (
      <Image
        key={src}
        src={src}
        alt={t('avatar.alt', { name })}
        width={size}
        height={size}
        className={`rounded-full ring-2 ring-poke-border object-cover ${className}`}
        // Custom avatars are already small, immutable Storage thumbnails:
        // serve them as-is rather than through the image optimizer.
        unoptimized={src === avatarUrl}
        onError={() => setFailed((prev) => (prev.includes(src) ? prev : [...prev, src]))}
      />
    );
  }

  // Initials fallback
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className={`rounded-full ring-2 ring-poke-border flex items-center justify-center font-heading font-bold text-white flex-shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: nameToColor(name),
        fontSize: size * 0.38,
      }}
      aria-label={t('avatar.alt', { name })}
    >
      {initials}
    </div>
  );
}
