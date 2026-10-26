import type { ReactNode } from 'react';
import type { Translator } from '@/i18n/core';
import type { FormatCapabilities } from '@/lib/season/format-capabilities';
import type { LeagueAdminTab } from '@/lib/league-admin/tabs';
import type { SeasonWithDetails } from '@/types/season';
import type seasonPageEn from '@/i18n/messages/league-admin/season-page/en';

/**
 * What every league admin tab panel gets from the page: the league row (the
 * only read every tab shares), the live viewer (id and site-admin flag from
 * `getLiveAccess`, not the session copy) and the page's translator. Each panel
 * performs its own reads and nothing else.
 */
export interface LeagueAdminPanelContext {
  id: string;
  league: SeasonWithDetails;
  caps: FormatCapabilities;
  /** The viewing admin's player id: which private rulesets the ruleset select may list. */
  playerId: string;
  /** Site admin now, from the live player row (D37), as the admin layout decides it. */
  isSiteAdmin: boolean;
  t: Translator<typeof seasonPageEn>;
  /** A link to another tab of this page (rich-text `<link>` chunks). */
  tabLink: (tab: LeagueAdminTab) => (chunks: ReactNode) => ReactNode;
}
