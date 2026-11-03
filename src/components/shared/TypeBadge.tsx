'use client';

import { useDataLocale } from '@/i18n/client';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import type { DataLocale } from '@/lib/pkmn/i18n/types';
import TypeBadgeView, { type TypeBadgeSize } from './TypeBadgeView';

interface TypeBadgeProps {
  /** English type name ('Fire'); also the style key. */
  type: string;
  className?: string;
  /** `compact` drops the minimum width and tightens padding, type size and line height. */
  size?: TypeBadgeSize;
  /** Overrides the data locale from the provider (e.g. viewerless output in the league language). */
  locale?: DataLocale;
}

export default function TypeBadge({ type, className, size, locale }: TypeBadgeProps) {
  const providerLocale = useDataLocale();
  const label = localizeType(type, locale ?? providerLocale);

  return <TypeBadgeView type={type} label={label} className={className} size={size} />;
}
