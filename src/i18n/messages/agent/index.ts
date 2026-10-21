import { defineNamespace } from '@/i18n/define';
import en from './en';
import de from './de';

export const agentMessages = defineNamespace('agent', en, de);
