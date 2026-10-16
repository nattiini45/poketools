import { requireCreator, AuthError } from '@/lib/auth/helpers';
import { getCastSessionById } from '@/lib/supabase/queries/cast-sessions';
import { redirect, notFound } from 'next/navigation';
import { CastStudioProvider } from '@/components/creator/studio/CastStudioContext';
import CastStudio from '@/components/creator/studio/CastStudio';

interface Props {
  params: Promise<{ sessionId: string }>;
}

export default async function CastStudioSessionPage({ params }: Props) {
  const { sessionId } = await params;

  let playerId: string;
  try {
    const player = await requireCreator();
    playerId = player.playerId;
  } catch (err) {
    if (err instanceof AuthError) redirect('/');
    throw err;
  }

  const session = await getCastSessionById(sessionId);
  if (!session) notFound();
  if (session.owner_id !== playerId) redirect('/creator/studio');
  if (session.mode === 'solo') redirect(`/creator/studio/${sessionId}/solo`);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <CastStudioProvider session={session}>
        <CastStudio />
      </CastStudioProvider>
    </div>
  );
}
