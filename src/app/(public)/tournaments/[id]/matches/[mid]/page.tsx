import { notFound } from 'next/navigation';
import { isValidUuid } from '@/lib/utils/uuid';
import { renderLegacyMatchDetail } from '@/lib/match/render-legacy-match-detail';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string; mid: string }>;
}

export default async function MatchDetailPage({ params }: PageProps) {
  const { id, mid } = await params;
  if (!isValidUuid(id) || !isValidUuid(mid)) notFound();
  return renderLegacyMatchDetail(id, mid);
}
