import { defineNamespace } from '@/i18n/define';
import en from './en';
import de from './de';

export const contentMessages = defineNamespace('content', en, de);
