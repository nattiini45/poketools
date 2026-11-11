import Link from 'next/link';
import { HeroFighter as Fighter, HeroStat as Stat } from '@/components/competition/HeroBits';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import SkewPlate from '@/components/ui/SkewPlate';
import { LocalTime } from '@/i18n/LocalTime';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { leaguesMessages } from '@/i18n/messages/leagues';
import type { HeroSide, LeagueHeroView } from '@/lib/league-hub/hero';
import { cn } from '@/lib/utils/cn';
import type { SeasonWithDetails } from '@/types/season';

const STATUS_TONE: Record<SeasonWithDetails['status'], SkewChipTone> = { active: 'live', upcoming: 'accent', completed: 'neutral' };

/** The worlds with a lore line (D9: world lore lives in the league hero and nowhere else on the site chrome). */
const LORE_WORLDS = ['evoliga', 'sakura', 'mountain', 'clouds'] as const;
type LoreWorld = (typeof LORE_WORLDS)[number];

interface LeagueHeroProps {
  league: Pick<SeasonWithDetails, 'id' | 'name' | 'status' | 'format_type' | 'participant_count'>;
  /** The resolved world's id; a world without a lore line shows the format alone. */
  worldId: string;
  view: LeagueHeroView;
  locale: Locale;
}

/**
 * The league hero (plan §4.2, B2; Direction B's versus screen): the league's name, status and matchday on the
 * arena sand, and the match that matters to this viewer on the dark slab: their own next match with its
 * actions, else the live match, else the next kickoff, else the top of the table. It is the page's `h1` and the
 * only place that carries world lore (D9). Server component; it renders from the world payload alone.
 */
export default function LeagueHero({ league, worldId, view, locale }: LeagueHeroProps) {
  const t = createTranslator(leaguesMessages, locale);
  const enums = createTranslator(enumMessages, locale);
  const { match, leader } = view;
  const status = enumLabel(enums, 'seasonStatus', league.status);
  const lore = LORE_WORLDS.find((id): id is LoreWorld => id === worldId);
  const standing = (side: HeroSide) =>
    side.rank !== null && side.points !== null ? t('hero.standing', { rank: side.rank, points: side.points }) : null;
  const matchHref = match ? `/tournaments/${match.tournamentId}/matches/${match.matchId}` : null;

  return (
    <section
      aria-labelledby="league-hero-heading"
      data-league-hero={match?.kind ?? (leader ? 'leader' : 'plain')}
      className={cn('league-hero overflow-hidden rounded-poke-lg border border-hairline', (match || leader) && 'league-hero-split')}
    >
      <div className="relative min-w-0 px-5 py-6 sm:px-8 sm:py-9">
        <SkewChip tone={STATUS_TONE[league.status]} className="text-body">
          <span className="inline-flex items-center gap-2">
            {league.status === 'active' && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-live" />}
            {view.matchday !== null ? t('hero.statusMatchday', { status, matchday: view.matchday }) : status}
          </span>
        </SkewChip>
        <h1 id="league-hero-heading" className="mt-4 font-heading text-display text-fg [overflow-wrap:anywhere] lg:text-[40px] lg:leading-[46px]">
          {league.name}
        </h1>
        <p className="mt-2 max-w-[62ch] text-body text-fg-muted">
          {enumLabel(enums, 'formatType', league.format_type)}
          {lore && <> · {t(`hero.lore.${lore}`)}</>}
        </p>
        <ul className="mt-6 flex flex-wrap gap-x-4 gap-y-3">
          <Stat value={String(league.participant_count)} label={t('hero.stats.trainers', { count: league.participant_count })} />
          <Stat value={String(view.matchesPlayed)} label={t('hero.stats.matchesPlayed', { count: view.matchesPlayed })} />
          {view.daysLeft !== null && <Stat value={String(view.daysLeft)} label={t('hero.stats.daysLeft', { count: view.daysLeft })} />}
          {view.startsInDays !== null && <Stat value={String(view.startsInDays)} label={t('hero.stats.daysToStart', { count: view.startsInDays })} />}
        </ul>
      </div>

      {match && matchHref && (
        <div className="league-hero-slab relative min-w-0 px-5 py-6 sm:px-8">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body">
            <ItemIcon item="vs-seeker" />
            <span className="font-[550]">{t(`hero.match.${match.kind}`)}</span>
            {match.scheduledAt && (
              <span className="league-hero-slab-muted">
                · <LocalTime value={match.scheduledAt} preset="weekdayDateTime" />
              </span>
            )}
          </p>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-x-3 sm:gap-x-5">
            <Fighter side={match.home} standing={standing(match.home)} tier="bg-tier-1" align="left" />
            <span aria-hidden="true" className="league-hero-vs self-center pb-10 font-heading text-display sm:text-[44px] sm:leading-[48px]">
              {t('hero.vs')}
            </span>
            <Fighter side={match.away} standing={standing(match.away)} tier="bg-tier-3" align="right" />
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-3">
            {match.canSubmit && (
              <Link href={`/dashboard/submit/${match.matchId}`} className="inline-flex rounded-[3px] text-body">
                <SkewPlate variant="button" tone="primary">
                  {t('hero.actions.submit')}
                </SkewPlate>
              </Link>
            )}
            {match.kind === 'yours' && (
              <Link href={`/dashboard/match-prep/${match.matchId}`} className="inline-flex rounded-[3px] text-body">
                <SkewPlate variant="button" tone="secondary">
                  {t('hero.actions.prep')}
                </SkewPlate>
              </Link>
            )}
            <Link href={matchHref} className="inline-flex rounded-[3px] text-body">
              <SkewPlate variant="button" tone="secondary">
                {t('hero.actions.open')}
              </SkewPlate>
            </Link>
          </div>
        </div>
      )}

      {!match && leader && (
        <div className="league-hero-slab relative min-w-0 px-5 py-6 sm:px-8">
          <p className="flex items-center gap-2 text-body">
            <ItemIcon item="kings-rock" />
            <span className="font-[550]">{t(league.status === 'completed' ? 'hero.leader.champion' : 'hero.leader.leading')}</span>
          </p>
          <div className="mx-auto mt-2 max-w-72">
            <Fighter side={leader} standing={standing(leader)} tier="bg-tier-1" align="left" />
          </div>
        </div>
      )}
    </section>
  );
}
