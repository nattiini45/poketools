import SharedScheduleSection from '@/components/world/sections/ScheduleSection';
import type { Locale } from '@/i18n/config';
import { cloudsSectionCopyFor } from './copy';
import type { CloudsRouteData } from '../types';

/**
 * #schedule — Skyisle: stage-grouped fixtures, results and full standings.
 *
 * Thin binding of the shared section kit (C1) to this theme. Only the
 * diegetic copy in ./copy.ts is theme-specific; layout, data derivation and
 * accessibility semantics live once in @/components/world/sections.
 */
export default function ScheduleSection({
  data,
  locale = 'en',
}: {
  data: CloudsRouteData;
  /** The viewer's language (the theme world reads it once on the server). */
  locale?: Locale;
}) {
  return <SharedScheduleSection data={data} copy={cloudsSectionCopyFor(locale)} locale={locale} />;
}
