import type { ItemIconId } from '@/lib/pkmn/item-icons';
import type { LeagueAdminTab } from '@/lib/league-admin/tabs';

/** The item icon of each league workspace tab (the approved map: league tabs and workspace). */
export const LEAGUE_ADMIN_TAB_ICONS: Readonly<Record<LeagueAdminTab, ItemIconId>> = {
  overview: 'town-map',
  participants: 'lucky-egg',
  phases: 'metronome',
  format: 'up-grade',
  draft: 'premier-ball',
  live: 'electric-seed',
  settings: 'everstone',
};
