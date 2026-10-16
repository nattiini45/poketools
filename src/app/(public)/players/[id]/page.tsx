import Link from 'next/link';
import { notFound } from 'next/navigation';
import PageContainer from '@/components/ui/PageContainer';
import ProfileSection from '@/components/profile/ProfileSection';
import ProfileHeader from '@/components/profile/ProfileHeader';
import ProfilePokemonSpotlight from '@/components/profile/ProfilePokemonSpotlight';
import ProfileParticipations from '@/components/profile/ProfileParticipations';
import ProfileMatchList from '@/components/profile/ProfileMatchList';
import ProfileTrophies from '@/components/profile/ProfileTrophies';
import RatingBadge from '@/components/gamification/RatingBadge';
import RatingHistoryChart from '@/components/gamification/RatingHistoryChart';
import StreakIndicator from '@/components/gamification/StreakIndicator';
import StreakRecords from '@/components/gamification/StreakRecords';
import SignatureTeam from '@/components/gamification/SignatureTeam';
import AchievementGrid from '@/components/gamification/AchievementGrid';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { publicReads } from '@/lib/cache/public-reads';
import { getT } from '@/i18n/server';
import { profileMessages } from '@/i18n/messages/profile';

// Dynamic: the page reads the viewer's session (it gates the match sections).
// The profile, rating history and achievement catalogue come from the tagged
// public read cache (30 s / 60 s); the cached profile's player is already the
// `PublicPlayer` card (an allowlist: no moderation, role or identity columns),
// and the entry is the same for every viewer.
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PlayerProfilePage({ params }: PageProps) {
  const { id } = await params;
  const viewer = await getSessionPlayer();

  const [profile, ratingHistory, achievementDefinitions, t] = await Promise.all([
    publicReads.playerProfile(id),
    publicReads.playerRatingHistory(id, 60),
    publicReads.achievementDefinitions(),
    getT(profileMessages),
  ]);

  if (!profile) {
    notFound();
  }

  const publicPlayer = profile.player;
  const isLoggedIn = viewer != null;

  return (
    <PageContainer maxWidth="xl">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] items-start">
        {/* Identity rail */}
        <div className="space-y-6 lg:sticky lg:top-20">
        <ProfileHeader
          player={publicPlayer}
          headline={profile.headline}
          recentForm={profile.recent_form}
        />

        <ProfileSection title={t('page.spotlight')}>
          <ProfilePokemonSpotlight
            mostUsed={profile.most_used_pokemon}
            bestKillers={profile.best_kill_pokemon}
          />
        </ProfileSection>
        </div>

        {/* Record column */}
        <div className="space-y-6 min-w-0">
        <ProfileSection title={t('page.rating')} defaultCollapsed>
          <div className="space-y-4">
            <div className="flex items-center justify-end">
              {profile.rating ? (
                <RatingBadge rating={profile.rating.rating} rd={profile.rating.rd} size="lg" />
              ) : (
                <span className="text-sm text-poke-text-tertiary">{t('page.unrated')}</span>
              )}
            </div>
            {profile.rating ? (
              <RatingHistoryChart history={ratingHistory} />
            ) : (
              <p className="text-sm text-poke-text-tertiary">
                {t('page.noRatedMatch')}
              </p>
            )}
          </div>
        </ProfileSection>

        <ProfileSection title={t('page.signatures')} defaultCollapsed>
          <SignatureTeam signatures={profile.signatures} />
        </ProfileSection>

        <ProfileSection title={t('page.achievements')} defaultCollapsed>
          <AchievementGrid
            achievements={profile.achievements}
            allDefinitions={achievementDefinitions}
          />
        </ProfileSection>

        <ProfileSection title={t('page.participations')} defaultCollapsed>
          <ProfileParticipations
            current={profile.current_participations}
            past={profile.past_participations}
          />
        </ProfileSection>

        <ProfileSection title={t('page.trophies')} defaultCollapsed>
          <ProfileTrophies trophies={profile.trophies} />
        </ProfileSection>

        {isLoggedIn ? (
          <>
            <ProfileSection title={t('page.recentMatches')}>
              <ProfileMatchList
                title={t('page.recentMatches')}
                matches={profile.recent_matches}
                playerId={profile.player.id}
                emptyMessage={t('page.noRecentMatches')}
              />
            </ProfileSection>

            {profile.upcoming_matches.length > 0 && (
              <ProfileSection title={t('page.upcomingMatches')}>
                <ProfileMatchList
                  title={t('page.upcomingMatches')}
                  matches={profile.upcoming_matches}
                  playerId={profile.player.id}
                  emptyMessage={t('page.noUpcomingMatches')}
                />
              </ProfileSection>
            )}

            {profile.streaks && (
              <ProfileSection title={t('page.streaks')} defaultCollapsed>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div>
                    <StreakIndicator streaks={profile.streaks} />
                    <p className="text-xs text-poke-text-tertiary mt-2">
                      {t('page.streakHint')}
                    </p>
                  </div>
                  <StreakRecords streaks={profile.streaks} />
                </div>
              </ProfileSection>
            )}
          </>
        ) : (
          <Card variant="outlined" padding="md" className="text-center space-y-3">
            <p className="text-sm text-poke-text-secondary">
              {t('page.signInPrompt')}
            </p>
            <Link href="/api/auth/signin">
              <Button variant="primary" size="sm">
                {t('page.signIn')}
              </Button>
            </Link>
          </Card>
        )}
        </div>
      </div>
    </PageContainer>
  );
}
