import { defineNamespace } from '@/i18n/define';
import en from './en';
import de from './de';

export const errorsCommon = defineNamespace('errors/common', en, de);
