import type { Locale } from '@/i18n/config';
import type { ThemeSectionCopy } from '@/components/world/sections/types';
import { isleSectionCopy } from '../../section-copy';
import { plaqueCopy } from '../content/paint';

/**
 * Sakura Park's diegetic vocabulary for the shared league sections (C1).
 *
 * This is the ONLY thing that legitimately differs between the sakura,
 * mountain and clouds copies of those sections — layout, data derivation and
 * accessibility semantics live once in `@/components/world/sections`. The
 * words follow the viewer (`world-themes.sections.sakura`); the painted
 * plaque is bound to the same language.
 */
export function sakuraSectionCopyFor(locale: Locale): ThemeSectionCopy {
  return isleSectionCopy('sakura', locale, (formatRules, rulesetName, context) =>
    plaqueCopy(formatRules, rulesetName, context, locale),
  );
}

