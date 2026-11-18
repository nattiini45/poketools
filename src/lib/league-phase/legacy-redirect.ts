import 'server-only';
import { findNativePhaseAliasOwner, type PhaseAliasInput } from '@/lib/supabase/queries/phase-route-owners';
import { isValidUuid } from '@/lib/utils/uuid';
import { getPhaseRouteMode } from './route-mode';
import { adminPhaseHref, phaseHref, phaseMatchHref, phaseStatsHref } from './paths';

const OLD_TOURNAMENT_PATH = /^\/tournaments\/([^/]+)(?:\/(stats|matches\/([^/]+)))?\/?$/;
const OLD_TOURNAMENT_ADMIN = /^\/admin\/tournaments\/([^/]+)\/rounds\/?$/;
const OLD_MATCH_PATH = /^\/matches\/([^/]+)\/?$/;

export function parseLegacyPhasePath(pathname: string): { target: PhaseAliasInput; page: 'detail' | 'stats' | 'match' | 'admin' } | null {
  const tournament = OLD_TOURNAMENT_PATH.exec(pathname);
  const admin = OLD_TOURNAMENT_ADMIN.exec(pathname);
  const match = OLD_MATCH_PATH.exec(pathname);
  if (!tournament && !admin && !match) return null;
  let phaseId = tournament?.[1] ?? admin?.[1];
  let matchId = tournament?.[3] ?? match?.[1];
  try {
    if (phaseId !== undefined) phaseId = decodeURIComponent(phaseId).toLowerCase();
    if (matchId !== undefined) matchId = decodeURIComponent(matchId).toLowerCase();
  } catch {
    return null;
  }
  if ((phaseId !== undefined && !isValidUuid(phaseId)) || (matchId !== undefined && !isValidUuid(matchId))) return null;
  const target = phaseId !== undefined
    ? { phaseId, ...(matchId === undefined ? {} : { matchId }) }
    : matchId === undefined ? null : { matchId };
  if (!target) return null;
  return { target, page: admin ? 'admin' : matchId !== undefined ? 'match' : tournament?.[2] === 'stats' ? 'stats' : 'detail' };
}

export async function resolveLegacyPhaseRedirect(pathname: string, query: URLSearchParams): Promise<string | null> {
  const parsed = parseLegacyPhasePath(pathname);
  if (!parsed) return null;
  if (await getPhaseRouteMode() !== 'phase') return null;
  return nativePhaseRedirect(parsed, query);
}

export async function nativePhaseRedirect(
  { target, page }: NonNullable<ReturnType<typeof parseLegacyPhasePath>>,
  query: URLSearchParams,
) {
  const owner = await findNativePhaseAliasOwner(target);
  if (!owner) return null;
  const href = page === 'admin' ? adminPhaseHref(owner) : target.matchId !== undefined ? phaseMatchHref(owner, target.matchId)
    : page === 'stats' ? phaseStatsHref(owner) : phaseHref(owner);
  const search = query.toString();
  return search === '' ? href : `${href}?${search}`;
}
