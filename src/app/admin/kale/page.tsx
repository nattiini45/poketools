import { redirect } from 'next/navigation';
import { getSession, isSuperadmin } from '@/lib/auth/helpers';
import { listAllTournaments } from '@/lib/supabase/queries/tournaments';
import PageContainer from '@/components/ui/PageContainer';
import KaleConsole from './KaleConsole';

export const dynamic = 'force-dynamic';

export default async function KaleAdminPage() {
  const session = await getSession();

  if (!session) {
    redirect('/api/auth/signin');
  }

  if (!isSuperadmin(session)) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <h1 className="text-2xl font-heading font-bold text-poke-text-primary">
            Access Denied
          </h1>
          <p className="text-poke-text-secondary mt-2">
            Superadmin access required.
          </p>
        </div>
      </div>
    );
  }

  const tournaments = await listAllTournaments();

  return (
    <PageContainer title="Kale Cabbage 2.0" subtitle="Soft-deprecated tournament report generator" maxWidth="lg">
      <div className="mb-4 rounded-poke-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-poke-text-primary">
        Kale is disabled by default and retained for legacy report testing only. New report work should use the standard AI module paths unless the feature flag is explicitly enabled.
      </div>
      <KaleConsole tournaments={tournaments.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        season_name: t.season_name,
      }))} />
    </PageContainer>
  );
}
