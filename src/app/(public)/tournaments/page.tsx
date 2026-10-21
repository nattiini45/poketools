import Link from 'next/link';
import { publicReads } from '@/lib/cache/public-reads';
import PageContainer from '@/components/ui/PageContainer';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { tournamentsMessages } from '@/i18n/messages/tournaments';

// Stays dynamic although it reads no session: without `force-dynamic` the
// page would be prerendered by `next build`, which queries Supabase at build
// time (CI builds against a placeholder URL and would fail). The list itself
// comes from the tagged public read cache (60 s, expired by match writes), so
// a render costs no Supabase query while the entry is warm.
export const dynamic = 'force-dynamic';

const statusVariant: Record<string, 'green' | 'accent' | 'gray'> = {
  active: 'green',
  upcoming: 'accent',
  completed: 'gray',
};

export default async function TournamentsPage() {
  const [tournaments, t, tc, te] = await Promise.all([
    publicReads.tournamentList(),
    getT(tournamentsMessages),
    getT(commonMessages),
    getT(enumMessages),
  ]);

  return (
    <PageContainer title={t('list.title')}>
      {tournaments.length === 0 ? (
        <p className="text-poke-text-muted">{t('list.empty')}</p>
      ) : (
        <div className="grid gap-3 max-w-2xl">
          {tournaments.map((tournament) => (
            <Link key={tournament.id} href={`/tournaments/${tournament.id}`}>
              <Card hover padding="md">
                <h2 className="font-heading font-semibold text-poke-text-primary">{tournament.name}</h2>
                <div className="flex flex-wrap gap-2 mt-2 items-center text-xs text-poke-text-secondary">
                  <span>{enumLabel(te, 'bracketType', tournament.bracket_type)}</span>
                  <span>{tc('bestOf', { count: tournament.best_of_default })}</span>
                  {tournament.is_doubles && <Badge variant="purple">{t('list.doubles')}</Badge>}
                  <span>{tournament.ruleset_name}</span>
                  <span>{tc('units.players', { count: tournament.participant_count })}</span>
                  <Badge variant={statusVariant[tournament.status] ?? 'gray'}>
                    {enumLabel(te, 'tournamentStatus', tournament.status)}
                  </Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
