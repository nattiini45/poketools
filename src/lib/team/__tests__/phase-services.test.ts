import { beforeEach, describe, expect, it, vi } from 'vitest';
import { phaseTeam } from './phase-team-fixture';

vi.mock('@/lib/supabase/queries/phase-teams', () => ({
  getPhaseTeamById: vi.fn(), listPhaseTeams: vi.fn(), getPlannedPhaseTeam: vi.fn(),
  getPlayerPhaseTeamForMatch: vi.fn(), getPhaseMatchPrepTeams: vi.fn(), createPhaseTeam: vi.fn(),
  writePhaseTeam: vi.fn(), setPhaseTeamShareToken: vi.fn(), disablePhaseTeamShareToken: vi.fn(),
  publishPhaseTeam: vi.fn(), unpublishPhaseTeam: vi.fn(), forkPhaseTeamToLibrary: vi.fn(),
  listPhaseLibraryTeams: vi.fn(),
  releasePhaseTeamsFromMatches: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: vi.fn() }));
vi.mock('../phase-visibility', () => ({ checkPhaseTeamForkAccess: vi.fn() }));

import * as storage from '@/lib/supabase/queries/phase-teams';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { checkPhaseTeamForkAccess } from '../phase-visibility';
import { createPhaseTeamServices } from '../phase-services';

const services = createPhaseTeamServices();
const owner = { playerId: 'owner', isAdmin: false };
const admin = { playerId: 'admin', isAdmin: true };
const form = { pokemon: [], import_source: 'manual' as const };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(storage.getPhaseTeamById).mockResolvedValue(phaseTeam());
  vi.mocked(storage.writePhaseTeam).mockResolvedValue(phaseTeam());
  vi.mocked(getPhaseById).mockResolvedValue({ status: 'active', archived: false, season_id: 'season' } as Awaited<ReturnType<typeof getPhaseById>>);
  vi.mocked(getSeasonById).mockResolvedValue({ status: 'active', archived: false } as Awaited<ReturnType<typeof getSeasonById>>);
  vi.mocked(getPhaseMatchById).mockResolvedValue({ id: 'match', phase_id: 'phase', status: 'scheduled', player_1_id: 'owner', player_2_id: 'other' } as Awaited<ReturnType<typeof getPhaseMatchById>>);
});

