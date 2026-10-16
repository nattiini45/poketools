import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getSeasonWithDetails } from '@/lib/supabase/queries/seasons';
import { getDraftPoolsBySeason } from '@/lib/supabase/queries/drafts';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { getDraftSnapshot, type ViewerContext } from '@/lib/draft/snapshot';
import { lineThresholdsFromEntries } from '@/lib/draft/epb-thresholds';
import { buildLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { DraftSnapshotDTO } from '@/lib/draft-ui/snapshot-types';
import { isQueuePool } from '@/lib/draft-ui/select-pool';
import { getLocale, getT } from '@/i18n/server';
import { draftRedraftMessages } from '@/i18n/messages/draft/redraft';
import RedraftCenter from '@/components/draft-redraft/RedraftCenter';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ id: string }>;
}

const LINK = 'text-poke-text-link hover:underline mt-2 inline-block';

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center">{children}</div>;
}

/**
 * `/leagues/[id]/redraft` — the player's redraft page (draft-frontend §3.2).
 *
 * Public page. The latest redraft pool's snapshot seeds the client (no tick
 * during render, critique B9). The viewer's own drop submission is secret
 * until the deadline: it is fetched client-side from the owner-guarded route
 * (BE #18) and never read or rendered here. Participants cross into the
 * client only inside the snapshot DTO (allowlist mapper); no `players` row
 * is passed.
 */
export default async function RedraftPage({ params }: PageProps) {
  const { id } = await params;

  const [player, league, t, locale] = await Promise.all([
    getSessionPlayer(),
    getSeasonWithDetails(id),
    getT(draftRedraftMessages),
    getLocale(),
  ]);
  if (!league) notFound();

  if (!isEvolutionPointBuy(league.format_type)) {
    return (
      <EmptyState>
        <p className="text-poke-text-secondary">{t('page.notEpb')}</p>
        <Link href={`/leagues/${id}`} className={LINK}>
          {t('page.backToLeague')}
        </Link>
      </EmptyState>
    );
  }

  const [pools, isPoolAdmin] = await Promise.all([
    getDraftPoolsBySeason(id),
    player
      ? player.isAdmin ||
        (player.isResourceAdmin && isResourceAdminFor(player.playerId, 'season', id))
      : false,
  ]);
  // Oldest first: the last queue-engine redraft pool is the current one. A
  // legacy (pre-M2) pool is never opened here (POOL_ENGINE_LEGACY).
  const pool = pools.filter((p) => p.kind === 'redraft' && isQueuePool(p)).at(-1) ?? null;
  if (!pool) {
    return (
      <EmptyState>
        <p className="text-poke-text-secondary">{t('page.noRedraft')}</p>
        <Link href={`/leagues/${id}`} className={LINK}>
          {t('page.backToLeague')}
        </Link>
      </EmptyState>
    );
  }

  const listVersionId = league.point_buy_list_id;
  if (!listVersionId) {
    return (
      <EmptyState>
        <p className="text-poke-text-secondary">{t('page.noList')}</p>
      </EmptyState>
    );
  }

  const viewer: ViewerContext | null = player ? { playerId: player.playerId, isPoolAdmin } : null;
  const [snapshot, entries] = await Promise.all([
    getDraftSnapshot(pool.id, viewer, { tick: false }).then(
      (result): DraftSnapshotDTO | null => ('unchanged' in result.dto ? null : result.dto),
      (err: unknown) => {
        console.error(`[redraft] snapshot read failed for pool ${pool.id}`, err);
        return null;
      },
    ),
    getListEntries(listVersionId),
  ]);

  // The redraft UI shows line names, prices and flags only; banned moves feed
  // the finder, which this page does not render (one Supabase read saved).
  const catalog = buildLineCatalog(entries, lineThresholdsFromEntries(entries), [], locale);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <h1 className="text-2xl font-bold">{t('page.title', { league: league.name })}</h1>

      {!player ? (
        <div className="rounded-lg border border-poke-border bg-poke-card p-3 text-sm">
          <p>{t('page.signIn')}</p>
          <Link href="/api/auth/signin" className={LINK}>
            {t('page.signInLink')}
          </Link>
        </div>
      ) : null}

      <RedraftCenter
        key={pool.id}
        seasonId={id}
        poolId={pool.id}
        catalog={catalog}
        initialSnapshot={snapshot}
        viewer={{ playerId: player?.playerId ?? null }}
        links={{ room: `/leagues/${id}/draft-room?pool=${encodeURIComponent(pool.id)}` }}
      />
    </div>
  );
}
