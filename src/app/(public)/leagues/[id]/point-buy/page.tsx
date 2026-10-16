import { notFound, permanentRedirect } from 'next/navigation';
import { getSeasonWithDetails } from '@/lib/supabase/queries/seasons';
import { getT } from '@/i18n/server';
import { draftLegacyPagesMessages } from '@/i18n/messages/draft/legacy/pages';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PointBuyListPage({ params }: PageProps) {
  const { id } = await params;
  const league = await getSeasonWithDetails(id);
  if (!league) notFound();

  if (league.format_type !== 'evolution_point_buy') {
    const t = await getT(draftLegacyPagesMessages);
    return (
      <div className="p-8 text-center">
        <p className="text-poke-text-secondary">
          {t('pointBuy.notEpb')}
        </p>
      </div>
    );
  }

  // EPB seasons render the point-buy list inside the EvoLiga scrollworld.
  // Legacy subroute permanently redirects into the roster section.
  permanentRedirect(`/leagues/${id}#roster`);
}
