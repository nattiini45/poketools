import { isSeasonClosed } from '@/lib/season/season-state';
import type { SeasonWithDetails } from '@/types/season';
import { LEAGUE_ADMIN_DANGER_SECTION, availableLeagueAdminTabs, leagueAdminHref } from './tabs';

/**
 * What a league needs from its admin, for the Overview tab's attention list. Decided from the league row alone
 * (no read): what is missing before the league can run, and whether it is archived. Waiting matches and open
 * checks are not listed here, because the overview does not read them; they are on the Phases and Live tabs.
 *
 * Pure and client-safe.
 */
export type LeagueAttentionId = 'archived' | 'noParticipants' | 'noPhases' | 'noRuleset' | 'noStartDate';

export interface LeagueAttentionItem {
  id: LeagueAttentionId;
  /** Where it is fixed. */
  href: string;
}

export type LeagueAttentionInput = Pick<
  SeasonWithDetails,
  'id' | 'status' | 'archived' | 'format_type' | 'participant_count' | 'tournament_count' | 'ruleset_id' | 'start_date'
>;

export function leagueAttention(league: LeagueAttentionInput): LeagueAttentionItem[] {
  const items: LeagueAttentionItem[] = [];
  if (league.archived) items.push({ id: 'archived', href: leagueAdminHref(league.id, 'settings', LEAGUE_ADMIN_DANGER_SECTION) });
  // A closed league needs no set-up; a custom league's set-up is its readiness checklist.
  if (isSeasonClosed(league) || availableLeagueAdminTabs(league.format_type).includes('live')) return items;
  if (league.participant_count === 0) items.push({ id: 'noParticipants', href: leagueAdminHref(league.id, 'participants') });
  if (league.tournament_count === 0) items.push({ id: 'noPhases', href: leagueAdminHref(league.id, 'phases') });
  if (league.ruleset_id === null) items.push({ id: 'noRuleset', href: leagueAdminHref(league.id, 'settings') });
  if (league.start_date === null) items.push({ id: 'noStartDate', href: leagueAdminHref(league.id, 'settings') });
  return items;
}
