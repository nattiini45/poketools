import { notFound, redirect } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import ResourceForbidden from '@/components/shared/ResourceForbidden';
import RulesetEditor from '@/components/ruleset-studio/editor/RulesetEditor';
import PageContainer from '@/components/ui/PageContainer';
import { getLocale, getT } from '@/i18n/server';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import { resolvePresetRules } from '@/lib/pkmn/preset-rules.server';
import { gateRulesetDefinition } from '@/lib/ruleset-studio/gate';
import { getRulesetDetail } from '@/lib/ruleset-studio/library';
import { validateRulesetDocument } from '@/lib/ruleset-kit/validate';
import { resolveLText } from '@/lib/studio-core/ltext';
import { rulesetReadOnlyHref } from '@/components/ruleset-studio/hrefs';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * `/admin/rulesets/[id]/edit`: the ruleset editor. The gate is `gateRulesetDefinition` (live player and the definition
 * row, never the token): a malformed or unknown id is a 404, a non-admin gets the guard, an admin who may not see the
 * ruleset the forbidden notice. Only those who may edit the draft (the owner, the admins of the league that owns it,
 * site admins) stay; anyone else who may see the ruleset is sent to its read-only page.
 *
 * The editor gets the summary (the owner as an id and a name, no player row), the draft and its revision, the published head
 * and the resolved rules of the draft's base preset, so the first paint needs no request for them.
 */
export default async function RulesetEditPage({ params }: PageProps) {
  const { id } = await params;
  const gate = await gateRulesetDefinition(id);
  if (gate.kind === 'guard') return <AdminGuard>{null}</AdminGuard>;
  if (gate.kind === 'forbidden') {
    const t = await getT(rulesetStudioSectionsMessages);
    return (
      <AdminGuard>
        <ResourceForbidden>{t('page.forbidden')}</ResourceForbidden>
      </AdminGuard>
    );
  }
  if (!gate.canEdit) redirect(rulesetReadOnlyHref(id));

  const [detail, locale] = await Promise.all([getRulesetDetail(gate.actor, gate.definition), getLocale()]);
  if (detail.draft === null) notFound();

  const parsed = validateRulesetDocument(detail.draft.document);
  const initialPreset = parsed.ok && parsed.document.base.kind === 'preset' ? resolvePresetRules(parsed.document.base.preset) : null;
  const title = resolveLText(detail.definition.name, { viewer: locale })?.value ?? detail.definition.slug;
  const leagueIds = gate.actor.leagueIds === undefined ? [] : [...gate.actor.leagueIds];

  return (
    <AdminGuard>
      <PageContainer title={title} maxWidth="full">
        <RulesetEditor
          definitionId={id}
          summary={detail.definition}
          initial={{ document: detail.draft.document, draftRev: detail.draft.draft_rev }}
          published={
            detail.published === null
              ? null
              : { versionNo: detail.published.version_no, contentHash: detail.published.content_hash, resolvedHash: detail.published.resolved_hash }
          }
          actor={{ playerId: gate.actor.playerId, isAdmin: gate.actor.isAdmin, leagueIds }}
          initialPreset={initialPreset}
        />
      </PageContainer>
    </AdminGuard>
  );
}
