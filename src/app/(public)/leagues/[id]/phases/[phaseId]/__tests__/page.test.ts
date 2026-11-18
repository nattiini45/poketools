import { beforeEach, expect, it, vi } from 'vitest';
import LeaguePhasePage from '../page';
import LeaguePhaseStatsPage, { generateMetadata } from '../stats/page';

const h = vi.hoisted(() => ({
  read: vi.fn(), render: vi.fn(), metadata: vi.fn(), notFound: vi.fn(() => { throw Error('not found'); }),
}));
vi.mock('@/lib/seo/page-reads', () => ({ readLeaguePhase: h.read }));
vi.mock('@/lib/seo/page-metadata', () => ({ phaseMetadata: h.metadata }));
vi.mock('@/components/tournament/CompetitionDetailPage', () => ({ renderCompetitionDetail: h.render }));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));

const entry = { kind: 'phase', phase: { id: 'phase', season_id: 'league' } };
const query = { tab: 'rounds', filter: ['a', 'b'] };
const params = Promise.resolve({ id: 'league', phaseId: 'phase' });
const searchParams = Promise.resolve(query);

beforeEach(() => {
  vi.clearAllMocks();
  h.read.mockResolvedValue(entry);
});

it('passes native phase identity through to the common renderer', async () => {
  await LeaguePhasePage({ params, searchParams });
  expect(h.read).toHaveBeenCalledExactlyOnceWith('league', 'phase');
  expect(h.render).toHaveBeenCalledExactlyOnceWith(entry, query);
});

it('keeps the stats view canonical while using the same ownership and render path', async () => {
  await LeaguePhaseStatsPage({ params, searchParams });
  expect(h.render).toHaveBeenCalledExactlyOnceWith(entry, query, 'stats');
  await generateMetadata({ params });
  expect(h.metadata).toHaveBeenCalledExactlyOnceWith('league', 'phase', 'stats');
});

it('passes a real legacy phase through without rewriting it into a native identity', async () => {
  const legacy = { kind: 'legacy-phase', tournament: { id: 'phase', season_id: 'league' } };
  h.read.mockResolvedValueOnce(legacy);
  await LeaguePhasePage({ params, searchParams });
  expect(h.render).toHaveBeenCalledExactlyOnceWith(legacy, query);
});

it('does not render a missing or wrong-league phase', async () => {
  h.read.mockResolvedValueOnce(null);
  await expect(LeaguePhasePage({ params, searchParams })).rejects.toThrow('not found');
  expect(h.render).not.toHaveBeenCalled();
});
