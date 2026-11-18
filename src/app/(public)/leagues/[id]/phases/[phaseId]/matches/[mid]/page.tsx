import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getT } from '@/i18n/server';
import { matchMessages } from '@/i18n/messages/match';
import { phasePublicReads } from '@/lib/cache/phase-public-reads';
import { phaseHref, phaseMatchHref } from '@/lib/league-phase/paths';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { renderLegacyMatchDetail } from '@/lib/match/render-legacy-match-detail';
import { renderNativeMatchDetail } from '@/lib/match/render-native-match-detail';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { findNativePhaseAliasOwner, resolveLeaguePhaseRoute } from '@/lib/supabase/queries/phase-route-owners';
import { isValidUuid } from '@/lib/utils/uuid';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string; phaseId: string; mid: string }>;
}

const readMatchRoute = cache(async (seasonId: string, phaseId: string, matchId: string) => {
  if (!isValidUuid(seasonId) || !isValidUuid(phaseId) || !isValidUuid(matchId)) return null;
  const address = { season_id: seasonId, phase_id: phaseId };
  const mode = await requireOpenPhaseRouteMode();
  if (mode === 'legacy') {
    const owner = await resolveLeaguePhaseRoute(seasonId, phaseId, mode);
    if (owner?.kind !== 'tournament' || owner.season_id !== seasonId || owner.tournament_id !== phaseId) return null;
    const match = await getMatchById(matchId);
    return match?.id === matchId && match.tournament_id === owner.tournament_id
      ? { kind: 'legacy' as const, address, match }
      : null;
  }

  const owner = await findNativePhaseAliasOwner({ phaseId, matchId });
  if (owner?.season_id !== seasonId || owner.phase_id !== phaseId) return null;
  const match = await phasePublicReads.match(owner.phase_id, matchId);
  return match?.id === matchId && match.phase_id === owner.phase_id
    ? { kind: 'phase' as const, address, match }
    : null;
});

async function loadMatchRoute(params: PageProps['params']) {
  const { id, phaseId, mid } = await params;
  return readMatchRoute(id.toLowerCase(), phaseId.toLowerCase(), mid.toLowerCase());
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const entry = await loadMatchRoute(params);
  if (!entry) return {};
  const t = await getT(matchMessages);
  return {
    title: t('detail.heading', { player1: entry.match.player_1_name, player2: entry.match.player_2_name }),
    alternates: { canonical: phaseMatchHref(entry.address, entry.match.id) },
  };
}

export default async function PhaseMatchDetailPage({ params }: PageProps) {
  const entry = await loadMatchRoute(params);
  if (!entry) notFound();
  const { address } = entry;
  const href = phaseHref(address);
  return entry.kind === 'legacy'
    ? renderLegacyMatchDetail(address.phase_id, entry.match.id, {
      seasonId: address.season_id, href, match: entry.match,
    })
    : renderNativeMatchDetail(address.season_id, entry.match, href);
}
