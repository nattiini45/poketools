'use client';

import Image from 'next/image';
import { getCategorySpriteUrl } from '@/lib/pkmn/sprites';
import { localizeMoveCategory } from '@/lib/pkmn/i18n/names/misc';
import { useDataLocale, useT } from '@/i18n/client';
import { uiMessages } from '@/i18n/messages/ui';

interface CategoryIconProps {
  category: string;
  size?: number;
  className?: string;
}

/**
 * Renders a move category icon (Physical/Special/Status) from the Showdown CDN.
 */
export default function CategoryIcon({ category, size = 16, className = '' }: CategoryIconProps) {
  const t = useT(uiMessages);
  const dataLocale = useDataLocale();
  const normalized = category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();

  if (normalized !== 'Physical' && normalized !== 'Special' && normalized !== 'Status') {
    return (
      <span
        className={`inline-block rounded-sm bg-poke-elevated ${className}`}
        style={{ width: size, height: size }}
        aria-label={t('categoryIcon.unknown')}
      />
    );
  }

  return (
    <Image
      src={getCategorySpriteUrl(normalized)}
      alt={t('categoryIcon.alt', { category: localizeMoveCategory(normalized, dataLocale) })}
      width={size}
      height={size}
      className={`inline-block align-middle ${className}`}
      unoptimized
    />
  );
}
