import type { Metadata } from 'next';
import { gateCreatorPage } from '@/components/shared/creator-page-gate';
import SessionManager from '@/components/creator/studio/SessionManager';
import { getT } from '@/i18n/server';
import { creatorMessages } from '@/i18n/messages/creator';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(creatorMessages);
  return {
    title: t('meta.studioTitle'),
    description: t('meta.studioDescription'),
  };
}

export default async function CastStudioPage() {
  const gate = await gateCreatorPage();
  if (!gate.ok) return gate.view;

  const t = await getT(creatorMessages);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-heading text-display text-fg">{t('studioPage.title')}</h1>
      </header>
      <SessionManager />
    </div>
  );
}
