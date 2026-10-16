import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getSeasonWithDetails } from '@/lib/supabase/queries/seasons';
import { getDraftPoolsBySeason } from '@/lib/supabase/queries/drafts';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { resolveViewerWorld, WORLD_OVERRIDE_URL_PARAM } from '@/lib/worlds/registry';
import { getDraftSnapshot, type ViewerContext } from '@/lib/draft/snapshot';
import { lineThresholdsFromEntries } from '@/lib/draft/epb-thresholds';
import { buildLineCatalog, hashCatalog } from '@/lib/draft-finder/line-catalog';
import { INDEX_SCHEMA_VERSION } from '@/lib/draft-finder/index-types';
import { legacyBoardHref, selectPool } from '@/lib/draft-ui/select-pool';
import type { DraftSnapshotDTO } from '@/lib/draft-ui/snapshot-types';
import { getLocale, getT } from '@/i18n/server';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { DEFAULT_BANNED_MOVES } from '@/types/format-rules';
import WorldShell from '@/components/world/WorldShell';
import WorldOverrideRedirect from '@/components/world/route/WorldOverrideRedirect';
import RedraftPhaseNotice from '@/components/draft-redraft/RedraftPhaseNotice';
import DraftRoomClient from './client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const LINK = 'text-poke-text-link hover:underline mt-2 inline-block';

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center">{children}</div>;
}

/**
 * `/leagues/[id]/draft-room` — the EPB pick screen (draft-frontend §3.1).
 *
 * Public page: spectators see the server seed; signed-in viewers poll. The
 * session is read for display flags only — every write route re-checks.
 * Participants cross into the client only inside the snapshot DTO, which
 * the backend builds with an allowlist mapper; no `players` row is passed.
 *
 * Supabase budget (cold): season, pools, resource-admin check (resource
 * admins only), snapshot RPC, list entries, format rules — at most 6.
 */
export default async function DraftRoomPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;

  const [player, league, t, locale] = await Promise.all([
    getSessionPlayer(),
    getSeasonWithDetails(id),
    getT(draftScreenMessages),
    getLocale(),
  ]);
  if (!league) notFound();

  if (!isEvolutionPointBuy(league.format_type)) {
    return (
      <EmptyState>
        <p className="text-poke-text-secondary">{t('page.notEpb')}</p>
        <Link href={`/leagues/${id}/draft`} className={LINK}>
          {t('page.standardDraft')}
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
  // Queue-engine pools only: a legacy (pre-M2) pool's snapshot raises
  // POOL_ENGINE_LEGACY, so legacy drafts are linked to the legacy board.
  const { pool, reason, legacyPools } = selectPool(pools, query.pool);

  // Legacy-only season: `/leagues/[id]/draft` renders the legacy board for it
  // (it does not redirect here), so this links there and never redirects.
  if (reason === 'legacy_only') {
    return (
      <EmptyState>
        <p className="text-poke-text-secondary">{t('page.legacyOnly')}</p>
        <Link href={legacyBoardHref(id)} className={LINK}>
          {t('page.legacyBoard')}
        </Link>
      </EmptyState>
    );
  }

  // `/leagues/[id]/draft` redirects EPB leagues without a pool here, so the
  // empty states offer no "back to the draft page" link (it would land here).
  if (!pool) {
    return (
      <EmptyState>
        <p className="text-poke-text-secondary">
          {league.point_buy_list_id ? t('page.noPoolAdmin') : t('page.noPool')}
        </p>
        {league.point_buy_list_id && isPoolAdmin ? (
          <Link href={`/admin/leagues/${id}`} className={LINK}>
            {t('page.goToAdmin')}
          </Link>
        ) : null}
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
  const [snapshot, entries, formatRules] = await Promise.all([
    // The same read as the state route, without the tick (critique B9), so the
    // first paint equals the first poll. A failed read seeds null: the client
    // shows "loading" and polls.
    getDraftSnapshot(pool.id, viewer, { tick: false }).then(
      (result): DraftSnapshotDTO | null => ('unchanged' in result.dto ? null : result.dto),
      (err: unknown) => {
        console.error(`[draft-room] snapshot read failed for pool ${pool.id}`, err);
        return null;
      },
    ),
    getListEntries(listVersionId),
    getFormatRules(id),
  ]);

  const banned = formatRules?.banned_moves?.length ? formatRules.banned_moves : DEFAULT_BANNED_MOVES;
  // Thresholds from the entries already read: the loader would cost two
  // extra reads (query budget, §3.1 step 7).
  const catalog = buildLineCatalog(entries, lineThresholdsFromEntries(entries), banned, locale);
  const indexUrl =
    `/api/point-buy-lists/${encodeURIComponent(listVersionId)}/search-index` +
    `?v=${INDEX_SCHEMA_VERSION}&h=${hashCatalog(entries)}`;

  // Same registry path as the scrollworld and tournament pages, resolved for
  // the VIEWER: `?world=` > admin pin > format auto-map.
  const world = resolveViewerWorld(league, query[WORLD_OVERRIDE_URL_PARAM]);

  return (
    <WorldShell world={world}>
      <WorldOverrideRedirect />
      <div>
        <div className="mb-4">
          <h1 className="text-2xl font-bold">{t('page.title', { league: league.name })}</h1>
          <p className="text-sm text-poke-text-secondary mt-1">
            {t('page.subtitle', { count: league.participant_count })}
          </p>
          {legacyPools.some((p) => p.kind === 'initial') ? (
            <p className="text-sm text-poke-text-secondary mt-1">
              {t('page.legacyInitial')}{' '}
              <Link href={legacyBoardHref(id)} className="text-poke-text-link hover:underline">
                {t('page.legacyInitialBoard')}
              </Link>
            </p>
          ) : null}
        </div>

        {reason === 'submissions' ? (
          // Before the snapshot seeds (failed read), the pool's own phase stands in.
          <RedraftPhaseNotice
            phase={snapshot?.redraft?.phase ?? 'submissions'}
            deadlineAt={snapshot?.redraft?.deadline_at ?? null}
            links={{ redraft: `/leagues/${id}/redraft` }}
          />
        ) : null}

        <DraftRoomClient
          key={pool.id}
          poolId={pool.id}
          seasonId={id}
          leagueName={league.name}
          catalog={catalog}
          initialSnapshot={snapshot}
          indexUrl={indexUrl}
          viewer={{ playerId: player?.playerId ?? null, isSiteAdmin: player?.isAdmin ?? false }}
          links={{
            redraft: `/leagues/${id}/redraft`,
            tokens: `/leagues/${id}/tokens`,
            admin: isPoolAdmin ? `/admin/leagues/${id}/draft` : null,
            trainerCreator: '/draft-room/trainer-creator',
          }}
        />
      </div>
    </WorldShell>
  );
}
