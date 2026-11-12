import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { publicReads } from '@/lib/cache/public-reads';
import TestLeagueBadge from '@/components/league/TestLeagueBadge';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import SkewPlate from '@/components/ui/SkewPlate';
import AgentChatWidget from '@/components/agent/AgentChatWidget';
import Pokeball from '@/components/shared/Pokeball';
import { getSessionPlayer } from '@/lib/auth/helpers';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import { cn } from '@/lib/utils/cn';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { homeMessages } from '@/i18n/messages/home';
import { leaguesMessages } from '@/i18n/messages/leagues';
import { shellMessages } from '@/i18n/messages/shell';

// Dynamic: the page reads the viewer's session. The lists and the featured
// standings come from the tagged public read cache (60 s, expired by match
// writes), so a render costs no Supabase query while the entries are warm.
export const dynamic = 'force-dynamic';

// Self-referencing canonical for the home page (Search Console flagged it as a
// duplicate without a user-declared canonical).
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

const STATUS_TONE: Record<string, SkewChipTone> = { active: 'live', upcoming: 'accent', completed: 'neutral' };
const STATUS_EDGE: Record<string, string> = { active: 'bg-live', upcoming: 'bg-accent-fill', completed: 'bg-hairline-strong' };

const FOCUS = 'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus';
/** A link that holds a button plate: 44 px target, 80 ms lift. */
const PLATE_LINK =
  'inline-flex min-h-11 items-center rounded-[3px] text-body transition-transform duration-[80ms] ease-out hover:-translate-y-0.5 active:translate-y-0 motion-reduce:transform-none';
const TILE = cn(
  'group relative flex h-full overflow-hidden rounded-poke-lg border border-hairline bg-surface transition-colors duration-[80ms] hover:border-hairline-strong hover:bg-elevated',
  FOCUS,
);

/** Small centered Pokéball that clicks open on hover — the divider egg. */
function PokeballDivider({ title }: { title: string }) {
  return (
    <div className="group flex justify-center py-1" title={title}>
      <Pokeball interactive className="h-8 w-8" />
    </div>
  );
}

function SectionHeading({ title, icon, href, linkLabel }: { title: string; icon: ItemIconId; href: string; linkLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <ItemIcon item={icon} size={24} />
        <h2 className="min-w-0 font-heading text-title text-fg">{title}</h2>
      </div>
      <Link
        href={href}
        className={cn('group inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[3px] text-body font-[550] text-accent-ink hover:text-fg', FOCUS)}
      >
        {linkLabel}
        <ArrowRight
          aria-hidden="true"
          className="h-4 w-4 transition-transform duration-[80ms] ease-out group-hover:translate-x-1 motion-reduce:transform-none"
        />
      </Link>
    </div>
  );
}

/** One number of the hero's scoreboard. */
function Score({ value, label }: { value: number; label: string }) {
  return (
    <li className="flex min-w-0 flex-col items-center gap-1 text-center">
      <span className="league-hero-vs font-heading text-display tabular-nums sm:text-[40px] sm:leading-[44px]">{value}</span>
      <span className="league-hero-slab-muted text-caption">{label}</span>
    </li>
  );
}

function Teaser({
  href,
  name,
  status,
  statusLabel,
  meta,
  badge,
}: {
  href: string;
  name: string;
  status: string;
  statusLabel: string;
  meta: readonly string[];
  badge?: React.ReactNode;
}) {
  return (
    <li>
      <Link href={href} className={cn(TILE, 'flex-col gap-2 py-4 pl-5 pr-4')}>
        <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', STATUS_EDGE[status] ?? 'bg-hairline-strong')} />
        <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <h3 className="min-w-0 font-heading text-title text-fg [overflow-wrap:anywhere]">{name}</h3>
          <SkewChip tone={STATUS_TONE[status] ?? 'neutral'}>{statusLabel}</SkewChip>
        </span>
        <span className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
          <span>{meta.join(' · ')}</span>
          {badge}
        </span>
      </Link>
    </li>
  );
}

function EmptyTeaser({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-4 rounded-poke-lg border border-hairline bg-surface px-5 py-4">
      <ItemIcon item="poke-doll" size={48} />
      <p className="text-body text-fg-muted">{text}</p>
    </div>
  );
}

