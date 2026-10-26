import Link from 'next/link';
import AdminGuard from '@/components/shared/AdminGuard';
import ResourceForbidden from '@/components/shared/ResourceForbidden';
import FormatDetail from '@/components/format-studio/FormatDetail';
import ForkStoredButton from '@/components/format-studio/starts/ForkStoredButton';
import Badge from '@/components/ui/Badge';
import PageContainer from '@/components/ui/PageContainer';
import { compile } from '@/lib/format-kit/client';
import { resolveLText } from '@/lib/studio-core/ltext';
import { gateFormatDefinition } from '@/lib/format-studio/gate';
import { getFormatDetail } from '@/lib/format-studio/library';
import { toFormatView } from '@/lib/format-studio/view';
import { getLocale, getT } from '@/i18n/server';
import { formatStudioAdminMessages } from '@/i18n/messages/format-studio/admin';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

const LINK = 'inline-flex min-h-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0';

/**
 * `/admin/formats/[id]`: the read-only page of one stored format. The gate is `gateFormatDefinition`: a malformed
 * or unknown id is a 404, a non-admin gets the guard, an admin who may not see this format (another admin's
 * private one) the forbidden notice. It shows the newest published version; an editor of a format with no
 * published version sees the saved draft instead. The owner appears as a name only.
 */
export default async function FormatPage({ params }: PageProps) {
  const { id } = await params;
  const gate = await gateFormatDefinition(id);
  if (gate.kind === 'guard') return <AdminGuard>{null}</AdminGuard>;
  if (gate.kind === 'forbidden') {
    const tEditor = await getT(formatStudioEditorMessages);
    return (
      <AdminGuard>
        <ResourceForbidden>{tEditor('page.forbidden')}</ResourceForbidden>
      </AdminGuard>
    );
  }

  const [detail, t, tEditor, locale] = await Promise.all([
    getFormatDetail(gate.player, gate.definition),
    getT(formatStudioAdminMessages),
    getT(formatStudioEditorMessages),
    getLocale(),
  ]);

  const source = detail.published !== null ? detail.published.spec : (detail.draft?.document ?? null);
  const view = source === null ? null : toFormatView(compile(source), { rulesets: detail.rulesets.map((r) => ({ id: r.id, name: r.name })) });
  const summary = detail.definition;
  const title = resolveLText(summary.name, { viewer: locale })?.value ?? summary.slug;

  return (
    <AdminGuard>
      <PageContainer title={title} maxWidth="lg">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Badge variant="gray">{tEditor(`toolbar.visibility.${summary.visibility}`)}</Badge>
          <Badge variant={summary.current_version === null ? 'gray' : 'green'}>
            {summary.current_version === null
              ? tEditor('list.state.draft')
              : tEditor('list.state.published', { n: summary.current_version.version_no })}
          </Badge>
          {summary.owner !== null && <span className="text-sm text-poke-text-secondary">{tEditor('list.by', { name: summary.owner.name })}</span>}
          <Link href="/admin/formats" className={LINK}>
            {t('detail.back')}
          </Link>
          {gate.canEdit && (
            <Link href={`/admin/formats/${id}/edit`} className={LINK}>
              {tEditor('list.edit')}
            </Link>
          )}
        </div>
        <ForkStoredButton definitionId={id} />
        {view === null ? <p className="text-sm text-poke-text-muted">{tEditor('page.noContent')}</p> : <FormatDetail view={view} variant="page" />}
      </PageContainer>
    </AdminGuard>
  );
}
