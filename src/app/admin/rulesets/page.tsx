import Link from 'next/link';
import SiteAdminGuard from '@/components/shared/SiteAdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { getButtonClasses } from '@/components/ui/buttonStyles';
import { getLiveAccess } from '@/lib/auth/helpers';
import { listRulesets } from '@/lib/supabase/queries/rulesets';
import { getT } from '@/i18n/server';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';

export const dynamic = 'force-dynamic';

export const revalidate = 60;

export default async function AdminRulesetsPage() {
  // Site-admin page: no ruleset read for a viewer who is not one (the guard renders the denial).
  const access = await getLiveAccess();
  if (!access?.isSiteAdmin) return <SiteAdminGuard>{null}</SiteAdminGuard>;

  const [rulesets, t] = await Promise.all([listRulesets(), getT(adminToolsMessages)]);

  return (
    <SiteAdminGuard>
      <PageContainer
        title={t('rulesets.title')}
        maxWidth="md"
        action={
          <Link href="/admin/rulesets/new" className={getButtonClasses('secondary', 'sm')}>
            {t('rulesets.newRuleset')}
          </Link>
        }
      >
        {rulesets.length === 0 ? (
          <p className="text-poke-text-muted">{t('rulesets.empty')}</p>
        ) : (
          <div className="grid gap-3">
            {rulesets.map((r) => (
              <Link key={r.id} href={`/admin/rulesets/${r.id}/edit`}>
                <Card hover>
                  <h2 className="font-heading font-semibold text-poke-text-primary">{r.name}</h2>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <Badge>{r.base_format}</Badge>
                    {r.is_doubles && <Badge variant="purple">{t('rulesets.doubles')}</Badge>}
                    <Badge variant="gray">{t('rulesets.clauses', { count: r.clauses.length })}</Badge>
                    <Badge variant="gray">
                      {t('rulesets.bans', {
                        count: r.bans.pokemon.length + r.bans.moves.length + r.bans.items.length + r.bans.abilities.length,
                      })}
                    </Badge>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </PageContainer>
    </SiteAdminGuard>
  );
}
