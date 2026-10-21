import CreatorGuard from '@/components/shared/CreatorGuard';
import PageContainer from '@/components/ui/PageContainer';
import ContentDashboardClient from '@/components/content/ContentDashboardClient';
import { getSession } from '@/lib/auth/helpers';
import { listAllMatches } from '@/lib/supabase/queries/matches';
import { toPublicMatches } from '@/lib/match/public-match';
import { listSeasons } from '@/lib/supabase/queries/seasons';
import { getPresetsByOwner } from '@/lib/supabase/queries/broadcast-presets';
import { listDraftPools } from '@/lib/supabase/queries/drafts';
import { getT } from '@/i18n/server';
import { discoverMessages } from '@/i18n/messages/discover';

export const dynamic = 'force-dynamic';

export const revalidate = 0;

export default async function ContentPage() {
  const [session, t] = await Promise.all([getSession(), getT(discoverMessages)]);
  const playerId = session?.player?.playerId;

  if (!playerId) {
    return (
      <CreatorGuard>
        <PageContainer title={t('content.title')}>
          <p className="text-poke-text-secondary">{t('content.notPlayer')}</p>
        </PageContainer>
      </CreatorGuard>
    );
  }

  const [matchRows, seasons, presets, draftPools] = await Promise.all([
    listAllMatches(),
    listSeasons(),
    getPresetsByOwner(playerId),
    listDraftPools(),
  ]);
  // Creators are not admins: the client dashboard receives the public match
  // shape only (no admin notes, submitter or confirmation timestamps).
  const matches = toPublicMatches(matchRows);

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
