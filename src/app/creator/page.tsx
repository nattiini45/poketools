import type { Metadata } from 'next';
import { getSessionPlayer } from '@/lib/auth/helpers';
import QuickActions from '@/components/creator/QuickActions';
import RecentSessions from '@/components/creator/RecentSessions';
import OverlayGallery from '@/components/creator/OverlayGallery';
import Link from 'next/link';
import { getT } from '@/i18n/server';
import { creatorMessages } from '@/i18n/messages/creator';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(creatorMessages);
  return { title: t('meta.hubTitle') };
}

export default async function CreatorHubPage() {
  const player = await getSessionPlayer();
  const t = await getT(creatorMessages);

  if (!player) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-16">
        <h1 className="text-2xl font-heading font-bold text-poke-text-primary">
          {t('hub.title')}
        </h1>
        <p className="text-poke-text-secondary text-center max-w-md">
          {t('hub.signInPrompt')}
        </p>
        <div className="flex gap-3">
          <Link
            href="/api/auth/signin"
            className="px-4 py-2 bg-poke-accent text-poke-surface font-heading font-semibold rounded-poke-md hover:opacity-90 transition-opacity"
          >
            {t('hub.signIn')}
          </Link>
          <Link
            href="/wiki"
            className="px-4 py-2 bg-poke-muted text-poke-text-primary font-heading font-semibold rounded-poke-md hover:bg-poke-elevated transition-colors"
          >
            {t('hub.browseWiki')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-heading font-bold text-poke-text-primary">
          {t('hub.title')}
        </h1>
        <p className="text-sm text-poke-text-secondary mt-1">
          {t('hub.welcome', { name: player.name })}
        </p>
      </header>

      <QuickActions />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <RecentSessions />
        <OverlayGallery />
      </div>
    </div>
  );
}