export default async function Home() {
  const [tournaments, leagues, sessionPlayer, t, tCommon, tEnums, tLeagues, tShell] = await Promise.all([
    publicReads.tournamentList(),
    publicReads.seasonList(),
    getSessionPlayer(),
    getT(homeMessages),
    getT(commonMessages),
    getT(enumMessages),
    getT(leaguesMessages),
    getT(shellMessages),
  ]);
  const isAuthenticated = sessionPlayer != null;

  // The spotlight features a real league only; test leagues still show in
  // the teaser below (sorted after the real ones, badged).
  const activeLeague = leagues.find((l) => l.status === 'active' && !l.is_test_season);
  const activeTournament = tournaments.find((t) => t.status === 'active');
  const featured =
    activeLeague != null
      ? { type: 'league' as const, item: activeLeague }
      : activeTournament != null
        ? { type: 'tournament' as const, item: activeTournament }
        : null;

  const recentTournaments = tournaments.slice(0, 3);
  const recentLeagues = leagues.slice(0, 3);
  const liveCount =
    leagues.filter((l) => l.status === 'active').length + tournaments.filter((t) => t.status === 'active').length;

  const featuredStandings =
    featured != null
      ? await publicReads.standingsPreview(featured.type, featured.item.id, 3)
      : [];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* Hero: the title screen. The wordmark and the calls to action on the arena sand, the Pokéball and the
          site's scoreboard on the slab (the league hero's versus-screen classes, so both read as one hand). */}
      <section aria-labelledby="home-hero-heading" className="league-hero league-hero-split overflow-hidden rounded-poke-lg border border-hairline">
        <div className="relative min-w-0 px-5 py-8 sm:px-10 sm:py-14">
          <h1 id="home-hero-heading" className="font-heading text-[clamp(2.75rem,9vw,4.5rem)] leading-none text-fg">
            {/* i18n-ignore: brand wordmark (PokéTools), the same in every language */}
            PokéTools
          </h1>
          <p className="mt-5 max-w-[46ch] text-subtitle text-fg-muted">{t('hero.intro')}</p>
          <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-3">
            {isAuthenticated ? (
              <Link href="/dashboard" className={PLATE_LINK}>
                <SkewPlate variant="button" className="px-5 py-2.5">
                  {t('hero.dashboard')}
                </SkewPlate>
              </Link>
            ) : (
              <Link href="/auth/signin" className={PLATE_LINK}>
                <SkewPlate variant="button" className="px-5 py-2.5">
                  {tShell('session.signIn')}
                </SkewPlate>
              </Link>
            )}
            <Link href="/tournaments" className={PLATE_LINK}>
              <SkewPlate variant="button" tone="secondary" className="px-5 py-2.5">
                {t('hero.browseTournaments')}
              </SkewPlate>
            </Link>
          </div>
        </div>
        <div className="league-hero-slab group relative flex min-w-0 flex-row items-center justify-center gap-6 px-5 py-6 sm:gap-10 sm:px-8 lg:flex-col lg:gap-8 lg:py-10">
          <Pokeball interactive className="h-20 w-20 shrink-0 rotate-12 sm:h-28 sm:w-28 lg:h-36 lg:w-36" />
          <ul className="grid min-w-0 grid-cols-3 gap-x-5 sm:gap-x-8">
            <Score value={leagues.length} label={t('hero.stats.leagues', { count: leagues.length })} />
            <Score value={tournaments.length} label={t('hero.stats.tournaments', { count: tournaments.length })} />
            <Score value={liveCount} label={t('hero.stats.live', { count: liveCount })} />
          </ul>
        </div>
      </section>

      <AgentChatWidget isAuthenticated={isAuthenticated} />

      {featured && (
        <section
          aria-labelledby="home-featured-heading"
          className="relative overflow-hidden rounded-poke-lg border border-hairline bg-surface lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]"
        >
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-live" />
          <div className="min-w-0 py-6 pl-6 pr-5 sm:pl-8 sm:pr-6">
            <p className="text-caption text-fg-muted">
              {featured.type === 'league' ? t('featured.league') : t('featured.tournament')}
            </p>
            <div className="mt-2 flex items-center gap-4">
              <ItemIcon item={featured.type === 'league' ? 'poke-ball' : 'kings-rock'} size={48} className="hidden sm:block" />
              <h2 id="home-featured-heading" className="min-w-0 font-heading text-display text-fg [overflow-wrap:anywhere]">
                {featured.item.name}
              </h2>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SkewChip tone="live">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-live" />
                  {featured.type === 'league'
                    ? enumLabel(tEnums, 'seasonStatus', 'active')
                    : enumLabel(tEnums, 'tournamentStatus', 'active')}
                </span>
              </SkewChip>
              <SkewChip>{tCommon('units.players', { count: featured.item.participant_count })}</SkewChip>
            </div>
            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-3">
              <Link
                href={featured.type === 'league' ? `/leagues/${featured.item.id}` : `/tournaments/${featured.item.id}`}
                className={PLATE_LINK}
              >
                <SkewPlate variant="button" className="px-5 py-2.5">
                  {t('featured.viewLive')}
                </SkewPlate>
              </Link>
              <Link
                href={
                  featured.type === 'league'
                    ? `/insights?scope=league&id=${featured.item.id}`
                    : `/insights?scope=tournament&id=${featured.item.id}`
                }
                className={PLATE_LINK}
              >
                <SkewPlate variant="button" tone="secondary" className="px-5 py-2.5">
                  {t('featured.openInsights')}
                </SkewPlate>
              </Link>
            </div>
          </div>
          {featuredStandings.length > 0 && (
            <div className="min-w-0 border-t border-hairline bg-elevated py-5 pl-6 pr-5 lg:border-l lg:border-t-0 lg:pl-5">
              <p className="flex items-center gap-2 text-body font-[550] text-fg">
                <ItemIcon item="star-piece" size={24} />
                {t('featured.standingsTop3')}
              </p>
              <ol className="mt-3 flex flex-col">
                {featuredStandings.map((row) => (
                  <li key={row.rank} className="flex items-center gap-3 border-t border-hairline py-2 first:border-t-0">
                    <SkewPlate variant="rank" tier={Math.min(Math.max(row.rank, 1), 4) as 1 | 2 | 3 | 4} className="min-w-8 font-heading text-body tabular-nums">
                      {row.rank}
                    </SkewPlate>
                    <span className="min-w-0 flex-1 truncate text-body font-[550] text-fg">{row.player_name}</span>
                    <span className="shrink-0 font-mono text-caption tabular-nums text-fg-muted">
                      {t('featured.record', { wins: row.wins, losses: row.losses })}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {!featured && (
        <div className="flex flex-col items-center gap-4 rounded-poke-lg border border-hairline bg-surface px-6 py-10 text-center">
          <ItemIcon item="poke-doll" size={72} />
          <p className="max-w-[52ch] text-body text-fg-muted">{t('noActive')}</p>
        </div>
      )}

      <PokeballDivider title={t('dividerTitle')} />

      <ul className="grid gap-4 sm:grid-cols-2">
        {(
          [
            { href: '/insights?tab=ratings', icon: 'scope-lens', title: t('cards.insightsTitle'), body: t('cards.insightsBody') },
            { href: '/wiki', icon: 'weakness-policy', title: t('cards.wikiTitle'), body: t('cards.wikiBody') },
          ] as const
        ).map((card) => (
          <li key={card.href}>
            <Link href={card.href} className={cn(TILE, 'items-start gap-4 p-5')}>
              <ItemIcon item={card.icon} size={48} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-heading text-title text-fg">
                  {card.title}
                  <ArrowRight
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-accent-ink transition-transform duration-[80ms] ease-out group-hover:translate-x-1 motion-reduce:transform-none"
                  />
                </span>
                <span className="mt-1 block text-body text-fg-muted">{card.body}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="flex flex-col gap-3">
        <SectionHeading title={t('sections.tournaments')} icon="kings-rock" href="/tournaments" linkLabel={t('sections.viewAll')} />
        {recentTournaments.length === 0 ? (
          <EmptyTeaser text={t('sections.noTournaments')} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentTournaments.map((tournament) => (
              <Teaser
                key={tournament.id}
                href={`/tournaments/${tournament.id}`}
                name={tournament.name}
                status={tournament.status}
                statusLabel={enumLabel(tEnums, 'tournamentStatus', tournament.status)}
                meta={[
                  enumLabel(tEnums, 'bracketType', tournament.bracket_type),
                  tCommon('units.players', { count: tournament.participant_count }),
                ]}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading title={t('sections.leagues')} icon="poke-ball" href="/leagues" linkLabel={t('sections.viewAll')} />
        {recentLeagues.length === 0 ? (
          <EmptyTeaser text={t('sections.noLeagues')} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentLeagues.map((league) => (
              <Teaser
                key={league.id}
                href={`/leagues/${league.id}`}
                name={league.name}
                status={league.status}
                statusLabel={enumLabel(tEnums, 'seasonStatus', league.status)}
                meta={[
                  enumLabel(tEnums, 'formatType', league.format_type),
                  tCommon('units.players', { count: league.participant_count }),
                ]}
                badge={league.is_test_season ? <TestLeagueBadge label={tLeagues('list.testBadge')} /> : undefined}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
