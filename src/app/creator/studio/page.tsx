import type { Metadata } from 'next';
import { requireCreator } from '@/lib/auth/helpers';
import { redirect } from 'next/navigation';
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
  try {
    await requireCreator();
  } catch {
    redirect('/');
  }

  const t = await getT(creatorMessages);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="font-heading text-3xl font-bold text-poke-text-primary mb-6">
        {t('studioPage.title')}
      </h1>
      <SessionManager />
    </div>
  );
}
