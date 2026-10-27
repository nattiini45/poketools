import AdminGuard from '@/components/shared/AdminGuard';
import ResourceForbidden from '@/components/shared/ResourceForbidden';
import RulesetPageView from '@/components/ruleset-studio/RulesetPageView';
import PageContainer from '@/components/ui/PageContainer';
import { getLocale, getT } from '@/i18n/server';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import { rulesetStudioEditorMessages } from '@/i18n/messages/ruleset-studio/editor';
import { rulesetStudioMessages } from '@/i18n/messages/ruleset-studio';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import { PRESET_RULES_VERSION } from '@/lib/pkmn/preset-data/pin';
import { describeDetail } from '@/lib/ruleset-studio/describe.server';
import { gateRulesetDefinition } from '@/lib/ruleset-studio/gate';
import { getRulesetDetail } from '@/lib/ruleset-studio/library';
import { listUsage } from '@/lib/ruleset-studio/pins';
import { getVersionChanges } from '@/lib/ruleset-studio/version-changes.server';
import { resolveLText } from '@/lib/studio-core/ltext';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * `/admin/rulesets/[id]`: the read-only page of one stored ruleset. The gate is `gateRulesetDefinition`: a malformed or
 * unknown id is a 404, a non-admin gets the guard, an admin who may not see this ruleset (another admin's private one)
 * the forbidden notice. It shows the rules of the newest published version in plain sentences; an editor of a ruleset
 * with no published version sees the saved draft instead, and the version list. The owner appears as a name only. A
 * ruleset with a published version also shows where it is used (`UsagePanel`): counts per version for everyone who may see
 * it, the named leagues and phases, with the update to the newest version, for site admins and the admins of a
 * league-owned ruleset. The version list says, for the newest versions, what each one changed against the one before (from the
 * frozen rules of both) and flags a version computed from older catalog data than this build has (`isCatalogStale`).
 */
export default async function RulesetPage({ params }: PageProps) {
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

  const [detail, usage, t, tList, tEditor, tRuleset, locale] = await Promise.all([
    getRulesetDetail(gate.actor, gate.definition),
    gate.definition.current_version_id === null ? Promise.resolve(null) : listUsage(gate.actor, gate.definition),
    getT(rulesetStudioSectionsMessages),
    getT(rulesetStudioMessages),
    getT(rulesetStudioEditorMessages),
    getT(rulesetMessages),
    getLocale(),
  ]);
  const changes = await getVersionChanges(id, detail.versions);

  const { described, isDraft } = describeDetail(detail, locale);
  const summary = detail.definition;
  const title = resolveLText(summary.name, { viewer: locale })?.value ?? summary.slug;

  return (
    <AdminGuard>
      <PageContainer title={title} maxWidth="lg">
        <RulesetPageView
          id={id}
          summary={summary}
          canEdit={gate.canEdit}
          locale={locale}
          described={described}
          isDraft={isDraft}
          usage={usage}
          latestVersionNo={detail.published?.version_no ?? null}
          versions={detail.versions}
          changes={changes}
          catalogVersion={PRESET_RULES_VERSION}
          t={t}
          tList={tList}
          tEditor={tEditor}
          tRuleset={tRuleset}
        />
      </PageContainer>
    </AdminGuard>
  );
}
