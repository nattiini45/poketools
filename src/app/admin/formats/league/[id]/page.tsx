import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import ResourceForbidden from '@/components/shared/ResourceForbidden';
import FormatDetail from '@/components/format-studio/FormatDetail';
import Badge from '@/components/ui/Badge';
import PageContainer from '@/components/ui/PageContainer';
import { gateResourceAdmin } from '@/lib/auth/resource-gate';
import { loadLeagueFormat } from '@/lib/format-studio/loader';
import { leagueAdminHref } from '@/lib/league-admin/tabs';
import { getSeasonWithDetails } from '@/lib/supabase/queries/seasons';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { formatStudioAdminMessages } from '@/i18n/messages/format-studio/admin';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/** A fixed title: the league's name is only read once the gate has passed, and metadata runs outside it. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(formatStudioAdminMessages);
  return { title: t('meta.leagueTitle') };
}

const LINK = 'inline-flex min-h-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0';

/**
 * `/admin/formats/league/[id]`: the read-only format of one league. The gate is the league admin page's
 * (`gateResourceAdmin('season', id)`): a malformed id is a 404 before any read, a non-admin gets `AdminGuard`,
 * an admin of another league (or a tournament-only admin) the forbidden notice, and no league data is read
 * before the gate passes. A league without phases shows an empty state with a link to its Phases tab.
 */
export default async function FormatLeaguePage({ params }: PageProps) {
  const { id } = await params;
  const gate = await gateResourceAdmin('season', id);
  if (gate.kind === 'guard') return <AdminGuard>{null}</AdminGuard>;
  if (gate.kind === 'forbidden') {
    const tForbidden = await getT(formatStudioAdminMessages);
    return (
      <AdminGuard>
        <ResourceForbidden>{tForbidden('detail.forbidden')}</ResourceForbidden>
      </AdminGuard>
    );
  }

  const [league, t, tEnum] = await Promise.all([getSeasonWithDetails(id), getT(formatStudioAdminMessages), getT(enumMessages)]);
  if (!league) notFound();

  const result = await loadLeagueFormat(league);

  return (
    <AdminGuard>
      <PageContainer title={league.name} maxWidth="lg">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Badge>{enumLabel(tEnum, 'formatType', league.format_type)}</Badge>
          <Link href="/admin/formats" className={LINK}>
            {t('detail.back')}
          </Link>
          <Link href={leagueAdminHref(id, 'overview')} className={LINK}>
            {t('detail.backToLeague')}
          </Link>
        </div>
        {result.kind === 'no_phases' ? (
          <p className="text-sm text-poke-text-muted">
            {t.rich('detail.noPhases', {
              link: (chunks) => (
                <Link href={leagueAdminHref(id, 'phases')} className="text-poke-blue hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        ) : (
          <FormatDetail view={result.view} variant="page" editorLinks={result.editorLinks} />
        )}
      </PageContainer>
    </AdminGuard>
  );
}
