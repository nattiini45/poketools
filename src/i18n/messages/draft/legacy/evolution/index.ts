import { defineNamespace } from '@/i18n/define';
import en from './en';
import de from './de';

/** The English source shape of `draft/legacy/evolution` (for `Translator<DraftLegacyEvolutionEn>` in helpers). */
export type DraftLegacyEvolutionEn = typeof en;

export const draftLegacyEvolutionMessages = defineNamespace('draft/legacy/evolution', en, de);
