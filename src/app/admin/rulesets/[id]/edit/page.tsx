import SiteAdminGuard from '@/components/shared/SiteAdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import { getLiveAccess } from '@/lib/auth/helpers';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { notFound } from 'next/navigation';
import { isValidUuid } from '@/lib/utils/uuid';
import RulesetBuilder from '@/components/ruleset/RulesetBuilder';
import type { RulesetFormData } from '@/types/ruleset';
import { getT } from '@/i18n/server';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditRulesetPage({ params }: Props) {
  const { id } = await params;
  // Site-admin page: no ruleset read (and no 404 that reveals an id) for a viewer who is not one.
  const access = await getLiveAccess();
  if (!access?.isSiteAdmin) return <SiteAdminGuard>{null}</SiteAdminGuard>;

  if (!isValidUuid(id)) notFound();

  const [ruleset, t] = await Promise.all([getRulesetById(id), getT(adminToolsMessages)]);

  if (!ruleset) {
    notFound();
  }

  const initialData: RulesetFormData = {
    name: ruleset.name,
    base_format: ruleset.base_format,
    is_doubles: ruleset.is_doubles,
    clauses: ruleset.clauses,
    banned_pokemon: ruleset.bans.pokemon,
    banned_moves: ruleset.bans.moves,
    banned_items: ruleset.bans.items,
    banned_abilities: ruleset.bans.abilities,
    added_pokemon: ruleset.additions.pokemon,
    custom_rules_string: ruleset.custom_rules_string,
    min_shared_type_pct: ruleset.min_shared_type_pct ?? 0,
    team_constraints: ruleset.team_constraints,
  };

  return (
    <SiteAdminGuard>
      <PageContainer title={t('rulesets.editTitle', { name: ruleset.name })} maxWidth="md">
        <RulesetBuilder initialData={initialData} rulesetId={ruleset.id} />
      </PageContainer>
    </SiteAdminGuard>
  );
}
