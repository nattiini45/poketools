import type { CompetitionOwner } from '@/types/competition-owner';

export type LeaguePhaseAddress = Pick<Extract<CompetitionOwner, { kind: 'phase' }>, 'season_id' | 'phase_id'>;

export function phaseHref({ season_id, phase_id }: LeaguePhaseAddress) {
  return `/leagues/${encodeURIComponent(season_id)}/phases/${encodeURIComponent(phase_id)}`;
}

export function phaseStatsHref(owner: LeaguePhaseAddress) {
  return `${phaseHref(owner)}/stats`;
}

export function phaseMatchHref(owner: LeaguePhaseAddress, matchId: string) {
  return `${phaseMatchHrefPrefix(owner)}/${encodeURIComponent(matchId)}`;
}

export function phaseMatchHrefPrefix(owner: LeaguePhaseAddress) {
  return `${phaseHref(owner)}/matches`;
}

export function adminPhaseHref(owner: LeaguePhaseAddress) {
  return `/admin${phaseHref(owner)}`;
}
