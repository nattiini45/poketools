import AdminGuard from '@/components/shared/AdminGuard';
import NewCompetitionHeader from '@/components/league/wizard/NewCompetitionHeader';
import NewCompetitionWizard from '@/components/league/wizard/NewCompetitionWizard';
import { getLiveAccess } from '@/lib/auth/helpers';
import { describeDefinition } from '@/lib/format-kit/client';
import { presetsOf } from '@/lib/format-kit/ruleset-presets';
import { loadAttachCandidates } from '@/lib/format-studio/attach-candidates';
import { presetViews } from '@/lib/format-studio/loader';
import { wizardStartFromQuery, type WizardExample, type WizardFormat } from '@/lib/league-admin/wizard';
import { resolveLText } from '@/lib/studio-core/ltext';
import { listRulesetOptionsFor } from '@/lib/supabase/queries/rulesets';
import { listCloneSourceOptions } from '@/lib/supabase/queries/season-clone';
import { getAdminSeasonIds } from '@/lib/supabase/queries/resource-admins';
import { getLocale } from '@/i18n/server';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{ preset?: string | string[]; format?: string | string[] }>;
}

const single = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * `/admin/leagues/new`: the new-competition wizard for a league. `?preset=<id>` or `?format=<definition id>` opens it
 * with that starting point picked (the format gallery's "Create a league from this"). Any admin may open it; nothing is
 * read before the live gate, and only names and counts reach the client.
 */
export default async function NewLeaguePage({ searchParams }: PageProps) {
  // Live roles (not the session copy), and no data read before we know the viewer is an admin.
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return <AdminGuard>{null}</AdminGuard>;

  // Site admin: any league may be a source. Resource admin: only their own.
  const sourceScope = access.isSiteAdmin ? null : await getAdminSeasonIds(access.player.playerId);

  const [sources, candidates, locale, query] = await Promise.all([
    listCloneSourceOptions(sourceScope),
    loadAttachCandidates(access.player),
    getLocale(),
    searchParams,
  ]);
  // A league started from another one takes over its ruleset pin, which may be an older version than the newest: the select
  // keeps those versions so the cloned choice is shown as what it is.
  const rulesets = await listRulesetOptionsFor({
    actor: { playerId: access.player.playerId, isAdmin: access.isSiteAdmin },
    seasonId: null,
    keep: sources.map((source) => source.ruleset_id),
  });

  const examples: WizardExample[] = presetViews().flatMap(({ id, view }) => {
    if (view.definition === null) return [];
    const doc = describeDefinition(view.definition, locale, { plan: view.plan ?? undefined, order: view.order, rulesets: view.rulesets });
    return [
      {
        id,
        title: doc.title,
        summary: doc.summary,
        overview: doc.overview,
        stages: doc.stages.map((stage) => ({ key: stage.key, name: stage.name, detail: [stage.pairing, stage.series].filter((part) => part !== '').join(' ') })),
        needsLeagueRuleset: view.definition.stages.some((stage) => stage.ruleset.kind === 'season_default'),
        presetRulesetCount: presetsOf(view.definition).length,
      },
    ];
  });
  const formats: WizardFormat[] = candidates.items.map((item) => ({
    id: item.id,
    name: resolveLText(item.name, { viewer: locale })?.value ?? item.slug,
    version: item.version_no,
    ownerName: item.ownerName,
    mine: item.mine,
  }));

  return (
    <AdminGuard>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <NewCompetitionHeader kind="league" />
        <NewCompetitionWizard
          examples={examples}
          formats={formats}
          rulesets={rulesets}
          sources={sources}
          isSiteAdmin={access.isSiteAdmin}
          initialStart={wizardStartFromQuery({ preset: single(query?.preset), format: single(query?.format) }, examples, formats)}
        />
      </div>
    </AdminGuard>
  );
}
