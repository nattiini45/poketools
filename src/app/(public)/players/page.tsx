import Link from 'next/link';
import PageContainer from '@/components/ui/PageContainer';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import RatingBadge from '@/components/gamification/RatingBadge';
import Badge from '@/components/ui/Badge';
import GuestBadge from '@/components/shared/GuestBadge';
import { getPublicPlayers } from '@/lib/supabase/queries/players';
import { publicReads } from '@/lib/cache/public-reads';
import { getT } from '@/i18n/server';
import { discoverMessages } from '@/i18n/messages/discover';

// Reads no session. Rendered per request because it reads `searchParams`;
// unsearched pages come from the tagged public read cache (60 s).

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
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
    <PageContainer title={t('players.title')} subtitle={t('players.subtitle')} maxWidth="xl">
      <form className="mb-6" method="get">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder={t('players.searchPlaceholder')}
          maxLength={64}
          className="w-full max-w-md px-3 py-2 border border-poke-border rounded-poke-md bg-poke-surface text-poke-text-primary text-sm"
        />
      </form>

      {players.length === 0 ? (
        <p className="text-sm text-poke-text-muted">{t('players.empty')}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {players.map((player) => (
            <Link
              key={player.id}
              href={`/players/${player.id}`}
              className="flex items-center gap-3 p-4 bg-poke-surface border border-poke-border rounded-poke-lg hover:border-poke-accent/40 transition-colors"
            >
              <PlayerAvatar avatarUrl={player.avatar_url} name={player.name} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-heading font-semibold text-poke-text-primary truncate">
                    {player.name}
                  </span>
                  {player.is_creator && (
                    <Badge variant="purple" size="sm">
                      {t('players.creator')}
                    </Badge>
                  )}
                  {player.is_guest && <GuestBadge />}
                </div>
                {player.rating != null ? (
                  <div className="mt-1">
                    <RatingBadge rating={player.rating} rd={player.rd ?? 0} size="sm" />
                  </div>
                ) : (
                  <p className="text-xs text-poke-text-muted mt-1">{t('players.unrated')}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-8">
          {page > 1 && (
            <Link
              href={`/players?page=${page - 1}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
              className="text-sm text-poke-text-link hover:text-poke-accent hover:underline transition-colors"
            >
              {t('players.previous')}
            </Link>
          )}
          <span className="text-sm text-poke-text-muted">
            {t('players.pageOf', { page, total: totalPages })}
          </span>
          {page < totalPages && (
            <Link
              href={`/players?page=${page + 1}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
              className="text-sm text-poke-text-link hover:text-poke-accent hover:underline transition-colors"
            >
              {t('players.next')}
            </Link>
          )}
        </div>
      )}
    </PageContainer>
  );
}
