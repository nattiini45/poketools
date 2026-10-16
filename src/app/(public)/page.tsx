import type { Metadata } from 'next';
import Link from 'next/link';
import { publicReads } from '@/lib/cache/public-reads';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { PANEL, PANEL_HOVER, PANEL_NOTICE } from '@/components/ui/panel';
import DiscordLoginButton from '@/components/shared/DiscordLoginButton';
import AgentChatWidget from '@/components/agent/AgentChatWidget';
import Pokeball from '@/components/shared/Pokeball';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { homeMessages } from '@/i18n/messages/home';

// Dynamic: the page reads the viewer's session. The lists and the featured
// standings come from the tagged public read cache (60 s, expired by match
// writes), so a render costs no Supabase query while the entries are warm.
export const dynamic = 'force-dynamic';

// Self-referencing canonical for the home page (Search Console flagged it as a
// duplicate without a user-declared canonical).
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

const statusVariant: Record<string, 'green' | 'accent' | 'gray'> = {
  active: 'green',
  upcoming: 'accent',
  completed: 'gray',
};

/** Small centered Pokéball that clicks open on hover — the divider egg. */
function PokeballDivider({ title }: { title: string }) {
  return (
    <div className="group flex justify-center py-1" title={title}>
      <Pokeball interactive className="h-8 w-8" />
    </div>
  );
}

function SectionHeading({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-heading font-bold tracking-tight text-poke-text-primary">
          {title}
        </h2>
        <div aria-hidden="true" className="mt-2 h-0.5 w-12 rounded-full bg-poke-accent" />
      </div>
      <Link
        href={href}
        className="text-sm font-heading font-semibold text-poke-text-link hover:text-poke-accent transition-colors"
      >
        {linkLabel}
      </Link>
    </div>
  );
}

