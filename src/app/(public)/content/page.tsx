import CreatorGuard from '@/components/shared/CreatorGuard';
import PageContainer from '@/components/ui/PageContainer';
import ContentDashboardClient from '@/components/content/ContentDashboardClient';
import { getLiveAccess } from '@/lib/auth/helpers';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { listContentMatches } from '@/lib/supabase/queries/creator-content';
import { listSeasons } from '@/lib/supabase/queries/seasons';
import { getPresetsByOwner } from '@/lib/supabase/queries/broadcast-presets';
import { listDraftPools } from '@/lib/supabase/queries/drafts';
import { getT } from '@/i18n/server';
import { discoverMessages } from '@/i18n/messages/discover';

export const dynamic = 'force-dynamic';

export const revalidate = 0;

export default async function ContentPage() {
  const [access, t] = await Promise.all([getLiveAccess(), getT(discoverMessages)]);
  const playerId = access?.player?.playerId;

  if (!access?.isCreator || !playerId) {
    return (
      <CreatorGuard>
        <PageContainer title={t('content.title')}>
          <p className="text-fg-muted">{t('content.notPlayer')}</p>
        </PageContainer>
      </CreatorGuard>
    );
  }

  const mode = await getPhaseRouteMode();
  const [matches, seasons, presets, draftPools] = await Promise.all([
    listContentMatches(mode),
    listSeasons(mode === 'phase' || mode === 'frozen_phase' ? { storage: 'phase' } : undefined),
    getPresetsByOwner(playerId),
    listDraftPools(),
  ]);

  return (
    <CreatorGuard>
      <PageContainer
        title={t('content.title')}
        subtitle={t('content.subtitle')}
      >
        <ContentDashboardClient
          matches={matches}
          seasons={seasons}
          draftPools={draftPools}
          presets={presets}
          playerId={playerId}
        />
      </PageContainer>
    </CreatorGuard>
  );
}
