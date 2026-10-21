import SharedRulesSection from '@/components/world/sections/RulesSection';
import type { Locale } from '@/i18n/config';
import { mountainSectionCopyFor } from './copy';
import type { MountainRouteData } from '../types';

/**
 * #rules — Mountain Pass: rulebook resolved from the season format rules.
 *
 * Thin binding of the shared section kit (C1) to this theme. Only the
 * diegetic copy in ./copy.ts is theme-specific; layout, data derivation and
 * accessibility semantics live once in @/components/world/sections.
 */
export default function RulesSection({
  data,
  locale = 'en',
}: {
  data: MountainRouteData;
  /** The viewer's language (the theme world reads it once on the server). */
  locale?: Locale;
}) {
  return <SharedRulesSection data={data} copy={mountainSectionCopyFor(locale)} locale={locale} />;
}
