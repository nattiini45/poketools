import Link from 'next/link';
import { publicReads } from '@/lib/cache/public-reads';
import PageContainer from '@/components/ui/PageContainer';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { leaguesMessages } from '@/i18n/messages/leagues';

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

export default async function LeaguesPage() {
  // The language is a cookie read, outside the cached list read (cached values hold no text).
  const [leagues, t, common, enums] = await Promise.all([
    publicReads.seasonList(),
    getT(leaguesMessages),
    getT(commonMessages),
    getT(enumMessages),
  ]);

  return (
    <PageContainer title={t('list.title')}>
      {leagues.length === 0 ? (
        <p className="text-poke-text-muted">{t('list.empty')}</p>
      ) : (
        <div className="grid gap-3 max-w-2xl">
          {leagues.map((league) => (
            <Link key={league.id} href={`/leagues/${league.id}`}>
              <Card hover padding="md">
                <h2 className="font-heading font-semibold text-poke-text-primary">{league.name}</h2>
                <div className="flex flex-wrap gap-2 mt-2 items-center text-xs text-poke-text-secondary">
                  <span>{enumLabel(enums, 'formatType', league.format_type)}</span>
                  {league.ruleset_name && <span>{league.ruleset_name}</span>}
                  <span>{common('units.players', { count: league.participant_count })}</span>
                  <span>{t('list.stages', { count: league.tournament_count })}</span>
                  <Badge variant={statusVariant[league.status] ?? 'gray'}>
                    {enumLabel(enums, 'seasonStatus', league.status)}
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
