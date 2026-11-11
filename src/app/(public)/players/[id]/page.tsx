import type { Metadata } from 'next';
import { Pencil } from 'lucide-react';
import { notFound } from 'next/navigation';
import PageContainer from '@/components/ui/PageContainer';
import ProfileSection from '@/components/profile/ProfileSection';
import ProfileHeader from '@/components/profile/ProfileHeader';
import ProfilePokemonSpotlight from '@/components/profile/ProfilePokemonSpotlight';
import ProfileParticipations from '@/components/profile/ProfileParticipations';
import ProfileMatchList from '@/components/profile/ProfileMatchList';
import ProfileTrophies from '@/components/profile/ProfileTrophies';
import ProfileEmpty from '@/components/profile/ProfileEmpty';
import PlateLink from '@/components/profile/PlateLink';
import RatingHistoryChart from '@/components/gamification/RatingHistoryChart';
import StreakRecords from '@/components/gamification/StreakRecords';
import AchievementGrid from '@/components/gamification/AchievementGrid';
import SupplementaryRecordSection from '@/components/supplementary/SupplementaryRecordSection';
import ItemIcon from '@/components/ui/ItemIcon';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { currentSignInPath } from '@/lib/auth/redirect-to-sign-in';
import { publicReads } from '@/lib/cache/public-reads';
import { playerMetadata } from '@/lib/seo/page-metadata';
import { readPlayerProfile } from '@/lib/seo/page-reads';
import { packExtensions } from '@/lib/pack-extensions';
import { getT } from '@/i18n/server';
import { profileMessages } from '@/i18n/messages/profile';
import type { AchievementProgressSource } from '@/components/gamification/achievement-progress';

// Dynamic: the page reads the viewer's session (it gates the match sections).
// The profile, rating history and achievement catalogue come from the tagged
// public read cache (30 s / 60 s); the cached profile's player is already the
// `PublicPlayer` card (an allowlist: no moderation, role or identity columns),
// and the entry is the same for every viewer.
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return playerMetadata((await params).id);
}

