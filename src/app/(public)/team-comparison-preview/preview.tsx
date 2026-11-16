'use client';

import { ComparePlayerButton, TeamComparisonProvider, type ComparisonSource } from '@/components/team-comparison/TeamComparisonDialog';
import UpcomingOrderStrip from '@/components/draft-tool/layout/UpcomingOrderStrip';
import { useT } from '@/i18n/client';
import { teamComparisonMessages } from '@/i18n/messages/team-comparison';
import type { TeamComparisonData } from '@/lib/team-comparison';

export default function Preview({ data }: { data: TeamComparisonData }) {
  const t = useT(teamComparisonMessages);
  const dataSource: ComparisonSource = async (_playerId, leagueId) => leagueId === 'earlier-league' ? {
    ...data, leagueId, theirs: { hidden: true, pokemon: [] }, myHits: [], theirHits: [],
  } : data;
  return <main className="mx-auto max-w-5xl space-y-8 p-4 sm:p-8">
    <h1 className="font-heading text-3xl font-bold">{t('title')}</h1>
    <TeamComparisonProvider dataSource={dataSource} seasonId="example-league">
      <UpcomingOrderStrip activeSlot={null} items={[
        { slotId: 'one', playerId: 'opponent', name: 'Maple', pickNumber: 2, round: 1, kind: 'normal', isViewer: false, roundBreakBefore: false },
      ]} />
    </TeamComparisonProvider>
    <ComparePlayerButton playerId="opponent" name="Maple" dataSource={dataSource} />
  </main>;
}
