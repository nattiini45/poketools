import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { makeSet } from '@/test/team-fixtures';
import { ltext } from '@/lib/studio-core/ltext';
import type { SessionPlayer } from '@/types/auth';
import type { RulesetDefinitionMeta } from '../library-types';

const q = vi.hoisted(() => ({
  loadMoveTargetsWithPhases: vi.fn(), listPhaseTeamsForPinImpact: vi.fn(), listTeamsForPinImpact: vi.fn(),
  listRulesetVersions: vi.fn(), getRulesetById: vi.fn(), listParticipantCores: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => ({ AuthError: class extends Error {} }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => q);
vi.mock('@/lib/supabase/queries/rulesets', () => q);
vi.mock('@/lib/supabase/queries/phase-teams', () => q);
vi.mock('@/lib/supabase/queries/teams', () => q);
vi.mock('@/lib/supabase/queries/seasons', () => q);
vi.mock('../phase-pins', () => q);

import { computePinImpactWithPhases } from '../phase-pin-impact.server';
import { MAX_IMPACT_TEAMS } from '../pin-impact.server';

const actor: SessionPlayer = {
  playerId: 'organizer', name: 'Organizer', isAdmin: true, isResourceAdmin: false, isCreator: false,
  psUsername: '', championsUsername: '', avatarUrl: null, status: 'active',
};
const definition: RulesetDefinitionMeta = {
  id: 'definition', slug: 'spring', name: ltext('en', 'Spring'), description: null, kind: 'custom',
  owner_id: 'organizer', visibility: 'gallery', season_id: null, forked_from: null,
  draft_rev: 1, current_version_id: 'v2', created_at: '', updated_at: '',
};
const state = { kind: 'phase', id: 'phase', name: 'Native phase', season_id: 'league', ruleset_id: 'v1', status: 'active', archived: false };
const input = { actor, definition, toVersionNo: 2, targets: [{ kind: 'phase' as const, id: 'phase' }] };

beforeEach(() => {
  vi.resetAllMocks();
  q.listRulesetVersions.mockResolvedValue([{ id: 'v1', version_no: 1 }, { id: 'v2', version_no: 2 }]);
  q.loadMoveTargetsWithPhases.mockResolvedValue([state]);
  q.getRulesetById.mockImplementation(async (id: string) => makeRuleset({ id,
    bans: { pokemon: id === 'v2' ? ['Garchomp'] : [], moves: [], items: [], abilities: [] },
  }));
  q.listPhaseTeamsForPinImpact.mockResolvedValue({ teams: [{ id: 'team', player_id: 'player', pokemon: [makeSet()] }], truncated: false });
  q.listTeamsForPinImpact.mockResolvedValue({ teams: [], truncated: false });
});

describe('native phase pin impact', () => {
  it('uses real differential validation on native teams, not legacy tournament rows', async () => {
    await expect(computePinImpactWithPhases(input)).resolves.toMatchObject({
      checked: 1, would_break: 1, malformed: 0, truncated: false,
      targets: [{ kind: 'phase', id: 'phase', checked: 1, would_break: 1 }],
    });
    expect(q.listPhaseTeamsForPinImpact).toHaveBeenCalledWith('phase', MAX_IMPACT_TEAMS);
    expect(q.listTeamsForPinImpact).not.toHaveBeenCalled();
  });

  it('shares the request budget with standalone targets without treating them as phases', async () => {
    q.loadMoveTargetsWithPhases.mockResolvedValue([state, { ...state, kind: 'tournament', id: 'event', season_id: null }]);
    await computePinImpactWithPhases({ ...input, targets: [...input.targets, { kind: 'tournament', id: 'event' }] });
    expect(q.listTeamsForPinImpact).toHaveBeenCalledWith({ kind: 'tournament', id: 'event' }, MAX_IMPACT_TEAMS - 1);
  });

  it('does not count malformed native rows as valid or broken and retains truncation', async () => {
    q.listPhaseTeamsForPinImpact.mockResolvedValue({ teams: [{ id: 'bad', player_id: 'player', pokemon: {} }], truncated: true });
    await expect(computePinImpactWithPhases(input)).resolves.toMatchObject({ checked: 0, would_break: 0, malformed: 1, truncated: true });
  });

  it('does no team read when the native phase already pins the requested version', async () => {
    q.loadMoveTargetsWithPhases.mockResolvedValue([{ ...state, ruleset_id: 'v2' }]);
    await expect(computePinImpactWithPhases(input)).resolves.toMatchObject({ checked: 0, would_break: 0 });
    expect(q.listPhaseTeamsForPinImpact).not.toHaveBeenCalled();
  });

  it('authorizes targets before reading team sets and propagates read failures', async () => {
    q.loadMoveTargetsWithPhases.mockRejectedValue(new Error('forbidden'));
    await expect(computePinImpactWithPhases(input)).rejects.toThrow('forbidden');
    expect(q.listPhaseTeamsForPinImpact).not.toHaveBeenCalled();
    q.loadMoveTargetsWithPhases.mockResolvedValue([state]);
    q.listPhaseTeamsForPinImpact.mockRejectedValue(new Error('teams unavailable'));
    await expect(computePinImpactWithPhases(input)).rejects.toThrow('teams unavailable');
  });
});
