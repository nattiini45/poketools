import AuthGuard from '@/components/shared/AuthGuard';
import PageContainer from '@/components/ui/PageContainer';
import { getSession } from '@/lib/auth/helpers';
import { getMatchesByPlayer } from '@/lib/supabase/queries/matches';
import Link from 'next/link';
import { getT } from '@/i18n/server';
import { creatorMessages } from '@/i18n/messages/creator';
import { enumMessages } from '@/i18n/messages/enums';
import { enumLabel } from '@/i18n/content/enum-label';

export const dynamic = 'force-dynamic';

export const revalidate = 0;

export default async function BroadcastHubPage() {
  const session = await getSession();
  const t = await getT(creatorMessages);

  if (!session?.player) {
    return (
      <AuthGuard>
        <PageContainer title={t('broadcastHub.title')}>
          <p className="text-poke-text-secondary">{t('broadcastHub.notRegistered')}</p>
        </PageContainer>
      </AuthGuard>
    );
  }

  const matches = await getMatchesByPlayer(session.player.playerId);
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
        <p className="text-sm text-poke-text-secondary mb-6">
          {t('broadcastHub.intro')}
        </p>

        {/* Active matches */}
        {activeMatches.length > 0 ? (
          <div className="flex flex-col gap-3 mb-8">
            <h3 className="text-sm font-semibold text-poke-text-secondary uppercase tracking-wider">
              {t('broadcastHub.activeMatches')}
            </h3>
            {activeMatches.map((match) => (
              <Link
                key={match.id}
                href={`/dashboard/broadcast/${match.id}`}
                className="flex items-center justify-between px-4 py-3 rounded-xl bg-poke-surface border border-poke-border hover:border-poke-accent transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-poke-text">
                    {match.player_1_name}
                  </span>
                  <span className="text-xs text-poke-text-secondary">{t('broadcastHub.versus')}</span>
                  <span className="text-sm font-semibold text-poke-text">
                    {match.player_2_name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      match.status === 'in_progress'
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-blue-500/20 text-blue-400'
                    }`}
                  >
                    {enumLabel(tEnum, 'matchStatus', match.status)}
                  </span>
                  <span className="text-poke-accent text-sm">{t('broadcastHub.track')}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-poke-text-secondary text-sm">
            {t('broadcastHub.noActive')}
          </div>
        )}

        {/* Recently completed */}
        {recentCompleted.length > 0 && (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-poke-text-secondary uppercase tracking-wider">
              {t('broadcastHub.recentlyCompleted')}
            </h3>
            {recentCompleted.map((match) => (
              <div
                key={match.id}
                className="flex items-center justify-between px-4 py-3 rounded-xl bg-poke-surface/50 border border-poke-border/30"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm text-poke-text">
                    {match.player_1_name}
                  </span>
                  <span className="text-xs text-poke-text-secondary">{t('broadcastHub.versus')}</span>
                  <span className="text-sm text-poke-text">
                    {match.player_2_name}
                  </span>
                </div>
                <span className="text-xs text-emerald-400 font-semibold">
                  {/* No winner name (e.g. a draw or a deleted player): show the neutral status label. */}
                  {match.winner_name
                    ? t('broadcastHub.winnerWon', { name: match.winner_name })
                    : enumLabel(tEnum, 'matchStatus', match.status)}
                </span>
              </div>
            ))}
          </div>
        )}
      </PageContainer>
    </AuthGuard>
  );
}
