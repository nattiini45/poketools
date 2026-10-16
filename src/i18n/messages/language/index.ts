import { defineNamespace } from '@/i18n/define';
import en from './en';
import de from './de';

export const languageMessages = defineNamespace('language', en, de);
