import { notFound } from 'next/navigation';
import { renderCompetitionDetail } from '@/components/tournament/CompetitionDetailPage';
import { tournamentMetadata } from '@/lib/seo/page-metadata';
import { readTournament } from '@/lib/seo/page-reads';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Pick<PageProps, 'params'>) {
  return tournamentMetadata((await params).id);
}

export default async function TournamentPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const tournament = await readTournament(id);
  if (!tournament) notFound();
  return renderCompetitionDetail({ kind: 'tournament', tournament }, await searchParams);
}
