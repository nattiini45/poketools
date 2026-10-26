/**
 * What moving a pin does to the teams already submitted. The validator is the real one (real dex); the reads are mocked. A team
 * counts when it is valid under the version the target pins now and invalid under the version it would move to.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ltext } from '@/lib/format-kit';
import { makeRuleset } from '@/test/ruleset-fixtures';
import type { PokemonSet } from '@/types/team';
import type { SessionPlayer } from '@/types/auth';
import type { RulesetDefinitionMeta } from '../library-types';

vi.mock('@/lib/auth/helpers', () => ({
  AuthError: class AuthError extends Error {
    constructor(message: string, public statusCode: number, public code?: string) {
      super(message);
    }
  },
  requireAnyAdmin: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => ({
  getPinTargetStates: vi.fn(),
  getRulesetVersion: vi.fn(),
  listPinnedTargets: vi.fn(),
  listRulesetVersions: vi.fn(),
  listVersionIds: vi.fn(),
  repinTarget: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn() }));
vi.mock('@/lib/supabase/queries/teams', () => ({ listTeamsForPinImpact: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ listParticipantCores: vi.fn() }));

import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getPinTargetStates, listRulesetVersions, listVersionIds } from '@/lib/supabase/queries/ruleset-definitions';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { listParticipantCores } from '@/lib/supabase/queries/seasons';
import { listTeamsForPinImpact } from '@/lib/supabase/queries/teams';
import { MAX_IMPACT_TEAMS, computePinImpact, countBecomingInvalid } from '../pin-impact.server';

const OWNER = '11111111-1111-4111-8111-111111111111';
const DEF = '33333333-3333-4333-8333-333333333333';
const V1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const V2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const SEASON = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const PHASE = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const FOREIGN = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

const player = (overrides: Partial<SessionPlayer> = {}): SessionPlayer => ({
  playerId: OWNER, name: 'Admin', isAdmin: true, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active', ...overrides,
});

const definition: RulesetDefinitionMeta = {
  id: DEF, slug: 'spring', name: ltext('en', 'Spring'), description: null, kind: 'custom', owner_id: OWNER, visibility: 'gallery',
  season_id: null, forked_from: null, draft_rev: 1, current_version_id: V2, created_at: '', updated_at: '',
};

const set = (species: string, over: Partial<PokemonSet> = {}): PokemonSet => ({
  name: '', species, gender: '', item: 'Leftovers', ability: 'Rough Skin',
  evs: { hp: 252, atk: 4, def: 0, spa: 0, spd: 0, spe: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: 'Jolly', level: 100, moves: ['Earthquake', 'Dragon Claw', 'Swords Dance', 'Scale Shot'], ...over,
});
const GARCHOMP = set('Garchomp');
const DRAGONITE = set('Dragonite', { ability: 'Multiscale', moves: ['Extreme Speed', 'Dragon Dance', 'Earthquake', 'Fire Punch'] });

// Version 1 allows everything; version 2 bans Garchomp.
const RULES_V1 = makeRuleset({ id: V1, name: 'Spring' });
const RULES_V2 = makeRuleset({ id: V2, name: 'Spring', bans: { pokemon: ['Garchomp'], moves: [], items: [], abilities: [] } });

const team = (id: string, ...pokemon: PokemonSet[]) => ({ id, player_id: `player-${id}`, pokemon });
const state = (kind: 'season' | 'tournament', id: string, status = 'active', ruleset_id: string | null = V1) => ({
  kind, id, name: `${kind} ${id.slice(-1)}`, status, season_id: kind === 'tournament' ? SEASON : null, ruleset_id,
});
const input = (targets: Array<{ kind: 'season' | 'tournament'; id: string }>, extra: { actor?: SessionPlayer; toVersionNo?: number } = {}) => ({
  actor: extra.actor ?? player(), definition, toVersionNo: extra.toVersionNo ?? 2, targets,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listVersionIds).mockResolvedValue([V1, V2]);
  vi.mocked(listRulesetVersions).mockResolvedValue([{ id: V2, version_no: 2 }, { id: V1, version_no: 1 }] as never);
  vi.mocked(getRulesetById).mockImplementation(async (id) => (id === V1 ? RULES_V1 : id === V2 ? RULES_V2 : null));
  vi.mocked(isResourceAdminFor).mockResolvedValue(true);
  vi.mocked(listParticipantCores).mockResolvedValue(new Map());
});

describe('countBecomingInvalid', () => {
  const noCore = () => null;

  it('counts the teams that are valid under the old rules and invalid under the new ones', () => {
    const teams = [team('a', GARCHOMP), team('b', DRAGONITE), team('c', DRAGONITE, GARCHOMP)];
    expect(countBecomingInvalid(teams, RULES_V1, RULES_V2, noCore)).toBe(2);
  });

  it('does not count a team that is invalid already (it does not BECOME invalid), nor an empty one', () => {
    const tooLarge = Array.from({ length: 7 }, () => DRAGONITE);
    expect(countBecomingInvalid([team('big', ...tooLarge, GARCHOMP), team('none')], RULES_V1, RULES_V2, noCore)).toBe(0);
  });

  it('counts nothing when the two versions enforce the same, or when the new version is looser', () => {
    const teams = [team('a', GARCHOMP)];
    expect(countBecomingInvalid(teams, RULES_V1, RULES_V1, noCore)).toBe(0);
    expect(countBecomingInvalid(teams, RULES_V2, RULES_V1, noCore)).toBe(0);
  });

  it('hands each team its player assigned core to the validator', () => {
    const seen: string[] = [];
    countBecomingInvalid([team('a', GARCHOMP), team('b', DRAGONITE)], RULES_V1, RULES_V2, (playerId) => {
      seen.push(playerId);
      return null;
    });
    // Looked up for the old and the new check of each team.
    expect(seen).toEqual(['player-a', 'player-b']);
  });
});

describe('computePinImpact', () => {
  it('counts per target and in total, naming the targets, and compares the real version rules', async () => {
    vi.mocked(getPinTargetStates).mockResolvedValue([state('season', SEASON), state('tournament', PHASE)]);
    vi.mocked(listTeamsForPinImpact).mockImplementation(async (scope) =>
      scope.kind === 'season'
        ? { teams: [team('a', GARCHOMP), team('b', DRAGONITE)], truncated: false }
        : { teams: [team('c', GARCHOMP), team('d', GARCHOMP), team('e', DRAGONITE)], truncated: false },
    );

    const impact = await computePinImpact(input([{ kind: 'season', id: SEASON }, { kind: 'tournament', id: PHASE }]));

    expect(impact).toEqual({
      version_no: 2,
      checked: 5,
      would_break: 3,
      truncated: false,
      targets: [
        { kind: 'season', id: SEASON, name: 'season 1', checked: 2, would_break: 1 },
        { kind: 'tournament', id: PHASE, name: 'tournament 1', checked: 3, would_break: 2 },
      ],
    });
    expect(listTeamsForPinImpact).toHaveBeenCalledWith({ kind: 'season', id: SEASON }, MAX_IMPACT_TEAMS);
    // The rules of each version are read once, however many targets use them.
    expect(vi.mocked(getRulesetById).mock.calls.map(([id]) => id).sort()).toEqual([V1, V2]);
  });

  it('a target already on the version changes nothing and reads no team', async () => {
    vi.mocked(getPinTargetStates).mockResolvedValue([state('season', SEASON, 'active', V2)]);

    const impact = await computePinImpact(input([{ kind: 'season', id: SEASON }]));

    expect(impact).toMatchObject({ checked: 0, would_break: 0, targets: [{ id: SEASON, checked: 0, would_break: 0 }] });
    expect(listTeamsForPinImpact).not.toHaveBeenCalled();
  });

  it('a target with no team to check says so with zero', async () => {
    vi.mocked(getPinTargetStates).mockResolvedValue([state('tournament', PHASE)]);
    vi.mocked(listTeamsForPinImpact).mockResolvedValue({ teams: [], truncated: false });

    expect(await computePinImpact(input([{ kind: 'tournament', id: PHASE }]))).toMatchObject({ checked: 0, would_break: 0, truncated: false });
  });

  it('shares one bound between the targets and reports the cut: the first target uses the budget, the next is not read', async () => {
    vi.mocked(getPinTargetStates).mockResolvedValue([state('season', SEASON), state('tournament', PHASE)]);
    const many = Array.from({ length: MAX_IMPACT_TEAMS }, (_, i) => team(`t${i}`, DRAGONITE));
    vi.mocked(listTeamsForPinImpact).mockResolvedValue({ teams: many, truncated: false });

    const impact = await computePinImpact(input([{ kind: 'season', id: SEASON }, { kind: 'tournament', id: PHASE }]));

    expect(impact.checked).toBe(MAX_IMPACT_TEAMS);
    expect(impact.truncated).toBe(true);
    expect(listTeamsForPinImpact).toHaveBeenCalledTimes(1);
    expect(impact.targets[1]).toMatchObject({ id: PHASE, checked: 0, would_break: 0 });
  });

  it('passes the remaining budget on and keeps the reader’s own truncation flag', async () => {
    vi.mocked(getPinTargetStates).mockResolvedValue([state('season', SEASON), state('tournament', PHASE)]);
    vi.mocked(listTeamsForPinImpact)
      .mockResolvedValueOnce({ teams: [team('a', GARCHOMP), team('b', GARCHOMP)], truncated: false })
      .mockResolvedValueOnce({ teams: [team('c', GARCHOMP)], truncated: true });

    const impact = await computePinImpact(input([{ kind: 'season', id: SEASON }, { kind: 'tournament', id: PHASE }]));

    expect(vi.mocked(listTeamsForPinImpact).mock.calls[1][1]).toBe(MAX_IMPACT_TEAMS - 2);
    expect(impact).toMatchObject({ checked: 3, would_break: 3, truncated: true });
  });

  describe('assigned cores', () => {
    const withConstraints = makeRuleset({ id: V2, name: 'Spring', team_constraints: { tera_match: 'player_core' } });

    it('are read for the league of a phase when a version has team constraints, and handed to the validator', async () => {
      vi.mocked(getRulesetById).mockImplementation(async (id) => (id === V1 ? RULES_V1 : withConstraints));
      vi.mocked(getPinTargetStates).mockResolvedValue([state('tournament', PHASE)]);
      vi.mocked(listTeamsForPinImpact).mockResolvedValue({ teams: [{ id: 'x', player_id: 'p1', pokemon: [{ ...GARCHOMP, tera_type: 'Ground' }] }], truncated: false });
      vi.mocked(listParticipantCores).mockResolvedValue(new Map([['p1', ['Ground', 'Fire', 'Water']]]));

      const impact = await computePinImpact(input([{ kind: 'tournament', id: PHASE }]));

      expect(listParticipantCores).toHaveBeenCalledWith(SEASON);
      // Tera Ground is one of the player's core types: still valid.
      expect(impact.would_break).toBe(0);
    });

    it('make a team invalid when the new version asks for a core the player does not match', async () => {
      vi.mocked(getRulesetById).mockImplementation(async (id) => (id === V1 ? RULES_V1 : withConstraints));
      vi.mocked(getPinTargetStates).mockResolvedValue([state('season', SEASON)]);
      vi.mocked(listTeamsForPinImpact).mockResolvedValue({ teams: [{ id: 'x', player_id: 'p1', pokemon: [{ ...GARCHOMP, tera_type: 'Dragon' }] }], truncated: false });
      vi.mocked(listParticipantCores).mockResolvedValue(new Map([['p1', ['Ground', 'Fire', 'Water']]]));

      const impact = await computePinImpact(input([{ kind: 'season', id: SEASON }]));

      expect(listParticipantCores).toHaveBeenCalledWith(SEASON);
      expect(impact.would_break).toBe(1);
    });

    it('are not read at all when neither version has team constraints', async () => {
      vi.mocked(getPinTargetStates).mockResolvedValue([state('season', SEASON)]);
      vi.mocked(listTeamsForPinImpact).mockResolvedValue({ teams: [team('a', GARCHOMP)], truncated: false });

      await computePinImpact(input([{ kind: 'season', id: SEASON }]));

      expect(listParticipantCores).not.toHaveBeenCalled();
    });
  });

  describe('access, the same as the move itself', () => {
    it('an unknown version number is not found, before any team is read', async () => {
      vi.mocked(getPinTargetStates).mockResolvedValue([state('season', SEASON)]);
      await expect(computePinImpact(input([{ kind: 'season', id: SEASON }], { toVersionNo: 9 }))).rejects.toMatchObject({ code: 'ruleset_not_found' });
      expect(listTeamsForPinImpact).not.toHaveBeenCalled();
    });

    it('an unknown target, a finished target and a pin of another ruleset are refused', async () => {
      vi.mocked(getPinTargetStates).mockResolvedValue([]);
      await expect(computePinImpact(input([{ kind: 'season', id: SEASON }]))).rejects.toMatchObject({ code: 'ruleset_not_found' });
      vi.mocked(getPinTargetStates).mockResolvedValue([state('tournament', PHASE, 'completed')]);
      await expect(computePinImpact(input([{ kind: 'tournament', id: PHASE }]))).rejects.toMatchObject({ code: 'ruleset_pin_locked' });
      vi.mocked(getPinTargetStates).mockResolvedValue([state('season', SEASON, 'active', FOREIGN)]);
      await expect(computePinImpact(input([{ kind: 'season', id: SEASON }]))).rejects.toMatchObject({ code: 'ruleset_pin_mismatch' });
      expect(listTeamsForPinImpact).not.toHaveBeenCalled();
    });

    it('someone who does not administer a target learns nothing about its teams', async () => {
      vi.mocked(getPinTargetStates).mockResolvedValue([state('season', SEASON)]);
      vi.mocked(isResourceAdminFor).mockResolvedValue(false);

      await expect(computePinImpact(input([{ kind: 'season', id: SEASON }], { actor: player({ isAdmin: false }) }))).rejects.toMatchObject({ statusCode: 403 });
      expect(listTeamsForPinImpact).not.toHaveBeenCalled();

      vi.mocked(isResourceAdminFor).mockResolvedValue(true);
      vi.mocked(listTeamsForPinImpact).mockResolvedValue({ teams: [team('a', GARCHOMP)], truncated: false });
      await expect(computePinImpact(input([{ kind: 'season', id: SEASON }], { actor: player({ isAdmin: false }) }))).resolves.toMatchObject({ would_break: 1 });
      expect(isResourceAdminFor).toHaveBeenCalledWith(OWNER, 'season', SEASON);
    });
  });
});
