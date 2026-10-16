import { defineNamespace } from '@/i18n/define';
import en from './en';
import de from './de';

/** BRIDGE: see `en.ts`. Deleted by the sweep once the shared components localize themselves. */
export const leagueHubSharedMessages = defineNamespace('league-hub/shared', en, de);
