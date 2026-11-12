import { gateCreatorPage } from '@/components/shared/creator-page-gate';
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

  const gate = await gateCreatorPage();
  if (!gate.ok) return gate.view;
  const playerId = gate.playerId;

  const session = await getCastSessionById(sessionId);
  if (!session) notFound();
  if (session.owner_id !== playerId) redirect('/creator/studio');

  const t = await getT(creatorMessages);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="font-heading text-display text-fg">{t('toolsPage.title')}</h1>
        <p className="mt-1 text-body text-fg-muted">{t('toolsPage.intro', { name: session.name })}</p>
      </header>
      <ToolsLayout sessionId={sessionId} realtimeKey={session.realtime_key} generation={session.generation} />
    </div>
  );
}
