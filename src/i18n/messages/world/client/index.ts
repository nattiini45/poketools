import { defineNamespace } from '@/i18n/define';
import en from './en';
import de from './de';

/** The English source shape of `world/client` (for `Translator<WorldClientEn>` in pure helpers). */
export type WorldClientEn = typeof en;

export const worldClientMessages = defineNamespace('world/client', en, de);
