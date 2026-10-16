import { redirect, notFound } from 'next/navigation';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TournamentRoundsPage({ params }: PageProps) {
  const { id } = await params;
  const tournament = await getTournamentById(id);
  if (!tournament) notFound();

  if (tournament.season_id) {
    redirect(`/admin/leagues/${tournament.season_id}/phases/${id}`);
  }

  const { default: LegacyRoundsPage } = await import('./LegacyRoundsPage');
  return <LegacyRoundsPage id={id} />;
}
