/**
 * Tournament teambuilder page in phase mode: the id names a competition, and the transfer keeps ids, so a phase id
 * opens the phase's own rules pin and the player's team for it (their planned row, else their latest registration).
 * A standalone tournament keeps exactly today's page. The page runs for real with its reads mocked.
 */
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const PHASE_ID = '7c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5';
const SEASON_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const TEAM_ID = '2b3c4d5e-6f70-4b8c-9d0e-1f2a3b4c5d6e';
const PLAYER_ID = '3c4d5e6f-7081-4c9d-8e0f-2a3b4c5d6e7f';

const mocks = vi.hoisted(() => ({
  mode: 'phase' as string,
  player: null as unknown,
  owner: null as unknown,
  phase: null as unknown,
  team: null as unknown,
  clientProps: [] as Record<string, unknown>[],
  findNativePhaseAliasOwner: vi.fn(),
  findLegacyPhaseAliasOwner: vi.fn(),
  standaloneTournamentAliasExists: vi.fn(),
  getPhaseById: vi.fn(),
  getPlayerPhaseTeamForPhase: vi.fn(),
  getTournamentById: vi.fn(),
  getPlayerTeamForTournament: vi.fn(),
  getPhaseMatchById: vi.fn(),
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
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: vi.fn(async () => ({ player: mocks.player })) }));
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: vi.fn(async () => mocks.mode) }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  findNativePhaseAliasOwner: () => mocks.findNativePhaseAliasOwner(),
  findLegacyPhaseAliasOwner: () => mocks.findLegacyPhaseAliasOwner(),
  standaloneTournamentAliasExists: () => mocks.standaloneTournamentAliasExists(),
}));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: () => mocks.getPhaseById() }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: () => mocks.getPhaseMatchById() }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({
  getPlayerPhaseTeamForPhase: () => mocks.getPlayerPhaseTeamForPhase(),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: () => mocks.getTournamentById() }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(async () => ({ id: 'ruleset-1', name: 'League rules', base_format: 'gen9ou', gen: 9 })),
}));
vi.mock('@/lib/supabase/queries/teams', () => ({ getPlayerTeamForTournament: () => mocks.getPlayerTeamForTournament() }));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolBySeason: vi.fn(async () => null),
  getDraftPoolBySeasonGroup: vi.fn(async () => null),
  GroupedLeaguePoolLookupError: class GroupedLeaguePoolLookupError extends Error {},
}));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroupOfPlayer: vi.fn(async () => null) }));

import TournamentTeambuilderPage from '../page';

async function render(tid = PHASE_ID): Promise<Record<string, unknown>> {
  renderToStaticMarkup(await TournamentTeambuilderPage({ params: Promise.resolve({ tid }) }));
  const props = mocks.clientProps.at(-1);
  if (!props) throw new Error('the client was not rendered');
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clientProps = [];
  mocks.mode = 'phase';
  mocks.player = { playerId: PLAYER_ID, name: 'P', isAdmin: false, isResourceAdmin: false, isCreator: false, status: 'active' };
  mocks.owner = { kind: 'phase', phase_id: PHASE_ID, season_id: SEASON_ID };
  mocks.phase = { id: PHASE_ID, season_id: SEASON_ID, ruleset_id: 'ruleset-1', status: 'active', archived: false };
  mocks.team = { id: TEAM_ID, phase_id: PHASE_ID, name: 'League rain', pokemon: [{ species: 'Pelipper' }], locked: false, match_id: null };
  mocks.findNativePhaseAliasOwner.mockImplementation(async () => mocks.owner);
  mocks.findLegacyPhaseAliasOwner.mockResolvedValue(null);
  mocks.standaloneTournamentAliasExists.mockResolvedValue(false);
  mocks.getPhaseById.mockImplementation(async () => mocks.phase);
  mocks.getPlayerPhaseTeamForPhase.mockImplementation(async () => mocks.team);
  mocks.getTournamentById.mockResolvedValue(null);
  mocks.getPlayerTeamForTournament.mockResolvedValue(null);
});

describe('tournament teambuilder page: a phase id', () => {
  it('opens the phase\'s pinned ruleset and the player\'s team for it, with no tournament id', async () => {
    expect((await render()).phaseId).toBe(PHASE_ID);
    const props = mocks.clientProps.at(-1);
    expect(props).toMatchObject({
      tournamentId: null,
      phaseId: PHASE_ID,
      seasonId: SEASON_ID,
      rulesetId: 'ruleset-1',
      baseFormat: 'gen9ou',
      teamId: TEAM_ID,
      initialPokemon: [{ species: 'Pelipper' }],
      teamName: 'League rain',
      matchId: null,
    });
    expect(mocks.getTournamentById).not.toHaveBeenCalled();
  });

  it('opens a roster registered for a completed match locked, as the dashboard team page does', async () => {
    mocks.team = { ...(mocks.team as object), match_id: 'b1000000-0000-4000-8000-000000000001' };
    mocks.getPhaseMatchById.mockResolvedValue({ id: 'b1000000-0000-4000-8000-000000000001', status: 'completed' });
    await render();
    expect(mocks.clientProps.at(-1)).toMatchObject({ locked: true, lockReason: 'completed_match' });

    mocks.getPhaseMatchById.mockResolvedValue({ id: 'b1000000-0000-4000-8000-000000000001', status: 'scheduled' });
    await render();
    expect(mocks.clientProps.at(-1)).toMatchObject({ locked: false, lockReason: 'tournament' });
  });

  it('opens an empty editor when the player has no team for the phase yet, still bound to the phase', async () => {
    mocks.team = null;
    await render();
    const props = mocks.clientProps.at(-1);
    expect(props).toMatchObject({ phaseId: PHASE_ID, tournamentId: null, seasonId: SEASON_ID });
    expect(props?.teamId).toBeUndefined();
  });

  it('answers notFound for an id that names neither a phase nor a standalone tournament', async () => {
    mocks.owner = null;
    mocks.standaloneTournamentAliasExists.mockResolvedValue(false);
    await expect(render()).rejects.toThrow('NOT_FOUND');
    expect(mocks.clientProps).toHaveLength(0);
  });

  it('keeps the legacy page for a standalone tournament id, reading no phase team', async () => {
    mocks.mode = 'legacy';
    mocks.getTournamentById.mockResolvedValue({ id: PHASE_ID, season_id: null, ruleset_id: 'ruleset-1' });
    mocks.getPlayerTeamForTournament.mockResolvedValue({ id: TEAM_ID, name: 'Rain', pokemon: [], locked: false });
    await render();
    expect(mocks.clientProps.at(-1)).toMatchObject({ tournamentId: PHASE_ID, teamId: TEAM_ID });
    expect(mocks.getPlayerPhaseTeamForPhase).not.toHaveBeenCalled();
    expect(mocks.findNativePhaseAliasOwner).not.toHaveBeenCalled();
  });

  it('refuses to read either store while the storage is frozen mid-transfer', async () => {
    mocks.mode = 'frozen_phase';
    mocks.findLegacyPhaseAliasOwner.mockResolvedValue({ tournament_id: PHASE_ID, season_id: SEASON_ID });
    await expect(render()).rejects.toMatchObject({ code: 'phase_storage_unavailable' });
    expect(mocks.getTournamentById).not.toHaveBeenCalled();
  });
});
