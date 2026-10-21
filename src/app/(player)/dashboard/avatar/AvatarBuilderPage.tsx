'use client';

import Link from 'next/link';
import AvatarBuilder from '@/components/avatar/AvatarBuilder';
import PlayerUsernamesEditor from '@/components/player/PlayerUsernamesEditor';
import { useRefreshSessionPlayer } from '@/components/shared/SessionProvider';
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
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-heading font-bold text-poke-text-primary">
            {t('page.title')}
          </h1>
          <p className="text-sm text-poke-text-muted mt-1">
            {t('page.subtitle')}
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-poke-text-secondary hover:text-poke-text-primary transition-colors"
        >
          {t('page.back')}
        </Link>
      </div>

      {/* Main content grid: Avatar builder (2/3) + Usernames editor (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Avatar Builder - takes 2/3 on large screens */}
        <div className="lg:col-span-2">
          <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-6">
            <h2 className="text-lg font-heading font-bold text-poke-text-primary mb-4">
              {t('page.builderHeading')}
            </h2>
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
          </div>
        </div>

        {/* Usernames Editor - takes 1/3 on large screens */}
        <div className="lg:col-span-1">
          <PlayerUsernamesEditor
            playerId={playerId}
            initialPlayer={initialPlayer}
          />
        </div>
      </div>
    </div>
  );
}
