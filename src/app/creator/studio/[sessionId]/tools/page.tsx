import { requireCreator, AuthError } from '@/lib/auth/helpers';
import { getCastSessionById } from '@/lib/supabase/queries/cast-sessions';
import { redirect, notFound } from 'next/navigation';
import ToolsLayout from '@/components/creator/studio/tools/ToolsLayout';
import { getT } from '@/i18n/server';
import { creatorMessages } from '@/i18n/messages/creator';

interface Props {
  params: Promise<{ sessionId: string }>;
}

export default async function CastStudioToolsPage({ params }: Props) {
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

  const t = await getT(creatorMessages);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="font-heading text-2xl font-bold text-poke-text-primary mb-4">
        {t('toolsPage.title')}
      </h1>
      <p className="text-sm text-poke-text-secondary mb-6">
        {t('toolsPage.intro', { name: session.name })}
      </p>
      <ToolsLayout sessionId={sessionId} realtimeKey={session.realtime_key} generation={session.generation} />
    </div>
  );
}
