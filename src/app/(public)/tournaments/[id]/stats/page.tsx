import { permanentRedirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TournamentStatsRedirectPage({ params }: PageProps) {
  const { id } = await params;
  permanentRedirect(`/insights?scope=tournament&id=${id}&tab=usage`);
}
