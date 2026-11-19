import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { gateCreatorPage } from '@/components/shared/creator-page-gate';
import { getStudioCastSession } from '@/lib/broadcast/studio-sessions.server';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { getCastSessionById } from '@/lib/supabase/queries/cast-sessions';
import { isValidUuid } from '@/lib/utils/uuid';

export async function loadStudioSessionPage(sessionId: string) {
  const gate = await gateCreatorPage();
  if (!gate.ok) return gate;
  const mode = await requireOpenPhaseRouteMode();
  if (mode === 'phase' && !isValidUuid(sessionId)) notFound();
  const session = mode === 'phase' ? await getStudioCastSession(sessionId) : await getCastSessionById(sessionId);
  if (!session) notFound();
  if (session.owner_id !== gate.playerId) redirect('/creator/studio');
  return { ok: true as const, session, phaseMode: mode === 'phase' };
}
