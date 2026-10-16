'use client';

/**
 * Renders one Pokémon-data name (species, move, item, ability, type, nature) in the viewer's data locale
 * (design pkmn-l10n.md §3.5). `name` is the canonical English name the app stores; it is never translated
 * before storing, in URLs or in Showdown text, only here, at display.
 *
 * Imports the names barrel (all five name maps). A component that only ever shows one kind can call
 * `localizeX(name, useDataLocale())` from `@/lib/pkmn/i18n/names/<kind>` instead to keep its bundle small.
 */
import type { ReactElement } from 'react';
import { useDataLocale } from '@/i18n/client';
import { localizeName } from '@/lib/pkmn/i18n/names';
import type { DataLocale, PkmnKind } from '@/lib/pkmn/i18n/types';

export interface PkmnNameProps {
  kind: PkmnKind;
  /** Canonical English name ("Ursaluna-Bloodmoon", "U-turn"). */
  name: string;
  /** Overrides the provider's data locale (viewerless output, overlays). */
  locale?: DataLocale;
  /** Adds `title={name}` (the English name) when the localized text differs from it. */
  withEnglishTitle?: boolean;
  className?: string;
}

export default function PkmnName({ kind, name, locale, withEnglishTitle, className }: PkmnNameProps): ReactElement {
  const contextLocale = useDataLocale();
  const localized = localizeName(kind, name, locale ?? contextLocale);
  if (!withEnglishTitle && className === undefined) return <>{localized}</>;
  const title = withEnglishTitle && localized !== name ? name : undefined;
  return (
    <span className={className} title={title}>
      {localized}
    </span>
  );
}
