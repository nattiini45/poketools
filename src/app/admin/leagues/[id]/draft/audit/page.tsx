import { notFound } from 'next/navigation';
import Link from 'next/link';
import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import DraftAuditViewer from '@/components/draft-admin/DraftAuditViewer';
import { getLocale, getT } from '@/i18n/server';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { DRAFT_AUDIT_ACTIONS, type DraftAuditAction } from '@/types/draft-queue';
import { gateDraftAdmin, loadAdminDraftData } from '../_lib/load';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const BACK = 'inline-flex items-center gap-1 text-sm text-poke-text-secondary hover:text-poke-text-primary mb-2';

function listOf(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function isAuditAction(v: string): v is DraftAuditAction {
  return (DRAFT_AUDIT_ACTIONS as readonly string[]).includes(v);
}

/**
 * `/admin/leagues/[id]/draft/audit?pool=<id>&action=&player=` — the audit
 * trail viewer (draft-frontend §3.4, §7.3; acceptance item 20). Read-only:
 * the entries are loaded client-side from the admin-guarded BE #15; this
 * page only gates, picks the initial filters and passes narrow props.
 */
export default async function AdminDraftAuditPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
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
        <PageContainer title={t('page.auditTitle', { league: data.leagueName })} maxWidth="xl">
          <p className="text-poke-text-secondary">{data.kind === 'notEpb' ? t('page.notEpb') : t('page.noList')}</p>
        </PageContainer>
      </AdminGuard>
    );
  }

  const requestedPool = listOf(query.pool)[0];
  const initialPool =
    data.pools.find((p) => p.id === requestedPool) ??
    [...data.pools].reverse().find((p) => p.status === 'in_progress') ??
    data.pools.at(-1);
  const requestedPlayer = listOf(query.player)[0];
  const initialPlayer =
    requestedPlayer && data.participants.some((p) => p.id === requestedPlayer) ? requestedPlayer : null;
  const initialActions = DRAFT_AUDIT_ACTIONS.filter((a) => listOf(query.action).filter(isAuditAction).includes(a));

  return (
    <AdminGuard>
      <PageContainer
        title={t('page.auditTitle', { league: data.leagueName })}
        subtitle={t('page.auditSubtitle')}
        maxWidth="xl"
      >
        <Link href={`/admin/leagues/${id}/draft`} className={BACK}>
          {t('page.backToPanel')}
        </Link>
        {initialPool ? (
          <DraftAuditViewer
            seasonId={id}
            pools={data.pools}
            initialPoolId={initialPool.id}
            participants={data.participants}
            catalog={data.catalog}
            initialActions={initialActions}
            initialPlayer={initialPlayer}
          />
        ) : (
          <p className="text-poke-text-secondary">{t('page.noPools')}</p>
        )}
      </PageContainer>
    </AdminGuard>
  );
}
