import { notFound, redirect } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import ResourceForbidden from '@/components/shared/ResourceForbidden';
import FormatEditor from '@/components/format-studio/editor/FormatEditor';
import PageContainer from '@/components/ui/PageContainer';
import { resolveLText } from '@/lib/format-kit/client';
import { gateFormatDefinition } from '@/lib/format-studio/gate';
import { getFormatDetail } from '@/lib/format-studio/library';
import { listRulesets } from '@/lib/supabase/queries/rulesets';
import { getLocale, getT } from '@/i18n/server';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * `/admin/formats/[id]/edit`: the format editor. The gate is `gateFormatDefinition` (live player and the
 * definition row, never the token): a malformed or unknown id is a 404, a non-admin gets the guard, an admin who
 * may not see the format the forbidden notice. Only the owner and site admins edit; anyone else who may see the
 * format is sent to its read-only page.
 *
 * The editor gets the summary (the owner as an id and a name, no player row), the draft and its revision, the
 * published head and the rulesets as id and name. Errors thrown by the reads fall to the admin error boundary.
 */
export default async function FormatEditPage({ params }: PageProps) {
  const { id } = await params;
  const gate = await gateFormatDefinition(id);
  if (gate.kind === 'guard') return <AdminGuard>{null}</AdminGuard>;
  if (gate.kind === 'forbidden') {
    const t = await getT(formatStudioEditorMessages);
    return (
      <AdminGuard>
        <ResourceForbidden>{t('page.forbidden')}</ResourceForbidden>
      </AdminGuard>
    );
  }
  if (!gate.canEdit) redirect(`/admin/formats/${id}`);

  const [detail, rulesets, locale] = await Promise.all([getFormatDetail(gate.player, gate.definition), listRulesets(), getLocale()]);
  if (detail.draft === null) notFound();

  const title = resolveLText(detail.definition.name, { viewer: locale })?.value ?? detail.definition.slug;

  return (
    <AdminGuard>
      <PageContainer title={title} maxWidth="xl">
        <FormatEditor
          definitionId={id}
          summary={detail.definition}
          initial={{ document: detail.draft.document, draftRev: detail.draft.draft_rev }}
          published={detail.published === null ? null : { versionNo: detail.published.version_no, contentHash: detail.published.content_hash }}
          actor={gate.actor}
          rulesets={rulesets.map((r) => ({ id: r.id, name: r.name }))}
          hasAttachments={false}
        />
      </PageContainer>
    </AdminGuard>
  );
}
