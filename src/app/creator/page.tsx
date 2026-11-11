import type { Metadata } from 'next';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { currentSignInPath } from '@/lib/auth/redirect-to-sign-in';
import QuickActions from '@/components/creator/QuickActions';
import RecentSessions from '@/components/creator/RecentSessions';
import OverlayGallery from '@/components/creator/OverlayGallery';
import SkewPlate from '@/components/ui/SkewPlate';
import Link from 'next/link';
import { getT } from '@/i18n/server';
import { creatorMessages } from '@/i18n/messages/creator';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(creatorMessages);
  return { title: t('meta.hubTitle') };
}

const PLATE_LINK =
  'inline-flex min-h-11 items-center text-body transition-transform duration-80 ease-out hover:-translate-y-0.5 active:translate-y-0 motion-reduce:transform-none';

export default async function CreatorHubPage() {
  const player = await getSessionPlayer();
  const t = await getT(creatorMessages);

  if (!player) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-16 text-center">
        <h1 className="font-heading text-display text-fg">{t('hub.title')}</h1>
        <p className="max-w-md text-body text-fg-muted">{t('hub.signInPrompt')}</p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link href={await currentSignInPath()} className={PLATE_LINK}>
            <SkewPlate variant="button" className="px-5 py-2.5">
              {t('hub.signIn')}
            </SkewPlate>
          </Link>
          <Link href="/wiki" className={PLATE_LINK}>
            <SkewPlate variant="button" tone="secondary" className="px-5 py-2.5">
              {t('hub.browseWiki')}
            </SkewPlate>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-heading text-display text-fg">{t('hub.title')}</h1>
        <p className="mt-1 text-body text-fg-muted">{t('hub.welcome', { name: player.name })}</p>
      </header>

      <QuickActions />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <RecentSessions />
        <OverlayGallery />
      </div>
    </div>
  );
}