export default async function PlayerProfilePage({ params }: PageProps) {
  const { id } = await params;
  const viewer = await getSessionPlayer();

  const [profile, ratingHistory, achievementDefinitions, t] = await Promise.all([
    readPlayerProfile(id),
    publicReads.playerRatingHistory(id, 60),
    publicReads.achievementDefinitions(),
    getT(profileMessages),
  ]);

  if (!profile) {
    notFound();
  }

  const publicPlayer = profile.player;
  const isLoggedIn = viewer != null;
  // Display only: which buttons and empty-state hints to show. Nothing is authorized from the session copy.
  const isOwnProfile = viewer?.playerId === profile.player.id;
  // Pack extensions (docs/format-packs.md): rendered after the cached reads, per request; absent
  // in the example pack, so they add nothing there.
  const ExtensionProfileSection = packExtensions.ProfileSection;

  // What the page already shows, counted towards locked achievements. Streaks stay with the signed-in sections.
  const achievementProgress: AchievementProgressSource = {
    totalWins: profile.rating?.wins,
    totalGames: profile.rating ? profile.rating.wins + profile.rating.losses + profile.rating.draws : undefined,
    totalKos: profile.headline.total_kos_dealt,
    totalTournaments: profile.headline.tournaments_entered,
    uniquePokemon: profile.headline.unique_pokemon_used,
    rating: profile.rating?.rating,
    peakRating: profile.rating?.peak_rating,
    ...(isLoggedIn && profile.streaks
      ? {
          winStreak: profile.streaks.current_win_streak,
          koStreak: profile.streaks.current_ko_streak,
          flawlessStreak: profile.streaks.current_flawless_streak,
        }
      : {}),
  };
  const hasParticipations = profile.current_participations.length > 0 || profile.past_participations.length > 0;
  const hasSpotlight = profile.most_used_pokemon.length > 0 || profile.best_kill_pokemon.length > 0;

  return (
    <PageContainer maxWidth="xl">
      <div className="flex flex-col gap-6">
        <ProfileHeader
          player={publicPlayer}
          headline={profile.headline}
          recentForm={profile.recent_form}
          rating={profile.rating ? { rating: profile.rating.rating, rd: profile.rating.rd } : null}
          streaks={isLoggedIn ? profile.streaks : null}
          signatures={profile.signatures}
          action={
            isOwnProfile ? (
              <PlateLink href="/dashboard/settings">
                <Pencil aria-hidden="true" className="h-4 w-4" />
                {t('page.editProfile')}
              </PlateLink>
            ) : undefined
          }
        />

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
          {/* Record rail */}
          <div className="flex min-w-0 flex-col gap-6">
            <ProfileSection title={t('page.rating')} icon="great-ball">
              {profile.rating ? (
                <RatingHistoryChart history={ratingHistory} />
              ) : (
                <ProfileEmpty>{isOwnProfile ? t('page.noRatedMatchOwn') : t('page.noRatedMatch')}</ProfileEmpty>
              )}
            </ProfileSection>

            <ProfileSection title={t('page.trophies')} icon="kings-rock">
              {profile.trophies.length > 0 ? (
                <ProfileTrophies trophies={profile.trophies} />
              ) : (
                <ProfileEmpty action={isOwnProfile ? <PlateLink href="/tournaments">{t('page.browseTournaments')}</PlateLink> : undefined}>
                  {t('page.trophiesEmpty')}
                </ProfileEmpty>
              )}
            </ProfileSection>

            <ProfileSection title={t('page.spotlight')} icon="scope-lens">
              {hasSpotlight ? (
                <ProfilePokemonSpotlight mostUsed={profile.most_used_pokemon} bestKillers={profile.best_kill_pokemon} />
              ) : (
                <ProfileEmpty>{t('page.spotlightEmpty')}</ProfileEmpty>
              )}
            </ProfileSection>

            {isLoggedIn && profile.streaks && (
              <ProfileSection title={t('page.streaks')} icon="rare-candy">
                <div className="flex flex-col gap-4">
                  <StreakRecords streaks={profile.streaks} />
                  <p className="text-caption text-fg-muted">{t('page.streakHint')}</p>
                </div>
              </ProfileSection>
            )}
          </div>

          {/* Career column */}
          <div className="flex min-w-0 flex-col gap-6">
            <ProfileSection title={t('page.achievements')} icon="gold-bottle-cap">
              <AchievementGrid
                achievements={profile.achievements}
                allDefinitions={achievementDefinitions}
                progress={achievementProgress}
              />
            </ProfileSection>

            {isLoggedIn ? (
              <>
                <ProfileSection title={t('page.recentMatches')} icon="vs-seeker">
                  <ProfileMatchList
                    title={t('page.recentMatches')}
                    matches={profile.recent_matches}
                    playerId={profile.player.id}
                    player={publicPlayer}
                    emptyMessage={isOwnProfile ? t('page.noRecentMatchesOwn') : t('page.noRecentMatches')}
                  />
                </ProfileSection>

                {profile.upcoming_matches.length > 0 && (
                  <ProfileSection title={t('page.upcomingMatches')} icon="metronome">
                    <ProfileMatchList
                      title={t('page.upcomingMatches')}
                      matches={profile.upcoming_matches}
                      playerId={profile.player.id}
                      player={publicPlayer}
                      emptyMessage={t('page.noUpcomingMatches')}
                    />
                  </ProfileSection>
                )}
              </>
            ) : (
              <section className="flex flex-col items-start gap-4 rounded-poke-lg border border-hairline bg-surface p-5 sm:flex-row sm:items-center">
                <ItemIcon item="vs-seeker" size={48} />
                <p className="min-w-0 flex-1 text-body text-fg-muted">{t('page.signInPrompt')}</p>
                <PlateLink href={await currentSignInPath()} tone="primary">
                  {t('page.signIn')}
                </PlateLink>
              </section>
            )}

            <ProfileSection title={t('page.participations')} icon="poke-ball">
              {hasParticipations ? (
                <ProfileParticipations current={profile.current_participations} past={profile.past_participations} />
              ) : (
                <ProfileEmpty action={isOwnProfile ? <PlateLink href="/leagues">{t('page.browseLeagues')}</PlateLink> : undefined}>
                  {t('page.participationsEmpty')}
                </ProfileEmpty>
              )}
            </ProfileSection>

            <SupplementaryRecordSection playerId={profile.player.id} />
            {ExtensionProfileSection && <ExtensionProfileSection playerId={profile.player.id} />}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
