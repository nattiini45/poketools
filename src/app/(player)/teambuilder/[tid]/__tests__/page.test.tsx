/**
 * Tournament team builder page: `isDraftLeague` comes from the viewer's initial draft pool
 * (`getInitialPoolForPlayer`). A league without groups reads the season's pool exactly as before; a league with
 * groups reads the viewer's own group's initial pool, and a viewer in no group has none. The page runs for real with
 * its reads mocked; the client is stubbed to record what it receives.
 */
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const TOURNAMENT_ID = '7c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5';
const SEASON_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const PLAYER_ID = '2b3c4d5e-6f70-4b8c-9d0e-1f2a3b4c5d6e';
const GROUP_ID = '3c4d5e6f-7081-4c9d-8e0f-2a3b4c5d6e7f';

const mocks = vi.hoisted(() => ({
  player: null as unknown,
  clientProps: [] as Record<string, unknown>[],
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/components/shared/AuthGuard', () => ({
  default: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
}));
vi.mock('@/components/teambuilder/TeambuilderClient', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.clientProps.push(props);
    return createElement('div', { 'data-testid': 'editor' });
  },
}));
vi.mock('@/lib/auth/helpers', () => ({ getSessionPlayer: vi.fn(async () => mocks.player) }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ resolveEffectiveRuleset: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/queries/teams', () => ({ getPlayerTeamForTournament: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolBySeason: vi.fn(),
  getDraftPoolBySeasonGroup: vi.fn(),
  GroupedLeaguePoolLookupError: class GroupedLeaguePoolLookupError extends Error {},
}));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroupOfPlayer: vi.fn() }));
vi.mock('server-only', () => ({}));

import TournamentTeambuilderPage from '../page';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import {
  getDraftPoolBySeason,
  getDraftPoolBySeasonGroup,
  GroupedLeaguePoolLookupError,
} from '@/lib/supabase/queries/drafts';
import { getSeasonGroupOfPlayer } from '@/lib/supabase/queries/season-groups';

const POOL = { id: 'pool-1', season_id: SEASON_ID } as never;

async function render(): Promise<Record<string, unknown>> {
  const element = await TournamentTeambuilderPage({ params: Promise.resolve({ tid: TOURNAMENT_ID }) });
  renderToStaticMarkup(element);
  const props = mocks.clientProps.at(-1);
  if (!props) throw new Error('the client was not rendered');
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clientProps = [];
  mocks.player = { playerId: PLAYER_ID };
  vi.mocked(getTournamentById).mockResolvedValue({
    id: TOURNAMENT_ID,
    season_id: SEASON_ID,
    ruleset_id: null,
    bracket_type: 'swiss',
  } as never);
});

describe('teambuilder page: the viewer draft pool (isDraftLeague)', () => {
  it('a league without groups: the season pool, no group read', async () => {
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(POOL);
    const props = await render();
    expect(props.isDraftLeague).toBe(true);
    expect(getDraftPoolBySeason).toHaveBeenCalledWith(SEASON_ID);
    expect(getSeasonGroupOfPlayer).not.toHaveBeenCalled();
    expect(getDraftPoolBySeasonGroup).not.toHaveBeenCalled();
  });

  it('a league without groups and no pool: not a draft league', async () => {
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);
    expect((await render()).isDraftLeague).toBe(false);
  });

  it("a league with groups: the viewer's own group's initial pool", async () => {
    vi.mocked(getDraftPoolBySeason).mockRejectedValue(new GroupedLeaguePoolLookupError(SEASON_ID));
    vi.mocked(getSeasonGroupOfPlayer).mockResolvedValue({ id: GROUP_ID } as never);
    vi.mocked(getDraftPoolBySeasonGroup).mockResolvedValue(POOL);
    const props = await render();
    expect(props.isDraftLeague).toBe(true);
    expect(getSeasonGroupOfPlayer).toHaveBeenCalledWith(SEASON_ID, PLAYER_ID);
    expect(getDraftPoolBySeasonGroup).toHaveBeenCalledWith(SEASON_ID, GROUP_ID, 'initial');
  });

  it('a league with groups, viewer in no group: no pool', async () => {
    vi.mocked(getDraftPoolBySeason).mockRejectedValue(new GroupedLeaguePoolLookupError(SEASON_ID));
    vi.mocked(getSeasonGroupOfPlayer).mockResolvedValue(null);
    const props = await render();
    expect(props.isDraftLeague).toBe(false);
    expect(getDraftPoolBySeasonGroup).not.toHaveBeenCalled();
  });

  it('a league with groups, signed out: no pool and no group read', async () => {
    mocks.player = null;
    vi.mocked(getDraftPoolBySeason).mockRejectedValue(new GroupedLeaguePoolLookupError(SEASON_ID));
    const props = await render();
    expect(props.isDraftLeague).toBe(false);
    expect(getSeasonGroupOfPlayer).not.toHaveBeenCalled();
  });

  it('any other pool read error propagates (no fail-open)', async () => {
    const failure = new Error('db down');
    vi.mocked(getDraftPoolBySeason).mockRejectedValue(failure);
    await expect(render()).rejects.toBe(failure);
  });
});
