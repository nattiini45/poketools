import Link from 'next/link';
import { HeroFighter, HeroStat, type HeroSide } from '@/components/competition/HeroBits';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import SkewPlate from '@/components/ui/SkewPlate';
import { LocalTime } from '@/i18n/LocalTime';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { leaguesMessages } from '@/i18n/messages/leagues';
import { tournamentsMessages } from '@/i18n/messages/tournaments';
import type { TournamentHeroView } from '@/lib/tournament/page-view';
import { cn } from '@/lib/utils/cn';
import type { TournamentWithDetails } from '@/types/tournament';

const STATUS_TONE: Record<TournamentWithDetails['status'], SkewChipTone> = { active: 'live', upcoming: 'accent', completed: 'neutral' };

interface TournamentHeroProps {
  tournament: Pick<
    TournamentWithDetails,
    'id' | 'name' | 'description' | 'status' | 'current_round' | 'bracket_type' | 'best_of_default' | 'is_doubles' | 'ruleset_name' | 'participant_count'
  >;
  /** The league this tournament is a phase of; null for a standalone tournament. */
  league: { id: string; name: string } | null;
  roundCount: number;
  view: TournamentHeroView;
  locale: Locale;
}

/**
 * The tournament hero (plan §4.2, B3): the league hero's skeleton for one tournament or league phase. The name,
 * status and round on the arena sand; on the versus slab the match in progress, else the next kickoff, else the
 * top of the table. It is the page's `h1`. Server component; it renders from what the page already read.
 */
export default function TournamentHero({ tournament, league, roundCount, view, locale }: TournamentHeroProps) {
  const t = createTranslator(tournamentsMessages, locale);
  const tl = createTranslator(leaguesMessages, locale);
  const tc = createTranslator(commonMessages, locale);
  const enums = createTranslator(enumMessages, locale);
  const { match, leader } = view;
  const status = enumLabel(enums, 'tournamentStatus', tournament.status);
  const standing = (side: HeroSide) =>
    side.rank !== null && side.points !== null ? tl('hero.standing', { rank: side.rank, points: side.points }) : null;

  return (
    <section
      aria-labelledby="tournament-hero-heading"
      data-tournament-hero={match?.kind ?? (leader ? 'leader' : 'plain')}
      className={cn('league-hero overflow-hidden rounded-poke-lg border border-hairline', (match || leader) && 'league-hero-split')}
    >
      <div className="relative min-w-0 px-5 py-6 sm:px-8 sm:py-9">
        {league && (
          <Link
            href={`/leagues/${league.id}#schedule`}
            aria-label={t('detail.backToLeagueLabel', { name: league.name })}
            className="mb-4 inline-flex min-h-6 items-center gap-1 rounded-[3px] text-body font-[550] text-fg-muted hover:text-fg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus"
          >
            <span aria-hidden="true">←</span> {t('detail.backToLeague', { name: league.name })}
          </Link>
        )}
        <div>
          <SkewChip tone={STATUS_TONE[tournament.status]} className="text-body">
            <span className="inline-flex items-center gap-2">
              {tournament.status === 'active' && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-live" />}
              {tournament.status === 'active' && tournament.current_round > 0
                ? t('hero.statusRound', { status, round: tournament.current_round })
                : status}
            </span>
          </SkewChip>
        </div>
        <h1 id="tournament-hero-heading" className="mt-4 font-heading text-display text-fg [overflow-wrap:anywhere] lg:text-[40px] lg:leading-[46px]">
          {league ? `${league.name} — ${tournament.name}` : tournament.name}
        </h1>
        <p className="mt-2 max-w-[62ch] text-body text-fg-muted">
          {enumLabel(enums, 'bracketType', tournament.bracket_type)} · {tc('bestOf', { count: tournament.best_of_default })}
          {tournament.is_doubles && <> · {t('list.doubles')}</>} · {tournament.ruleset_name}
        </p>
        {tournament.description && <p className="mt-2 max-w-[62ch] whitespace-pre-wrap text-body text-fg-muted">{tournament.description}</p>}
        <ul className="mt-6 flex flex-wrap gap-x-4 gap-y-3">
          <HeroStat value={String(tournament.participant_count)} label={t('hero.stats.players', { count: tournament.participant_count })} />
          <HeroStat value={String(roundCount)} label={t('hero.stats.rounds', { count: roundCount })} />
          <HeroStat value={String(view.matchesPlayed)} label={tl('hero.stats.matchesPlayed', { count: view.matchesPlayed })} />
        </ul>
      </div>

      {match && (
        <div className="league-hero-slab relative min-w-0 px-5 py-6 sm:px-8">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body">
            <ItemIcon item="vs-seeker" />
            <span className="font-[550]">{tl(`hero.match.${match.kind}`)}</span>
            {match.scheduledAt && (
              <span className="league-hero-slab-muted">
                · <LocalTime value={match.scheduledAt} preset="weekdayDateTime" />
              </span>
            )}
          </p>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-x-3 sm:gap-x-5">
            <HeroFighter side={match.home} standing={standing(match.home)} tier="bg-tier-1" align="left" />
            <span aria-hidden="true" className="league-hero-vs self-center pb-10 font-heading text-display sm:text-[44px] sm:leading-[48px]">
              {tl('hero.vs')}
            </span>
            <HeroFighter side={match.away} standing={standing(match.away)} tier="bg-tier-3" align="right" />
          </div>
          <div className="mt-4 flex justify-center">
            <Link href={`/tournaments/${tournament.id}/matches/${match.matchId}`} className="inline-flex rounded-[3px] text-body">
              <SkewPlate variant="button" tone="secondary">
                {tl('hero.actions.open')}
              </SkewPlate>
            </Link>
          </div>
        </div>
      )}

      {!match && leader && (
        <div className="league-hero-slab relative min-w-0 px-5 py-6 sm:px-8">
          <p className="flex items-center gap-2 text-body">
            <ItemIcon item="kings-rock" />
            <span className="font-[550]">{tl(tournament.status === 'completed' ? 'hero.leader.champion' : 'hero.leader.leading')}</span>
          </p>
          <div className="mx-auto mt-2 max-w-72">
            <HeroFighter side={leader} standing={standing(leader)} tier="bg-tier-1" align="left" />
          </div>
        </div>
      )}
    </section>
  );
}
