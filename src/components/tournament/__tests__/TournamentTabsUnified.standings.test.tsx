/**
 * The round robin table of the tournament page: Evolution Point Buy phases score the format pack's match points and
 * rank by the season's stored tiebreaker order; every other league type keeps 3 points a win and 0 a draw.
 * Only the standings handed to the table are asserted; everything around it is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const shown = vi.hoisted(() => ({ standings: [] as { player_id: string; points: number }[] }));

vi.mock('next/link', () => ({ default: () => null }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));
vi.mock('@/components/world/WorldNav', () => ({ default: () => null }));
vi.mock('@/components/world/SectionShell', () => ({ default: () => null }));
vi.mock('@/components/bracket/RoundRobinTable', () => ({ default: () => null }));
vi.mock('@/components/bracket/GroupStandingsTable', () => ({
  default: (props: { standings: { player_id: string; points: number }[] }) => {
    shown.standings = props.standings;
    return null;
  },
}));
vi.mock('@/components/evolution/DecisionMatchPanel', () => ({ default: () => null }));
vi.mock('@/components/insights/ScopedInsightsView', () => ({ default: () => null }));
vi.mock('../TournamentReportTab', () => ({ default: () => null }));

import TournamentTabsUnified from '../TournamentTabsUnified';
import { epbPack } from '@/lib/format-pack';
import type { MatchRecord } from '@/lib/tournament/types';
import type { TiebreakerStep } from '@/types/format-rules';

const PARTICIPANTS = ['ash', 'misty', 'brock'].map((id) => ({ id, name: id, avatar_url: null, gym_type: null }));
// ash beat brock, misty drew brock.
const RECORDS: MatchRecord[] = [
  { player_1_id: 'ash', player_2_id: 'brock', winner_id: 'ash', round_number: 1 },
  { player_1_id: 'misty', player_2_id: 'brock', winner_id: null, round_number: 2 },
];

function render(props: { seasonFormatType: string | null; tiebreakerOrder?: TiebreakerStep[] }) {
  shown.standings = [];
  renderToStaticMarkup(
    <TournamentTabsUnified
      bracketType="round_robin"
      participants={PARTICIPANTS}
      rounds={[]}
      matches={[]}
      matchRecords={RECORDS}
      matchesByRound={{}}
      battleStats={[]}
      tournamentId="t-1"
      totalRounds={2}
      reports={[]}
      usageRows={[]}
      killRanking={[]}
      isDoubles={false}
      evolutionPoints={{ ash: 0, misty: 7, brock: 20 }}
      {...props}
    />,
  );
  return shown.standings;
}

beforeEach(() => {
  shown.standings = [];
});

describe('TournamentTabsUnified round robin standings', () => {
  it('an Evolution Point Buy phase scores the pack match points, not a hard-coded 3 / 0', () => {
    const points = Object.fromEntries(render({ seasonFormatType: 'evolution_point_buy' }).map((s) => [s.player_id, s.points]));

    expect(points).toEqual({
      ash: epbPack.matchPoints.win,
      misty: epbPack.matchPoints.draw,
      brock: epbPack.matchPoints.draw,
    });
  });

  it('an Evolution Point Buy phase ranks by the stored tiebreaker order', () => {
    expect(render({ seasonFormatType: 'evolution_point_buy' }).map((s) => s.player_id)).toEqual(['ash', 'brock', 'misty']);
    expect(
      render({ seasonFormatType: 'evolution_point_buy', tiebreakerOrder: ['evolution_points', 'match_points'] }).map(
        (s) => s.player_id,
      ),
    ).toEqual(['brock', 'misty', 'ash']);
  });

  it.each(['singles', 'doubles', 'draft', null])('%s keeps 3 points a win and 0 a draw', (seasonFormatType) => {
    const points = Object.fromEntries(render({ seasonFormatType }).map((s) => [s.player_id, s.points]));

    expect(points).toEqual({ ash: 3, misty: 0, brock: 0 });
  });
});
