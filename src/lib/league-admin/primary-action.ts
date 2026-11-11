import { FORMAT_ATTACH_ANCHOR } from '@/lib/format-studio/editor/readiness';
import { seasonMachine } from '@/lib/season/season-state';
import type { SeasonFormatType, SeasonStatus } from '@/types/season';
import { availableLeagueAdminTabs, leagueAdminHref } from './tabs';

/**
 * The one primary action in the league workspace header. It is decided from the league row the page already
 * holds and from the league machine's legal admin moves (`seasonMachine.transitionsFrom`), never from a status
 * list of its own, and it costs no read: where the real next step needs data the header does not have (the next
 * round number, the count of open checks), the action is a link to the tab that reads it.
 *
 * Pure and client-safe.
 */
export type LeaguePrimaryAction =
  /** A status move the header performs itself (PATCH `/api/seasons/[id]`). */
  | { id: 'activate'; kind: 'status'; to: SeasonStatus }
  | {
      id: 'attachFormat' | 'addParticipants' | 'addPhase' | 'manageRounds' | 'reviewChecks' | 'publicPage';
      kind: 'link';
      href: string;
    };

export interface LeaguePrimaryActionInput {
  id: string;
  status: SeasonStatus;
  archived: boolean;
  formatType: SeasonFormatType;
  participantCount: number;
  phaseCount: number;
  /** The league cannot become active yet (a custom league without an attached format). */
  activateBlocked: boolean;
}

export function leaguePrimaryAction(input: LeaguePrimaryActionInput): LeaguePrimaryAction | null {
  // An archived league is out of the active lists; its way back is the danger zone, not a header action.
  if (input.archived) return null;
  const link = (id: Exclude<LeaguePrimaryAction['id'], 'activate'>, href: string): LeaguePrimaryAction => ({ id, kind: 'link', href });
  const moves = seasonMachine.transitionsFrom(input.status, 'admin');
  const hasLive = availableLeagueAdminTabs(input.formatType).includes('live');

  const start = moves.find((move) => move.event === 'start');
  if (start) {
    if (input.activateBlocked) return link('attachFormat', leagueAdminHref(input.id, 'format', FORMAT_ATTACH_ANCHOR));
    if (input.participantCount === 0) return link('addParticipants', leagueAdminHref(input.id, 'participants'));
    // A custom league gets its phases from the attached format.
    if (!hasLive && input.phaseCount === 0) return link('addPhase', leagueAdminHref(input.id, 'phases'));
    return { id: 'activate', kind: 'status', to: start.to };
  }
  // A league that can only be reopened is over: its result is on the public page.
  if (moves.some((move) => move.event === 'reopen')) return link('publicPage', `/leagues/${input.id}`);
  // A running league: its checks inbox (custom) or its rounds.
  return hasLive ? link('reviewChecks', leagueAdminHref(input.id, 'live')) : link('manageRounds', leagueAdminHref(input.id, 'phases'));
}
