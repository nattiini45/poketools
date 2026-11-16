import { notFound } from 'next/navigation';
import { comparisonPokemon, superEffectiveStabs, type TeamComparisonData } from '@/lib/team-comparison';
import { I18nProvider } from '@/i18n/client';
import Preview from './preview';

export default async function TeamComparisonPreview({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { lang } = await searchParams;
  const mine = comparisonPokemon(['Charmeleon', 'Grovyle', 'Metang', 'Pikachu']);
  const theirs = comparisonPokemon(['Wartortle', 'Umbreon', 'Gligar', 'Heatran']);
  const data: TeamComparisonData = {
    leagueId: 'example-league',
    leagues: [
      { id: 'example-league', name: 'Example Cup', format_type: 'evolution_point_buy', start_date: '2026-11-01', created_at: '2026-10-01' },
      { id: 'earlier-league', name: 'Earlier Cup', format_type: 'standard', start_date: '2025-11-01', created_at: '2025-10-01' },
    ],
    mine: { hidden: false, pokemon: mine }, theirs: { hidden: false, pokemon: theirs },
    myHits: superEffectiveStabs(mine, theirs), theirHits: superEffectiveStabs(theirs, mine),
  };
  const locale = lang === 'de' ? 'de' : 'en';
  return <I18nProvider locale={locale} dataLocale={locale} timeZone="UTC" requestTime={0}><Preview data={data} /></I18nProvider>;
}
