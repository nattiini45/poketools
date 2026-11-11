import type { Metadata } from 'next';
import Link from 'next/link';
import PageContainer from '@/components/ui/PageContainer';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewPlate from '@/components/ui/SkewPlate';
import GuestBadge from '@/components/shared/GuestBadge';
import { GlideGrid, GlideGridItem } from '@/components/discover/GlideGrid';
import { getPublicPlayers } from '@/lib/supabase/queries/players';
import { publicReads } from '@/lib/cache/public-reads';
import { getT } from '@/i18n/server';
import { discoverMessages } from '@/i18n/messages/discover';

// Reads no session. Rendered per request because it reads `searchParams`;
// unsearched pages come from the tagged public read cache (60 s).

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(discoverMessages);
  return { title: t('players.title') };
}

export default async function PlayersDirectoryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const t = await getT(discoverMessages);
  const search = params.q?.trim();
  const page = Math.max(parseInt(params.page ?? '1', 10) || 1, 1);
  const limit = 48;
  const offset = (page - 1) * limit;

  // A search is read live: its key space is whatever a visitor types.
  const { data: players, total } = search
    ? await getPublicPlayers({ limit, offset, search })
    : await publicReads.playerDirectory(limit, offset);

  const totalPages = Math.max(Math.ceil(total / limit), 1);

  return (
    <PageContainer title={t('players.title')} subtitle={t('players.subtitle')} maxWidth="xl" icon="lucky-egg">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
        <form className="flex w-full max-w-md items-start gap-2" method="get" role="search">
          <div className="min-w-0 flex-1">
            <Input
              type="search"
              name="q"
              defaultValue={search}
              placeholder={t('players.searchPlaceholder')}
              aria-label={t('players.search')}
              maxLength={64}
            />
          </div>
          <Button type="submit" variant="secondary">
            {t('players.search')}
          </Button>
        </form>
        <p className="flex h-9 items-baseline gap-2 text-body leading-9 text-fg-muted">
          <span className="font-heading text-title tabular-nums text-fg">{total}</span>
          {t('players.count', { count: total })}
        </p>
      </div>

      {players.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-poke-lg border border-hairline bg-surface px-6 py-12 text-center">
          <ItemIcon item="poke-doll" size={72} />
          <h2 className="font-heading text-title text-fg">{t('players.empty')}</h2>
          <p className="max-w-md text-body text-fg-muted">{t('players.emptyHint')}</p>
          <Link href="/players" className="mt-2 inline-flex min-h-11 items-center">
            <SkewPlate variant="button">{t('players.showAll')}</SkewPlate>
          </Link>
        </div>
      ) : (
        <GlideGrid className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {players.map((player, index) => (
            <GlideGridItem key={player.id} index={index}>
              <Link
                href={`/players/${player.id}`}
                className="group flex h-full flex-col rounded-poke-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
              >
                <div className="relative flex justify-center rounded-t-[inherit] bg-sunken px-3 pb-7 pt-5">
                  <PlayerAvatar avatarUrl={player.avatar_url} name={player.name} size={72} />
                  {(player.is_creator || player.is_guest) && (
                    <span className="absolute left-2 top-2 flex flex-col items-start gap-1">
                      {player.is_creator && (
                        <Badge variant="purple" size="sm">
                          {t('players.creator')}
                        </Badge>
                      )}
                      {player.is_guest && <GuestBadge />}
                    </span>
                  )}
                </div>
                <span className="-mt-4 flex justify-center px-3">
                  <span className="skew-plate max-w-full px-3 py-1.5 text-body font-[550] text-fg transition-colors duration-80 group-hover:text-tier-ink group-focus-visible:text-tier-ink">
                    <span
                      aria-hidden="true"
                      className="skew-plate-bg border border-hairline-strong bg-surface transition-colors duration-80 group-hover:border-tier-1 group-hover:bg-tier-1 group-focus-visible:border-tier-1 group-focus-visible:bg-tier-1"
                    />
                    <span className="max-w-full truncate">{player.name}</span>
                  </span>
                </span>
                <span className="flex min-h-11 items-center justify-center gap-1.5 px-3 pb-2 pt-1">
                  {player.rating != null ? (
                    <>
                      <ItemIcon item="great-ball" size={24} />
                      <span className="sr-only">
                        {t('players.ratingLabel', {
                          rating: String(Math.round(player.rating)),
                          rd: String(Math.round(player.rd ?? 0)),
                        })}
                      </span>
                      <span aria-hidden="true" className="font-heading text-title tabular-nums text-fg">
                        {Math.round(player.rating)}
                      </span>
                      <span aria-hidden="true" className="font-mono text-caption tabular-nums text-fg-muted">
                        ±{Math.round(player.rd ?? 0)}
                      </span>
                    </>
                  ) : (
                    <span className="text-caption text-fg-muted">{t('players.unrated')}</span>
                  )}
                </span>
              </Link>
            </GlideGridItem>
          ))}
        </GlideGrid>
      )}

      {totalPages > 1 && (
        <nav aria-label={t('players.pageOf', { page, total: totalPages })} className="flex flex-wrap items-center justify-center gap-4">
          {page > 1 && (
            <Link
              href={`/players?page=${page - 1}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
              className="inline-flex min-h-11 items-center"
            >
              <SkewPlate variant="button" tone="secondary">
                {t('players.previous')}
              </SkewPlate>
            </Link>
          )}
          <span className="text-caption tabular-nums text-fg-muted">
            {t('players.pageOf', { page, total: totalPages })}
          </span>
          {page < totalPages && (
            <Link
              href={`/players?page=${page + 1}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
              className="inline-flex min-h-11 items-center"
            >
              <SkewPlate variant="button" tone="secondary">
                {t('players.next')}
              </SkewPlate>
            </Link>
          )}
        </nav>
      )}
    </PageContainer>
  );
}
