import type { Metadata } from 'next';
import Link from 'next/link';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewPlate from '@/components/ui/SkewPlate';
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
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-heading text-display text-fg">{t('overlaysPage.title')}</h1>
        <p className="mt-1 text-body text-fg-muted">{t('overlaysPage.comingSoon')}</p>
      </header>

      <div className="flex flex-col items-center gap-5 rounded-poke-lg border border-hairline bg-surface px-6 py-12 text-center">
        <ItemIcon item="poke-doll" size={72} />
        <p className="max-w-md text-body text-fg-muted">{t('overlaysPage.empty')}</p>
        <Link
          href="/creator/studio"
          className="inline-flex min-h-11 items-center text-body transition-transform duration-80 ease-out hover:-translate-y-0.5 active:translate-y-0 motion-reduce:transform-none"
        >
          <SkewPlate variant="button" className="px-5 py-2.5">
            {t('quickActions.newSession.title')}
          </SkewPlate>
        </Link>
      </div>
    </div>
  );
}