describe('explicit native phase team services', () => {
  it('construction performs no reads and creation keeps phase identity', async () => {
    createPhaseTeamServices();
    expect(storage.getPhaseTeamById).not.toHaveBeenCalled();
    await services.create(owner, { ...form, phase_id: 'phase' });
    expect(storage.createPhaseTeam).toHaveBeenCalledWith('owner', { ...form, phase_id: 'phase' }, 'owner');
  });

  it('refuses other players before any write or context reads', async () => {
    await expect(services.edit({ playerId: 'other', isAdmin: false }, 'id', form)).rejects.toMatchObject({ code: 'team_not_owner' });
    expect(storage.writePhaseTeam).not.toHaveBeenCalled();
    expect(getPhaseById).not.toHaveBeenCalled();
  });

  it('distinguishes missing team and missing fork source from a concurrent write', async () => {
    vi.mocked(storage.getPhaseTeamById).mockResolvedValue(null);
    await expect(services.edit(owner, 'missing', form)).rejects.toMatchObject({ code: 'team_not_found', statusCode: 404 });
    await expect(services.fork(owner, 'missing')).rejects.toMatchObject({ code: 'team_fork_source_not_found', statusCode: 404 });
  });

  it.each([
    ['completed', false, 'team_submission_closed'], ['active', true, 'team_submission_tournament_archived'],
  ])('preserves the %s/%s closure', async (status, archived, code) => {
    vi.mocked(getPhaseById).mockResolvedValue({ status, archived, season_id: 'season' } as Awaited<ReturnType<typeof getPhaseById>>);
    await expect(services.edit(owner, 'id', form)).rejects.toMatchObject({ code });
    await services.delete(owner, 'id');
    expect(storage.writePhaseTeam).toHaveBeenCalledWith(expect.objectContaining({ p_operation: 'delete' }));
  });

  it('preserves league closure and does not hide failed context reads', async () => {
    vi.mocked(getSeasonById).mockResolvedValue({ status: 'completed' } as Awaited<ReturnType<typeof getSeasonById>>);
    await expect(services.edit(owner, 'id', form)).rejects.toMatchObject({ code: 'team_submission_league_closed' });
    const error = new Error('context read failed');
    vi.mocked(getPhaseById).mockRejectedValue(error);
    await expect(services.edit(owner, 'id', form)).rejects.toBe(error);
  });

  it('protects completed match rosters, but keeps the admin correction actor', async () => {
    vi.mocked(storage.getPhaseTeamById).mockResolvedValue(phaseTeam({ match_id: 'match' }));
    vi.mocked(getPhaseMatchById).mockResolvedValue({ status: 'completed' } as Awaited<ReturnType<typeof getPhaseMatchById>>);
    await expect(services.edit(owner, 'id', form)).rejects.toMatchObject({ code: 'team_match_completed' });
    await expect(services.delete(owner, 'id')).rejects.toMatchObject({ code: 'team_match_completed' });
    await services.edit(admin, 'id', form);
    expect(storage.writePhaseTeam).toHaveBeenLastCalledWith(expect.objectContaining({ p_actor: 'admin', p_phase_id: phaseTeam().phase_id }));
  });

  it('manual locks still refuse admin edits and allow admin deletes', async () => {
    vi.mocked(storage.getPhaseTeamById).mockResolvedValue(phaseTeam({ locked: true }));
    await expect(services.edit(admin, 'id', form)).rejects.toMatchObject({ code: 'team_locked' });
    await services.delete(admin, 'id');
  });

  it('saves prep with participant identity, not a tournament or a phase supplied by the caller', async () => {
    vi.mocked(storage.getPhaseMatchPrepTeams).mockResolvedValue([{
      id: 'prep', match_id: 'match', player_id: 'owner', pokemon: [], import_source: 'manual',
      created_at: '2026-11-17T00:00:00Z', updated_at: '2026-11-17T00:00:00Z',
    }]);
    await services.saveMatchPrep(owner, 'match', form);
    expect(storage.writePhaseTeam).toHaveBeenCalledWith(expect.objectContaining({ p_operation: 'match_prep', p_actor: 'participant', p_phase_id: 'phase', p_match_id: 'match' }));
    expect(getPhaseById).not.toHaveBeenCalled();
    await expect(services.saveMatchPrep(owner, 'match', form, 'other')).rejects.toMatchObject({ code: 'match_prep_target_not_participant' });
  });

  it('share and library metadata are owner-authorized but not roster-locked', async () => {
    vi.mocked(storage.getPhaseTeamById).mockResolvedValue(phaseTeam({ locked: true }));
    await services.share(owner, 'id');
    await services.unshare(owner, 'id');
    await services.publish(owner, 'id', { title: 'Fixture' });
    await services.unpublish(owner, 'id');
    expect(storage.setPhaseTeamShareToken).toHaveBeenCalledWith('id', 'owner');
    expect(storage.publishPhaseTeam).toHaveBeenCalledWith(expect.objectContaining({ locked: true }), { title: 'Fixture' }, 'owner');
    expect(getPhaseById).not.toHaveBeenCalled();
  });

  it('forks only authorized public/share sources into personal library storage', async () => {
    vi.mocked(checkPhaseTeamForkAccess).mockResolvedValue('source_private');
    await expect(services.fork(owner, 'id')).rejects.toMatchObject({ code: 'team_fork_source_private' });
    expect(storage.forkPhaseTeamToLibrary).not.toHaveBeenCalled();
    vi.mocked(checkPhaseTeamForkAccess).mockResolvedValue('allowed');
    await services.fork(owner, 'id', 'token');
    expect(storage.forkPhaseTeamToLibrary).toHaveBeenCalledWith(phaseTeam(), 'owner');
  });

  it('supplies both P3 release signatures and propagates an atomic release failure', async () => {
    vi.mocked(storage.releasePhaseTeamsFromMatches).mockResolvedValue(3);
    expect(await services.clearTeamsMatchPointer('match')).toBe(3);
    expect(await services.releaseTeams('match')).toBeUndefined();
    expect(await services.releaseTeamsFromMatches(['one', 'two'])).toBeUndefined();
    expect(storage.releasePhaseTeamsFromMatches).toHaveBeenLastCalledWith(['one', 'two']);
    const error = new Error('transfer failed');
    vi.mocked(storage.releasePhaseTeamsFromMatches).mockRejectedValue(error);
    await expect(services.releaseTeams('match')).rejects.toBe(error);
  });
});
