import type { Metadata } from 'next';
import { requireCreator } from '@/lib/auth/helpers';
import { getT } from '@/i18n/server';
import { creatorMessages } from '@/i18n/messages/creator';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(creatorMessages);
  return { title: t('meta.overlaysTitle') };
}

export default async function OverlaysPage() {
  await requireCreator();
  const t = await getT(creatorMessages);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-heading font-bold text-poke-text-primary">
          {t('overlaysPage.title')}
        </h1>
        <p className="text-sm text-poke-text-secondary mt-1">
          {t('overlaysPage.comingSoon')}
        </p>
      </header>

      <div className="rounded-poke-lg border border-poke-border bg-poke-surface p-8 text-center">
        <p className="text-poke-text-secondary text-sm">
          {t('overlaysPage.empty')}
        </p>
      </div>
    </div>
  );
}
