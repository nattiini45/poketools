import { notFound } from 'next/navigation';
import { renderCompetitionDetail } from '@/components/tournament/CompetitionDetailPage';
import { phaseMetadata } from '@/lib/seo/page-metadata';
import { readLeaguePhase } from '@/lib/seo/page-reads';

interface PageProps {
  params: Promise<{ id: string; phaseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Pick<PageProps, 'params'>) {
  const { id, phaseId } = await params;
  return phaseMetadata(id, phaseId, 'stats');
}

export default async function LeaguePhaseStatsPage({ params, searchParams }: PageProps) {
  const { id, phaseId } = await params;
  const phase = await readLeaguePhase(id, phaseId);
  if (!phase) notFound();
  return renderCompetitionDetail(phase, await searchParams, 'stats');
}
