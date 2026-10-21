import type { Locale } from '@/i18n/config';
import type { ThemeSectionCopy } from '@/components/world/sections/types';
import { isleSectionCopy } from '../../section-copy';
import { plaqueCopy } from '../content/paint';

/**
 * Mountain Pass's diegetic vocabulary for the shared league sections (C1).
 *
 * This is the ONLY thing that legitimately differs between the sakura,
 * mountain and clouds copies of those sections — layout, data derivation and
 * accessibility semantics live once in `@/components/world/sections`. The
 * words follow the viewer (`world-themes.sections.mountain`).
 */
export function mountainSectionCopyFor(locale: Locale): ThemeSectionCopy {
  return isleSectionCopy('mountain', locale, (formatRules, rulesetName, context) =>
    plaqueCopy(formatRules, rulesetName, context, locale),
  );
}

