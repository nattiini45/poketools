import { defineNamespace } from '@/i18n/define';
import en from './en';
import de from './de';

/** The English source shape of `world/evoliga` (for `Translator<WorldEvoligaEn>` in helpers). */
export type WorldEvoligaEn = typeof en;

export const worldEvoligaMessages = defineNamespace('world/evoliga', en, de);