export default async function Home() {
  const [tournaments, leagues, sessionPlayer, t, tCommon, tEnums] = await Promise.all([
    publicReads.tournamentList(),
    publicReads.seasonList(),
    getSessionPlayer(),
    getT(homeMessages),
    getT(commonMessages),
    getT(enumMessages),
  ]);
  const isAuthenticated = sessionPlayer != null;

  const activeLeague = leagues.find((l) => l.status === 'active');
  const activeTournament = tournaments.find((t) => t.status === 'active');
  const featured =
    activeLeague != null
      ? { type: 'league' as const, item: activeLeague }
      : activeTournament != null
        ? { type: 'tournament' as const, item: activeTournament }
        : null;

  const recentTournaments = tournaments.slice(0, 3);
  const recentLeagues = leagues.slice(0, 3);

  const featuredStandings =
    featured != null
      ? await publicReads.standingsPreview(featured.type, featured.item.id, 3)
      : [];

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      {/* Hero — static plaza-language panel, Pokéball motif, no scrollworld */}
      <div
        className={`relative overflow-hidden rounded-poke-xl border border-poke-border p-8 sm:p-12 shadow-poke-md bg-[radial-gradient(120%_120%_at_85%_0%,var(--poke-glow),transparent_55%),linear-gradient(135deg,var(--poke-elevated),var(--poke-surface)_55%,var(--poke-muted))]`}
      >
        {/* oversized decorative ball outline, far right */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full border-[10px] border-poke-accent/15"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-4 -top-10 h-44 w-44 rounded-full border-[6px] border-poke-accent/20"
        />
        <div className="relative flex flex-wrap items-center gap-8">
          <div className="max-w-xl flex-1 basis-72">
            <p className="text-xs font-heading font-semibold uppercase tracking-[0.18em] text-poke-accent">
              {t('hero.eyebrow')}
            </p>
            <h1 className="mt-3 text-4xl sm:text-5xl font-heading font-extrabold tracking-tight text-poke-text-primary">
              PokéTools
            </h1>
            <div aria-hidden="true" className="mt-4 h-0.5 w-16 rounded-full bg-poke-accent" />
            <p className="mt-4 text-poke-text-secondary">
              {t('hero.intro')}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <DiscordLoginButton />
              <Link href="/tournaments">
                <Button variant="secondary" size="sm">
                  {t('hero.browseTournaments')}
                </Button>
              </Link>
            </div>
          </div>
          <Pokeball className="hidden sm:block h-28 w-28 rotate-12" />
        </div>
      </div>

      <AgentChatWidget isAuthenticated={isAuthenticated} />

      {featured && (
        <Card
          variant="default"
          padding="lg"
          className="group relative overflow-hidden border-poke-accent/30"
        >
          {/* type-shimmer sweep across the featured spotlight on hover */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 group-hover:animate-type-shimmer bg-[linear-gradient(105deg,transparent_40%,var(--poke-glow)_50%,transparent_60%)]"
          />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-heading uppercase tracking-wide text-poke-text-muted mb-1">
                {featured.type === 'league' ? t('featured.league') : t('featured.tournament')}
              </p>
              <h2 className="text-xl font-heading font-bold tracking-tight text-poke-text-primary">
                {featured.item.name}
              </h2>
              <div className="flex flex-wrap gap-2 mt-2 items-center text-xs text-poke-text-secondary">
                <Badge variant="green" size="sm">
                  {featured.type === 'league'
                    ? enumLabel(tEnums, 'seasonStatus', 'active')
                    : enumLabel(tEnums, 'tournamentStatus', 'active')}
                </Badge>
                <span>{tCommon('units.players', { count: featured.item.participant_count })}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={
                  featured.type === 'league'
                    ? `/leagues/${featured.item.id}`
                    : `/tournaments/${featured.item.id}`
                }
              >
                <Button variant="primary" size="sm">
                  {t('featured.viewLive')}
                </Button>
              </Link>
              <Link
                href={
                  featured.type === 'league'
                    ? `/insights?scope=league&id=${featured.item.id}`
                    : `/insights?scope=tournament&id=${featured.item.id}`
                }
              >
                <Button variant="ghost" size="sm">
                  {t('featured.openInsights')}
                </Button>
              </Link>
            </div>
          </div>
          {featuredStandings.length > 0 && (
            <div className="relative mt-6 border-t border-poke-border pt-4">
              <p className="text-xs font-heading uppercase tracking-wide text-poke-text-muted mb-2">
                {t('featured.standingsTop3')}
              </p>
              <ol className="space-y-1.5">
                {featuredStandings.map((row) => (
                  <li
                    key={row.rank}
                    className="flex items-center justify-between text-sm gap-3"
                  >
                    <span className="text-poke-text-muted font-heading w-6">#{row.rank}</span>
                    <span className="flex-1 font-medium text-poke-text-primary truncate">
                      {row.player_name}
                    </span>
                    <span className="text-poke-text-secondary text-xs shrink-0">
                      {t('featured.record', { wins: row.wins, losses: row.losses })}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Card>
      )}

      {!featured && (
        <p className={PANEL_NOTICE}>
          {t('noActive')}
        </p>
      )}

      <PokeballDivider title={t('dividerTitle')} />

      <div className="grid sm:grid-cols-2 gap-4">
        <Link href="/insights?tab=ratings" className={PANEL_HOVER + ' rounded-poke-lg block h-full ' + PANEL}>
          <div className="p-5">
            <h3 className="font-heading font-bold text-poke-text-primary">{t('cards.insightsTitle')}</h3>
            <p className="text-sm text-poke-text-secondary mt-1">{t('cards.insightsBody')}</p>
          </div>
        </Link>
        <Link href="/wiki" className={PANEL_HOVER + ' rounded-poke-lg block h-full ' + PANEL}>
          <div className="p-5">
            <h3 className="font-heading font-bold text-poke-text-primary">{t('cards.wikiTitle')}</h3>
            <p className="text-sm text-poke-text-secondary mt-1">{t('cards.wikiBody')}</p>
          </div>
        </Link>
      </div>

      <div className="space-y-4">
        <SectionHeading title={t('sections.tournaments')} href="/tournaments" linkLabel={t('sections.viewAll')} />
        {recentTournaments.length === 0 ? (
          <p className="text-poke-text-muted text-sm">{t('sections.noTournaments')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentTournaments.map((tournament) => (
              <Link key={tournament.id} href={`/tournaments/${tournament.id}`} className={PANEL_HOVER + ' rounded-poke-lg block ' + PANEL}>
                <div className="p-5">
                  <h3 className="font-heading font-semibold text-poke-text-primary">{tournament.name}</h3>
                  <div className="flex flex-wrap gap-2 mt-2 items-center text-xs text-poke-text-secondary">
                    <span>{enumLabel(tEnums, 'bracketType', tournament.bracket_type)}</span>
                    <span>{tCommon('units.players', { count: tournament.participant_count })}</span>
                    <Badge variant={statusVariant[tournament.status] ?? 'gray'}>
                      {enumLabel(tEnums, 'tournamentStatus', tournament.status)}
                    </Badge>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <SectionHeading title={t('sections.leagues')} href="/leagues" linkLabel={t('sections.viewAll')} />
        {recentLeagues.length === 0 ? (
          <p className="text-poke-text-muted text-sm">{t('sections.noLeagues')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentLeagues.map((league) => (
              <Link key={league.id} href={`/leagues/${league.id}`} className={PANEL_HOVER + ' rounded-poke-lg block ' + PANEL}>
                <div className="p-5">
                  <h3 className="font-heading font-semibold text-poke-text-primary">
                    {league.name}
                  </h3>
                  <div className="flex flex-wrap gap-2 mt-2 items-center text-xs text-poke-text-secondary">
                    <span>{enumLabel(tEnums, 'formatType', league.format_type)}</span>
                    <span>{tCommon('units.players', { count: league.participant_count })}</span>
                    <Badge variant={statusVariant[league.status] ?? 'gray'}>
                      {enumLabel(tEnums, 'seasonStatus', league.status)}
                    </Badge>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
