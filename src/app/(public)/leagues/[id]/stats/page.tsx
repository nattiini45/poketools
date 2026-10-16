import { permanentRedirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LeagueStatsRedirectPage({ params }: PageProps) {
  const { id } = await params;
  permanentRedirect(`/insights?scope=league&id=${id}&tab=usage`);
}
