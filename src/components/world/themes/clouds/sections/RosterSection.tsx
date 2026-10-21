import SharedRosterSection from '@/components/world/sections/RosterSection';
import type { Locale } from '@/i18n/config';
import { cloudsSectionCopyFor } from './copy';
import type { CloudsRouteData } from '../types';

/**
 * #roster — Skyisle: roster tiles, priced and grouped when a point-buy list is bound.
 *
 * Thin binding of the shared section kit (C1) to this theme. Only the
 * diegetic copy in ./copy.ts is theme-specific; layout, data derivation and
 * accessibility semantics live once in @/components/world/sections.
 */
export default function RosterSection({
  data,
  locale = 'en',
  dataLocale = locale,
}: {
  data: CloudsRouteData;
  /** The viewer's language (the theme world reads it once on the server). */
  locale?: Locale;
  /** The viewer's Pokémon-data language (species and type names). */
  dataLocale?: Locale;
}) {
  return <SharedRosterSection data={data} copy={cloudsSectionCopyFor(locale)} locale={locale} dataLocale={dataLocale} />;
}
