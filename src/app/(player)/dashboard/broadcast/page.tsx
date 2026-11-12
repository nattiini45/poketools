import AuthGuard from '@/components/shared/AuthGuard';
import PageContainer from '@/components/ui/PageContainer';
import SkewChip from '@/components/ui/SkewChip';
import AdminEmpty from '@/components/admin/AdminEmpty';
import { requireLiveIdentityOrSignIn } from '@/lib/auth/redirect-to-sign-in';
import { getMatchesByPlayer } from '@/lib/supabase/queries/matches';
import Link from 'next/link';
import { getT } from '@/i18n/server';
import { creatorMessages } from '@/i18n/messages/creator';
import { enumMessages } from '@/i18n/messages/enums';
import { enumLabel } from '@/i18n/content/enum-label';

export const dynamic = 'force-dynamic';

export const revalidate = 0;

export default async function BroadcastHubPage() {
  const { player } = await requireLiveIdentityOrSignIn();
  const t = await getT(creatorMessages);

  if (!player) {
    return (
      <AuthGuard>
        <PageContainer title={t('broadcastHub.title')}>
          <p className="text-body text-fg-muted">{t('broadcastHub.notRegistered')}</p>
        </PageContainer>
      </AuthGuard>
    );
  }

  const matches = await getMatchesByPlayer(player.playerId);
  const tEnum = await getT(enumMessages);

  // Show pending and in_progress matches — these are trackable
  const activeMatches = matches.filter(
    (m) => m.status === 'scheduled' || m.status === 'in_progress'
  );
  const recentCompleted = matches
    .filter((m) => m.status === 'completed')
    .slice(0, 5);

  return (
    <AuthGuard>
      <PageContainer title={t('broadcastHub.title')}>
        <p className="-mt-3 text-body text-fg-muted">{t('broadcastHub.intro')}</p>

        {/* Active matches */}
        {activeMatches.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="font-heading text-title text-fg">{t('broadcastHub.activeMatches')}</h2>
            {activeMatches.map((match) => (
              <Link
                key={match.id}
                href={`/dashboard/broadcast/${match.id}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-poke-lg border border-hairline bg-surface px-4 py-3 transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-body font-[550] text-fg">{match.player_1_name}</span>
                  <span className="text-caption text-fg-muted">{t('broadcastHub.versus')}</span>
                  <span className="text-body font-[550] text-fg">{match.player_2_name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <SkewChip tone={match.status === 'in_progress' ? 'live' : 'neutral'}>
                    {enumLabel(tEnum, 'matchStatus', match.status)}
                  </SkewChip>
                  <span className="text-body font-[550] text-accent-ink">{t('broadcastHub.track')}</span>
                </div>
              </Link>
            ))}
          </section>
        ) : (
          <AdminEmpty title={t('broadcastHub.noActive')} />
        )}

        {/* Recently completed */}
        {recentCompleted.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="font-heading text-title text-fg">{t('broadcastHub.recentlyCompleted')}</h2>
            {recentCompleted.map((match) => (
              <div
                key={match.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-poke-lg border border-hairline bg-surface px-4 py-3"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-body text-fg">{match.player_1_name}</span>
                  <span className="text-caption text-fg-muted">{t('broadcastHub.versus')}</span>
                  <span className="text-body text-fg">{match.player_2_name}</span>
                </div>
                <span className="text-caption font-[550] text-win">
                  {/* No winner name (e.g. a draw or a deleted player): show the neutral status label. */}
                  {match.winner_name
                    ? t('broadcastHub.winnerWon', { name: match.winner_name })
                    : enumLabel(tEnum, 'matchStatus', match.status)}
                </span>
              </div>
            ))}
          </section>
        )}
      </PageContainer>
    </AuthGuard>
  );
}
