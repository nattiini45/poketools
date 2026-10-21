import type { Locale } from '@/i18n/config';
import type { ThemeSectionCopy } from '@/components/world/sections/types';
import { isleSectionCopy } from '../../section-copy';
import { gatePlaqueCopy } from '../content/paint';

/**
 * Skyisle's diegetic vocabulary for the shared league sections (C1).
 *
 * This is the ONLY thing that legitimately differs between the sakura,
 * mountain and clouds copies of those sections — layout, data derivation and
 * accessibility semantics live once in `@/components/world/sections`. The
 * words follow the viewer (`world-themes.sections.clouds`).
 */
export function cloudsSectionCopyFor(locale: Locale): ThemeSectionCopy {
  return isleSectionCopy('clouds', locale, (formatRules, rulesetName, context) =>
    gatePlaqueCopy(formatRules, rulesetName, context, locale),
  );
}

