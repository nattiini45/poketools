import { defineNamespace } from '@/i18n/define';
import en from './en';
import de from './de';

export const draftScreenMessages = defineNamespace('draft/screen', en, de);
export type DraftScreenEn = typeof en;
