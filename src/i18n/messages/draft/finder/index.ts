import { defineNamespace } from '@/i18n/define';
import en from './en';
import de from './de';

/** The English source shape of `draft/finder` (for `Translator<DraftFinderEn>` in pure helpers). */
export type DraftFinderEn = typeof en;

export const draftFinderMessages = defineNamespace('draft/finder', en, de);
