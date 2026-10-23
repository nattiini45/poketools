import { redirect, notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import ResourceForbidden from '@/components/shared/ResourceForbidden';
import { gateResourceAdmin } from '@/lib/auth/resource-gate';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TournamentRoundsPage({ params }: PageProps) {
  const { id } = await params;

  // Live per-resource gate before any tournament read: the admin layout only proves "some admin".
  // The tournament gate also passes for an admin of the parent league, so a season admin still
  // reaches their league's stages through the redirect below.
  const gate = await gateResourceAdmin('tournament', id);
  if (gate.kind === 'guard') return <AdminGuard>{null}</AdminGuard>;
  if (gate.kind === 'forbidden') {
    return (
      <AdminGuard>
        <ResourceForbidden />
      </AdminGuard>
    );
  }

  const tournament = await getTournamentById(id);
  if (!tournament) notFound();

  if (tournament.season_id) {
    redirect(`/admin/leagues/${tournament.season_id}/phases/${id}`);
  }

  const { default: LegacyRoundsPage } = await import('./LegacyRoundsPage');
  return <LegacyRoundsPage id={id} isSiteAdmin={gate.isSiteAdmin} />;
}
