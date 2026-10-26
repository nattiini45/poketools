import AdminGuard from '@/components/shared/AdminGuard';
import RulesetsGalleryView from '@/components/ruleset-studio/RulesetsGalleryView';
import NewRulesetDialog from '@/components/ruleset-studio/starts/NewRulesetDialog';
import PageContainer from '@/components/ui/PageContainer';
import { getLocale, getT } from '@/i18n/server';
import { rulesetStudioMessages } from '@/i18n/messages/ruleset-studio';
import { getLiveAccess } from '@/lib/auth/helpers';
import { resolveLText } from '@/lib/studio-core/ltext';
import { PRESET_RULES_VERSION } from '@/lib/pkmn/preset-data/pin';
import { countPinsByDefinition, listRulesetDefinitions } from '@/lib/supabase/queries/ruleset-definitions';
import type { RulesetActor } from '@/lib/ruleset-studio/access';

export const dynamic = 'force-dynamic';

/** The most stored rulesets each list shows. */
const LIST_LIMIT = 50;

/**
 * `/admin/rulesets`: the Ruleset Studio home. The "New ruleset" action, the viewer's own rulesets, the ones other admins
 * shared, the viewer's own rulesets that belong to a league (made when a format was attached to it), the site catalog and the catalog of rule presets (every
 * Showdown ladder format and Smogon draft format the app knows, each one a start for a private copy). Any admin may open
 * it; nothing is read before the live gate. The dialog gets names, ids and version numbers only: no draft, no owner id.
 *
 * Each published card says how many leagues and phases use the ruleset (counts only, read for the listed definitions in one
 * go) and carries a "Catalog updated" badge when its published version was computed from older catalog data than this
 * build has (`isCatalogStale`).
 */
export default async function RulesetsGalleryPage() {
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return <AdminGuard>{null}</AdminGuard>;

  const [t, locale] = await Promise.all([getT(rulesetStudioMessages), getLocale()]);
  const actor: RulesetActor = { playerId: access.player.playerId, isAdmin: access.isSiteAdmin };

  const [mine, shared, site] = await Promise.all([
    listRulesetDefinitions({ actor, scope: 'mine', limit: LIST_LIMIT, offset: 0 }),
    listRulesetDefinitions({ actor, scope: 'shared', kind: 'custom', limit: LIST_LIMIT, offset: 0 }),
    listRulesetDefinitions({ actor, scope: 'shared', kind: 'preset', limit: LIST_LIMIT, offset: 0 }),
  ]);

  const usage = await countPinsByDefinition([...mine.items, ...shared.items, ...site.items].map((item) => item.id));
  const dialogData = {
    shared: shared.items
      .filter((item) => item.current_version !== null)
      .map((item) => ({
        id: item.id,
        name: resolveLText(item.name, { viewer: locale })?.value ?? item.slug,
        version: item.current_version?.version_no ?? 1,
      })),
  };

  return (
    <AdminGuard>
      <PageContainer title={t('page.title')} subtitle={t('page.subtitle')} maxWidth="xl" action={<NewRulesetDialog data={dialogData} />}>
        <RulesetsGalleryView t={t} locale={locale} mine={mine} shared={shared} site={site} usage={usage} catalogVersion={PRESET_RULES_VERSION} limit={LIST_LIMIT} />
      </PageContainer>
    </AdminGuard>
  );
}
