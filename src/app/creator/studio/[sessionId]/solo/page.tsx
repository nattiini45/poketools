import { gateCreatorPage } from '@/components/shared/creator-page-gate';
import { getCastSessionById } from '@/lib/supabase/queries/cast-sessions';
import { redirect, notFound } from 'next/navigation';
import { CastStudioProvider } from '@/components/creator/studio/CastStudioContext';
import SoloLayout from '@/components/creator/studio/solo/SoloLayout';

interface Props {
  params: Promise<{ sessionId: string }>;
}

export default async function SoloStreamerPage({ params }: Props) {
  const { sessionId } = await params;

  const gate = await gateCreatorPage();
  if (!gate.ok) return gate.view;
  const playerId = gate.playerId;

  const session = await getCastSessionById(sessionId);
  if (!session) notFound();
  if (session.owner_id !== playerId) redirect('/creator/studio');

  return (
    <div>
      <CastStudioProvider session={session}>
        <SoloLayout />
      </CastStudioProvider>
    </div>
  );
}
