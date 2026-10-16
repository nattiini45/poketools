import type { ReactNode } from 'react';
import SharedPulseSection from '@/components/world/sections/PulseSection';
import type { Locale } from '@/i18n/config';
import { sakuraSectionCopyFor } from './copy';
import type { SakuraRouteData } from '../types';

/**
 * #pulse — Sakura Park: league pulse.
 *
 * Thin binding of the shared section kit (C1) to this theme. Only the
 * diegetic copy in ./copy.ts is theme-specific; layout, data derivation and
 * accessibility semantics live once in @/components/world/sections.
 */
export default function PulseSection({
  data,
  children,
  locale = 'en',
}: {
  data: SakuraRouteData;
  children?: ReactNode;
  /** The viewer's language (the theme world reads it once on the server). */
  locale?: Locale;
}) {
  return (
    <SharedPulseSection data={data} copy={sakuraSectionCopyFor(locale)} locale={locale}>
      {children}
    </SharedPulseSection>
  );
}
