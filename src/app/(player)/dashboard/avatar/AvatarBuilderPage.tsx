'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import AvatarBuilder from '@/components/avatar/AvatarBuilder';
import PlayerUsernamesEditor from '@/components/player/PlayerUsernamesEditor';
import { useRefreshSessionPlayer } from '@/components/shared/SessionProvider';
import PageContainer from '@/components/ui/PageContainer';
import Section from '@/components/ui/Section';
import { useT } from '@/i18n/client';
import { avatarMessages } from '@/i18n/messages/avatar';
import type { AvatarConfig } from '@/types/avatar';
import type { Player } from '@/types/player';

interface AvatarBuilderPageProps {
  playerId: string;
  initialConfig: AvatarConfig | null;
  initialPlayer: Player | null;
}

export default function AvatarBuilderPage({ playerId, initialConfig, initialPlayer }: AvatarBuilderPageProps) {
  const t = useT(avatarMessages);
  const refreshSessionPlayer = useRefreshSessionPlayer();
  return (
    <PageContainer
      title={t('page.title')}
      subtitle={t('page.subtitle')}
      action={
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center gap-1.5 text-body font-[550] text-accent-ink underline-offset-4 hover:underline sm:min-h-0"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('page.back')}
        </Link>
      }
    >
      {/* Avatar builder (2/3) + usernames editor (1/3) */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title={t('page.builderHeading')}>
            <AvatarBuilder
              playerId={playerId}
              initialConfig={initialConfig}
              onSaved={async () => {
                // The session re-reads its player at most every 5 minutes
                // (D37), so a hard navigation alone would show the old
                // avatar_url, whose Storage object is already deleted. Force
                // the re-read first. A failed or stalled refresh (the hook
                // gives up after SESSION_SELF_EDIT_REFRESH_TIMEOUT_MS) still
                // navigates: the write stands and the session catches up
                // within the TTL. AvatarBuilder awaits this handler, so its
                // buttons stay disabled until the navigation starts.
                await refreshSessionPlayer();
                // Hard navigation bypasses the client-side Router Cache.
                window.location.href = '/dashboard';
              }}
            />
          </Section>
        </div>

        <div className="lg:col-span-1">
          <PlayerUsernamesEditor
            playerId={playerId}
            initialPlayer={initialPlayer}
          />
        </div>
      </div>
    </PageContainer>
  );
}
