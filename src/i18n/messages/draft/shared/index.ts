import { defineNamespace } from '@/i18n/define';
import en from './en';
import de from './de';

/** The English source shape of `draft/shared` (for `Translator<DraftSharedEn>` in pure helpers). */
export type DraftSharedEn = typeof en;

export const draftSharedMessages = defineNamespace('draft/shared', en, de);
