import AuthGuard from '@/components/shared/AuthGuard';
import PageContainer from '@/components/ui/PageContainer';
import { AuthError, requireCreator } from '@/lib/auth/helpers';
import { fetchCasterData } from '@/lib/broadcast/caster-data';
import type { TeamViewer } from '@/lib/team/visibility';
import CheatSheet from '@/components/broadcast/caster/CheatSheet';
import Link from 'next/link';
import { getT } from '@/i18n/server';
import { creatorMessages } from '@/i18n/messages/creator';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ mid: string }>;
}

export default async function CheatSheetPage({ params }: Props) {
  const t = await getT(creatorMessages);
  let viewer: TeamViewer;
  try {
    const player = await requireCreator();
    viewer = { viewerId: player.playerId, isAdmin: player.isAdmin };
  } catch (err) {
    // Only an auth refusal shows the creator-required notice; a failed live
    // read is not "not a creator" and reaches the error boundary.
    if (!(err instanceof AuthError)) throw err;
    return (
      <AuthGuard>
        <PageContainer title={t('cheatSheet.title')}>
          <p className="text-poke-text-secondary">{t('cheatSheet.creatorRequired')}</p>
        </PageContainer>
      </AuthGuard>
    );
  }

  const { mid } = await params;
  const data = await fetchCasterData(mid, viewer);

  if (!data) {
    return (
      <AuthGuard>
        <PageContainer title={t('cheatSheet.title')}>
          <p className="text-poke-text-secondary">{t('cheatSheet.matchNotFound')}</p>
          <Link href="/dashboard/broadcast" className="text-poke-accent text-sm mt-2 inline-block">
            {t('cheatSheet.back')}
          </Link>
        </PageContainer>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <PageContainer
        title={t('tracker.matchTitle', { player1: data.player1.name, player2: data.player2.name })}
        subtitle={t('cheatSheet.title')}
      >
        <CheatSheet data={data} />
      </PageContainer>
    </AuthGuard>
  );
}
