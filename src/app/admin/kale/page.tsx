import { listAllTournaments } from '@/lib/supabase/queries/tournaments';
import SuperadminGuard from '@/components/shared/SuperadminGuard';
import Alert from '@/components/ui/Alert';
import PageContainer from '@/components/ui/PageContainer';
import SkewChip from '@/components/ui/SkewChip';
import { getT } from '@/i18n/server';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';
import KaleConsole from './KaleConsole';

export const dynamic = 'force-dynamic';

/**
 * `/admin/kale`: the soft-deprecated report console, for the superadmin only. The guard decides from the live
 * access read (signed out: the sign-in page; anyone else: the shared denial panel) and only then is the body
 * rendered, so the tournament list is never read for a viewer who may not see it.
 */
export default function KaleAdminPage() {
  return (
    <SuperadminGuard>
      <KaleBody />
    </SuperadminGuard>
  );
}

async function KaleBody() {
  const [t, tournaments] = await Promise.all([getT(adminToolsMessages), listAllTournaments()]);

  return (
    <PageContainer
      title={t('kale.title')}
      icon="rocky-helmet"
      subtitle={t('kale.subtitle')}
      action={<SkewChip tone="tier-1">{t('kale.legacy')}</SkewChip>}
      maxWidth="lg"
    >
      <Alert variant="warning">{t('kale.notice')}</Alert>
      <KaleConsole tournaments={tournaments.map((tournament) => ({
        id: tournament.id,
        name: tournament.name,
        status: tournament.status,
        season_name: tournament.season_name,
      }))} />
    </PageContainer>
  );
}
