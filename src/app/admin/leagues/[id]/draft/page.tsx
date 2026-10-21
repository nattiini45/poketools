import { notFound } from 'next/navigation';
import Link from 'next/link';
import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import DraftControlPanel from '@/components/draft-admin/DraftControlPanel';
import { getDraftSnapshot } from '@/lib/draft/snapshot';
import { getLocale, getT } from '@/i18n/server';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { legacyBoardHref } from '@/lib/draft-ui/select-pool';
import { leagueAdminHref } from '@/lib/league-admin/tabs';
import type { AdminPoolSummary, DraftSnapshotDTO } from '@/types/draft-queue';
import type { Translator } from '@/i18n/core';
import { gateDraftAdmin, loadAdminDraftData, loadPublishRefusals } from './_lib/load';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  /** `?pool=<id>` opens that pool's tab (the room's admin sheet links here with it). */
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

const BACK = 'inline-flex min-h-11 items-center gap-1 text-sm text-poke-text-secondary hover:text-poke-text-primary mb-2 sm:min-h-0';
const LINK = 'inline-flex min-h-11 items-center text-sm font-medium text-poke-text-link hover:underline sm:min-h-0';

type AdminT = Translator<typeof draftAdminMessages.en>;

function phaseLabel(t: AdminT, phase: AdminPoolSummary['phase']): string {
  switch (phase) {
    case 'setup':
      return t('panel.phase.setup');
    case 'submissions':
      return t('panel.phase.submissions');
    case 'drafting':
      return t('panel.phase.drafting');
    case 'complete':
      return t('panel.phase.complete');
    case 'cancelled':
      return t('panel.phase.cancelled');
  }
}

/**
 * Legacy-engine (pre-M2) pools: the control panel cannot open them (their
 * snapshot raises POOL_ENGINE_LEGACY), so they are listed with links to the
 * legacy pool editor (league admin page, Draft tab) and board.
 */
function legacyPoolsSection(seasonId: string, pools: readonly AdminPoolSummary[], t: AdminT) {
  return (
    <section className="mb-4 rounded-lg border border-poke-border p-3" aria-labelledby="legacy-drafts">
      <h2 id="legacy-drafts" className="text-sm font-semibold">
        {t('page.legacyTitle')}
      </h2>
      <p className="mt-1 text-xs text-poke-text-muted">{t('page.legacyNote')}</p>
      <ul className="mt-2 space-y-1">
        {pools.map((pool) => (
          <li key={pool.id} className="text-sm">
            {pool.kind === 'redraft' ? t('page.legacyRedraft') : t('page.legacyInitial')}
            {' · '}
            <span className="text-poke-text-secondary">{phaseLabel(t, pool.phase)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <Link href={leagueAdminHref(seasonId, 'draft')} className={LINK}>
          {t('page.legacyManage')}
        </Link>
        <Link href={legacyBoardHref(seasonId)} className={LINK}>
          {t('page.legacyBoard')}
        </Link>
      </div>
    </section>
  );
}

/**
 * `/admin/leagues/[id]/draft?pool=<id>` — the draft control panel (draft-frontend §3.4, §7).
 *
 * Gated like the admin league page (admin layout + `AdminGuard`) plus the
 * resource check of this season, before any draft read. Only queue-engine
 * pools get tabs; legacy (pre-M2) pools are listed with links. Every queue
 * pool's snapshot is seeded with `{ tick: false }` (a render never advances a
 * clock, critique B9); a failed read throws to the admin error boundary (`src/app/admin/error.tsx`,
 * with "Try again"), never a silently empty tab.
 */
export default async function AdminDraftPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const [gate, t, locale] = await Promise.all([gateDraftAdmin(id), getT(draftAdminMessages), getLocale()]);

  if (gate.kind === 'guard') return <AdminGuard>{null}</AdminGuard>;
  if (gate.kind === 'forbidden') {
    return (
      <AdminGuard>
        <p className="p-8 text-center text-poke-text-secondary">{t('page.forbidden')}</p>
      </AdminGuard>
    );
  }

  const data = await loadAdminDraftData(id, locale);
  if (data.kind === 'notFound') notFound();
  if (data.kind !== 'ok') {
    return (
      <AdminGuard>
        <PageContainer title={t('page.title', { league: data.leagueName })} maxWidth="xl">
          <p className="text-poke-text-secondary">{data.kind === 'notEpb' ? t('page.notEpb') : t('page.noList')}</p>
        </PageContainer>
      </AdminGuard>
    );
  }

  const viewer = { playerId: gate.playerId, isPoolAdmin: true };
  const [seeded, publishRefusedAt] = await Promise.all([
    Promise.all(
      // A failed snapshot read propagates to the admin error boundary (AGENTS rule 5, lead ruling round 5):
      // the control panel never opens on a pool whose state it could not read.
      data.pools.map(async (pool): Promise<[string, DraftSnapshotDTO | null]> => {
        const result = await getDraftSnapshot(pool.id, viewer, { tick: false });
        return [pool.id, 'unchanged' in result.dto ? null : result.dto];
      }),
    ),
    loadPublishRefusals(data.pools),
  ]);
  const initialSnapshots: Record<string, DraftSnapshotDTO> = {};
  for (const [poolId, dto] of seeded) if (dto) initialSnapshots[poolId] = dto;

  // `?pool=` must name a queue pool of this season; anything else falls back to the panel's default tab.
  const requestedPool = Array.isArray(query.pool) ? query.pool[0] : query.pool;
  const initialPoolId = data.pools.some((p) => p.id === requestedPool) ? (requestedPool ?? null) : null;

  return (
    <AdminGuard>
      <PageContainer title={t('page.title', { league: data.leagueName })} subtitle={t('page.subtitle')} maxWidth="xl">
        <Link href={leagueAdminHref(id, 'draft')} className={BACK}>
          {t('page.backToLeague')}
        </Link>
        {data.legacyPools.length > 0 ? legacyPoolsSection(id, data.legacyPools, t) : null}
        {data.pools.length === 0 ? (
          <p className="text-poke-text-secondary">
            {data.legacyPools.length > 0 ? t('page.noQueuePools') : t('page.noPools')}
          </p>
        ) : (
          <DraftControlPanel
            seasonId={id}
            pools={data.pools}
            catalog={data.catalog}
            initialSnapshots={initialSnapshots}
            initialPoolId={initialPoolId}
            publishRefusedAt={publishRefusedAt}
            links={{ audit: `/admin/leagues/${id}/draft/audit`, room: `/leagues/${id}/draft-room` }}
          />
        )}
      </PageContainer>
    </AdminGuard>
  );
}
