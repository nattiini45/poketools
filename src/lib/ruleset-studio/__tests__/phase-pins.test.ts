import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { ltext } from '@/lib/studio-core/ltext';
import type { SessionPlayer } from '@/types/auth';
import type { PhasePinState } from '@/lib/supabase/queries/phase-ruleset-pins';
import type { RulesetDefinitionMeta } from '../library-types';

const q = vi.hoisted(() => ({
  getPhasePinStates: vi.fn(), listPhasePins: vi.fn(), repinPhaseTarget: vi.fn(), isVersionPhasePinned: vi.fn(),
  getRulesetVersion: vi.fn(), listRulesetVersions: vi.fn(), repinTarget: vi.fn(), isVersionPinned: vi.fn(),
  getPinTargetStates: vi.fn(), listPinnedTargets: vi.fn(), isPhaseAdminFor: vi.fn(), isResourceAdminFor: vi.fn(),
  getDefinitionOfVersion: vi.fn(), getRulesetById: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => ({ AuthError: class extends Error {} }));
vi.mock('@/lib/supabase/queries/phase-admins', () => q);
vi.mock('@/lib/supabase/queries/resource-admins', () => q);
vi.mock('@/lib/supabase/queries/phase-ruleset-pins', () => q);
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => q);
vi.mock('@/lib/supabase/queries/rulesets', () => q);

import { listUsageWithPhases, loadMoveTargetsWithPhases, movePinsWithPhases, readExposedRulesetWithPhases } from '../phase-pins';

const player: SessionPlayer = {
  playerId: 'organizer', name: 'Organizer', isAdmin: false, isResourceAdmin: false,
  isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active',
};
const definition: RulesetDefinitionMeta = {
  id: 'definition', slug: 'spring', name: ltext('en', 'Spring'), description: null, kind: 'custom',
  owner_id: 'organizer', visibility: 'gallery', season_id: null, forked_from: null, draft_rev: 1,
  current_version_id: 'v2', created_at: '', updated_at: '',
};
const state: PhasePinState = {
  kind: 'phase', id: 'phase', season_id: 'league', name: 'Native phase', status: 'upcoming',
  ruleset_id: 'v1', archived: false,
};
const versions = [{ id: 'v1', version_no: 1 }, { id: 'v2', version_no: 2 }];
const input = {
  actor: player, definition, toVersionNo: 2, targets: [{ kind: 'phase' as const, id: 'phase' }], confirmStarted: [] as string[],
};

beforeEach(() => {
  vi.resetAllMocks();
  q.getPhasePinStates.mockResolvedValue([state]);
  q.getPinTargetStates.mockResolvedValue([]);
  q.isPhaseAdminFor.mockResolvedValue(true);
  q.listRulesetVersions.mockResolvedValue(versions);
  q.getRulesetVersion.mockImplementation(async (_definition: string, no: number) => ({
    id: `v${no}`, version_no: no, resolved: makeRuleset({ bans: { pokemon: no === 2 ? ['Garchomp'] : [], moves: [], items: [], abilities: [] } }).rules,
  }));
  q.repinPhaseTarget.mockResolvedValue(true);
  q.listPinnedTargets.mockResolvedValue({ seasons: [], tournaments: [] });
  q.listPhasePins.mockResolvedValue([state]);
});

describe('native phase ruleset pins', () => {
  it('moves the actual phase with the shared differential and per-move audit callback', async () => {
    const onMoved = vi.fn();
    const result = await movePinsWithPhases({ ...input, onMoved });
    expect(result.moved).toEqual([expect.objectContaining({ kind: 'phase', id: state.id, season_id: state.season_id })]);
    expect(result.moved[0].difference?.pokemon.added).toContain('garchomp');
    expect(q.repinPhaseTarget).toHaveBeenCalledWith(state, 'v2');
    expect(q.repinTarget).not.toHaveBeenCalled();
    expect(onMoved).toHaveBeenCalledWith(result.moved[0], { version_id: 'v2', version_no: 2 });
  });

  it('requires a started-phase confirmation before any write', async () => {
    q.getPhasePinStates.mockResolvedValue([{ ...state, status: 'active' }]);
    await expect(movePinsWithPhases(input)).rejects.toMatchObject({ code: 'ruleset_pin_confirm_required' });
    expect(q.repinPhaseTarget).not.toHaveBeenCalled();
    await expect(movePinsWithPhases({ ...input, confirmStarted: ['phase'] })).resolves.toMatchObject({ moved: [{ started: true }] });
  });

  it.each([{ status: 'completed' }, { archived: true }])('locks finished and archived native targets: %s', async (override) => {
    q.getPhasePinStates.mockResolvedValue([{ ...state, ...override }]);
    await expect(movePinsWithPhases({ ...input, confirmStarted: ['phase'] })).rejects.toMatchObject({ code: 'ruleset_pin_locked' });
    expect(q.repinPhaseTarget).not.toHaveBeenCalled();
  });

  it('refuses a foreign ruleset, missing phase or unrelated administrator', async () => {
    q.getPhasePinStates.mockResolvedValue([{ ...state, ruleset_id: 'foreign' }]);
    await expect(movePinsWithPhases(input)).rejects.toMatchObject({ code: 'ruleset_pin_mismatch' });
    q.getPhasePinStates.mockResolvedValue([]);
    await expect(movePinsWithPhases(input)).rejects.toMatchObject({ code: 'ruleset_not_found' });
    q.getPhasePinStates.mockResolvedValue([state]);
    q.isPhaseAdminFor.mockResolvedValue(false);
    await expect(movePinsWithPhases(input)).rejects.toThrow('Admin access required for this league or phase');
    expect(q.repinPhaseTarget).not.toHaveBeenCalled();
  });

  it('reports a lost compare-and-set and never audits a refused write', async () => {
    const onMoved = vi.fn();
    q.repinPhaseTarget.mockResolvedValue(false);
    await expect(movePinsWithPhases({ ...input, onMoved })).rejects.toMatchObject({ code: 'ruleset_pin_moved' });
    expect(onMoved).not.toHaveBeenCalled();
  });

  it('resolves the audit difference before committing a move', async () => {
    q.getRulesetVersion.mockImplementation(async (_definition: string, no: number) => {
      if (no === 1) throw new Error('source rules unavailable');
      return { id: 'v2', version_no: 2, resolved: makeRuleset().rules };
    });
    await expect(movePinsWithPhases(input)).rejects.toThrow('source rules unavailable');
    expect(q.repinPhaseTarget).not.toHaveBeenCalled();
  });

  it('allows site admins without native role reads and fails closed on role lookup errors', async () => {
    await loadMoveTargetsWithPhases({ ...player, isAdmin: true }, input.targets, versions);
    expect(q.isPhaseAdminFor).not.toHaveBeenCalled();
    q.isPhaseAdminFor.mockRejectedValue(new Error('roles failed'));
    await expect(loadMoveTargetsWithPhases(player, input.targets, versions)).rejects.toThrow('roles failed');
  });

  it('counts native pins without disclosing league/phase names to a gallery ruleset owner', async () => {
    const result = await listUsageWithPhases(player, definition);
    expect(result).toEqual({ counts: [{ version_no: 1, seasons: 0, tournaments: 0, phases: 1 }], targets: null });
    const administered = await listUsageWithPhases({ ...player, leagueIds: new Set(['league']) }, definition);
    expect(administered.targets).toEqual([expect.objectContaining({ kind: 'phase', name: state.name })]);
  });

  it('exposes a private version only when actually pinned, never merely because its id is known', async () => {
    q.getDefinitionOfVersion.mockResolvedValue({ definition: { ...definition, visibility: 'private' } });
    q.isVersionPinned.mockResolvedValue(false);
    q.isVersionPhasePinned.mockResolvedValue(false);
    await expect(readExposedRulesetWithPhases('v1')).resolves.toBeNull();
    expect(q.getRulesetById).not.toHaveBeenCalled();
    q.isVersionPhasePinned.mockResolvedValue(true);
    const ruleset = makeRuleset();
    q.getRulesetById.mockResolvedValue(ruleset);
    await expect(readExposedRulesetWithPhases('v1')).resolves.toEqual(ruleset);
  });
});
