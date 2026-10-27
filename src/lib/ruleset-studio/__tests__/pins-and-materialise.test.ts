import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ltext } from '@/lib/studio-core/ltext';
import { rulesFromBans } from '@/lib/ruleset-kit/effective';
import type { SessionPlayer } from '@/types/auth';
import type { RulesetDefinitionMeta, RulesetVersion } from '../library-types';

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
  repinTarget: vi.fn(),
  deleteRulesetDefinition: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/season-formats', () => ({ getPublishedRulesetHeads: vi.fn() }));
vi.mock('../library', () => ({ createPublished: vi.fn() }));

import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import {
  deleteRulesetDefinition,
  getPinTargetStates,
  getRulesetVersion,
  listPinnedTargets,
  listRulesetVersions,
  repinTarget,
} from '@/lib/supabase/queries/ruleset-definitions';
import { getPublishedRulesetHeads } from '@/lib/supabase/queries/season-formats';
import { createPublished } from '../library';
import { discardMaterialised, ensurePresetRulesets, presetRulesetName } from '../materialise';
import { listUsage, movePins } from '../pins';

const OWNER = '11111111-1111-4111-8111-111111111111';
const DEF = '33333333-3333-4333-8333-333333333333';
const V1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const V2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const SEASON = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const PHASE = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const FOREIGN = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

const player = (overrides: Partial<SessionPlayer> = {}): SessionPlayer => ({
  playerId: OWNER,
  name: 'Admin',
  isAdmin: true,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
  ...overrides,
});

const definition: RulesetDefinitionMeta = {
  id: DEF, slug: 'spring', name: ltext('en', 'Spring'), description: null, kind: 'custom', owner_id: OWNER, visibility: 'gallery',
  season_id: null, forked_from: null, draft_rev: 1, current_version_id: V2, created_at: '', updated_at: '',
};

const version = (id: string, no: number, banned: string[]): RulesetVersion =>
  ({ id, version_no: no, definition_id: DEF, resolved: rulesFromBans({ gen: 9, bans: { pokemon: banned } }) }) as unknown as RulesetVersion;

const state = (kind: 'season' | 'tournament', id: string, status: string, ruleset_id: string | null = V1) => ({ kind, id, name: `${kind} ${id.slice(-1)}`, status, season_id: kind === 'tournament' ? SEASON : null, ruleset_id });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listRulesetVersions).mockResolvedValue([
    { id: V2, version_no: 2 }, { id: V1, version_no: 1 },
  ] as never);
  vi.mocked(getRulesetVersion).mockImplementation(async (_id, no) => (no === 2 ? version(V2, 2, ['garchomp', 'koraidon']) : no === 1 ? version(V1, 1, ['koraidon']) : null));
  vi.mocked(repinTarget).mockResolvedValue(true);
  vi.mocked(isResourceAdminFor).mockResolvedValue(true);
});

describe('movePins', () => {
  const input = (targets: Array<{ kind: 'season' | 'tournament'; id: string }>, extra: { confirmStarted?: string[]; actor?: SessionPlayer } = {}) => ({
    actor: extra.actor ?? player(),
    definition,
    toVersionNo: 2,
    targets,
    confirmStarted: extra.confirmStarted ?? [],
  });

  it('moves an unstarted league and phase to the version and reports the difference between the two versions', async () => {
    vi.mocked(getPinTargetStates).mockResolvedValue([state('season', SEASON, 'upcoming'), state('tournament', PHASE, 'upcoming')]);
    const outcome = await movePins(input([{ kind: 'season', id: SEASON }, { kind: 'tournament', id: PHASE }]));
    expect(outcome).toMatchObject({ version_id: V2, version_no: 2 });
    expect(outcome.moved.map((m) => [m.kind, m.started])).toEqual([['season', false], ['tournament', false]]);
    expect(outcome.moved[0].difference?.pokemon).toEqual({ modeChanged: false, added: ['garchomp'], removed: [] });
    expect(repinTarget).toHaveBeenCalledWith('season', SEASON, V1, V2);
  });

  it('a started target needs its id in confirm_started: the refusal names it and writes nothing', async () => {
    vi.mocked(getPinTargetStates).mockResolvedValue([state('tournament', PHASE, 'active')]);
    const err = await movePins(input([{ kind: 'tournament', id: PHASE }])).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'ruleset_pin_confirm_required', params: { targets: 'tournament 1' } });
    expect(repinTarget).not.toHaveBeenCalled();

    const outcome = await movePins(input([{ kind: 'tournament', id: PHASE }], { confirmStarted: [PHASE] }));
    expect(outcome.moved[0]).toMatchObject({ started: true });
  });

  it('a completed league or phase is locked; a target that pins another ruleset is a mismatch; nothing is written for either', async () => {
    vi.mocked(getPinTargetStates).mockResolvedValue([state('tournament', PHASE, 'completed')]);
    await expect(movePins(input([{ kind: 'tournament', id: PHASE }], { confirmStarted: [PHASE] }))).rejects.toMatchObject({ code: 'ruleset_pin_locked' });
    vi.mocked(getPinTargetStates).mockResolvedValue([state('season', SEASON, 'upcoming', FOREIGN)]);
    await expect(movePins(input([{ kind: 'season', id: SEASON }]))).rejects.toMatchObject({ code: 'ruleset_pin_mismatch' });
    expect(repinTarget).not.toHaveBeenCalled();
  });

  it('every target must be administered by the caller (live); an unknown target or version is not found', async () => {
    vi.mocked(getPinTargetStates).mockResolvedValue([state('season', SEASON, 'upcoming')]);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);
    await expect(movePins(input([{ kind: 'season', id: SEASON }], { actor: player({ isAdmin: false }) }))).rejects.toMatchObject({ statusCode: 403 });
    expect(isResourceAdminFor).toHaveBeenCalledWith(OWNER, 'season', SEASON);
    expect(repinTarget).not.toHaveBeenCalled();

    vi.mocked(getPinTargetStates).mockResolvedValue([]);
    await expect(movePins(input([{ kind: 'season', id: SEASON }]))).rejects.toMatchObject({ code: 'ruleset_not_found' });
    await expect(movePins({ ...input([{ kind: 'season', id: SEASON }]), toVersionNo: 9 })).rejects.toMatchObject({ code: 'ruleset_not_found' });
  });

  it('a target already on the version is skipped; a pin that moved meanwhile is a conflict, not an overwrite', async () => {
    vi.mocked(getPinTargetStates).mockResolvedValue([state('season', SEASON, 'upcoming', V2)]);
    expect((await movePins(input([{ kind: 'season', id: SEASON }]))).moved).toEqual([]);
    vi.mocked(getPinTargetStates).mockResolvedValue([state('season', SEASON, 'upcoming', V1)]);
    vi.mocked(repinTarget).mockResolvedValue(false);
    await expect(movePins(input([{ kind: 'season', id: SEASON }]))).rejects.toMatchObject({ code: 'ruleset_pin_moved', params: { target: 'season 1' } });
  });

  it('reports each committed move before the next one starts, so a conflict later in the run loses nothing of the earlier moves', async () => {
    vi.mocked(getPinTargetStates).mockResolvedValue([state('season', SEASON, 'upcoming'), state('tournament', PHASE, 'upcoming')]);
    vi.mocked(repinTarget).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const reported: Array<[string, string]> = [];
    await expect(
      movePins({ ...input([{ kind: 'season', id: SEASON }, { kind: 'tournament', id: PHASE }]), onMoved: (moved, to) => reported.push([moved.id, to.version_id]) }),
    ).rejects.toMatchObject({ code: 'ruleset_pin_moved' });
    expect(reported).toEqual([[SEASON, V2]]);
  });

  it('reads the version list once for the ownership check and the version numbers, and tells the moved phase its league', async () => {
    vi.mocked(getPinTargetStates).mockResolvedValue([state('tournament', PHASE, 'upcoming')]);
    const outcome = await movePins(input([{ kind: 'tournament', id: PHASE }]));
    expect(listRulesetVersions).toHaveBeenCalledTimes(1);
    expect(outcome.moved[0]).toMatchObject({ kind: 'tournament', id: PHASE, season_id: SEASON });
  });
});

describe('listUsage', () => {
  beforeEach(() => {
    vi.mocked(listPinnedTargets).mockResolvedValue({
      seasons: [{ id: SEASON, name: 'Spring League', status: 'active', season_id: null, ruleset_id: V1 }],
      tournaments: [
        { id: PHASE, name: 'Groups', status: 'active', season_id: SEASON, ruleset_id: V1 },
        { id: FOREIGN, name: 'Elsewhere', status: 'active', season_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', ruleset_id: V2 },
      ],
    });
  });

  it('counts per version for everyone; names only for site admins', async () => {
    const forAdmin = await listUsage({ playerId: OWNER, isAdmin: true }, definition);
    expect(forAdmin.counts).toEqual([{ version_no: 1, seasons: 1, tournaments: 1 }, { version_no: 2, seasons: 0, tournaments: 1 }]);
    expect(forAdmin.targets?.map((t) => t.name).sort()).toEqual(['Elsewhere', 'Groups', 'Spring League']);

    const forOwner = await listUsage({ playerId: OWNER, isAdmin: false }, definition);
    expect(forOwner.counts).toEqual(forAdmin.counts);
    expect(forOwner.targets).toBeNull();
  });

  it('the admins of the league that owns a league-made ruleset see the names of that league only', async () => {
    const usage = await listUsage({ playerId: OWNER, isAdmin: false, leagueIds: new Set([SEASON]) }, { ...definition, season_id: SEASON });
    expect(usage.targets?.map((t) => t.name).sort()).toEqual(['Groups', 'Spring League']);
  });
});

describe('ensurePresetRulesets', () => {
  const base = { leagueName: 'Spring League', seasonId: SEASON, actorId: OWNER };

  it('creates one published, league-owned, private ruleset per preset and returns definition and version ids', async () => {
    vi.mocked(getPublishedRulesetHeads).mockResolvedValue(new Map());
    vi.mocked(createPublished).mockResolvedValueOnce({ definitionId: 'd1', versionId: 'v1' }).mockResolvedValueOnce({ definitionId: 'd2', versionId: 'v2' });
    const ensured = await ensurePresetRulesets({ ...base, presets: ['gen9ou', 'gen9ubers'], recorded: {} });
    expect(Object.fromEntries(ensured.definitionIds)).toEqual({ gen9ou: 'd1', gen9ubers: 'd2' });
    expect(Object.fromEntries(ensured.versionIds)).toEqual({ gen9ou: 'v1', gen9ubers: 'v2' });
    expect(ensured.created).toEqual(['d1', 'd2']);
    const call = vi.mocked(createPublished).mock.calls[0][0];
    expect(call).toMatchObject({ ownerId: OWNER, kind: 'custom', visibility: 'private', seasonId: SEASON });
    expect(call.document).toMatchObject({ base: { kind: 'preset', preset: 'gen9ou' } });
    expect(call.name).toEqual(ltext('en', 'Spring League · Gen 9 OU'));
  });

  it('reuses the recorded ruleset while it has a published version and pins its CURRENT head (admin edits survive)', async () => {
    vi.mocked(getPublishedRulesetHeads).mockResolvedValue(new Map([['recorded-def', 'head-v3']]));
    const ensured = await ensurePresetRulesets({ ...base, presets: ['gen9ou'], recorded: { gen9ou: 'recorded-def' } });
    expect(createPublished).not.toHaveBeenCalled();
    expect(ensured.definitionIds.get('gen9ou')).toBe('recorded-def');
    expect(ensured.versionIds.get('gen9ou')).toBe('head-v3');
    expect(ensured.created).toEqual([]);
  });

  it('a recorded ruleset that lost its published version is replaced', async () => {
    vi.mocked(getPublishedRulesetHeads).mockResolvedValue(new Map());
    vi.mocked(createPublished).mockResolvedValue({ definitionId: 'd9', versionId: 'v9' });
    const ensured = await ensurePresetRulesets({ ...base, presets: ['gen9ou'], recorded: { gen9ou: 'gone' } });
    expect(ensured.created).toEqual(['d9']);
  });

  it('discards what it already created when a later one fails, and rethrows', async () => {
    vi.mocked(getPublishedRulesetHeads).mockResolvedValue(new Map());
    vi.mocked(createPublished).mockResolvedValueOnce({ definitionId: 'd1', versionId: 'v1' }).mockRejectedValueOnce(new Error('rpc down'));
    vi.mocked(deleteRulesetDefinition).mockResolvedValue(undefined);
    await expect(ensurePresetRulesets({ ...base, presets: ['gen9ou', 'gen9ubers'], recorded: {} })).rejects.toThrow('rpc down');
    expect(deleteRulesetDefinition).toHaveBeenCalledWith('d1');
  });

  it('an unknown preset is a programming error; nothing is created for an empty list', async () => {
    vi.mocked(getPublishedRulesetHeads).mockResolvedValue(new Map());
    await expect(ensurePresetRulesets({ ...base, presets: ['gen99zz'], recorded: {} })).rejects.toThrow('unknown rule preset');
    expect(await ensurePresetRulesets({ ...base, presets: [], recorded: {} })).toEqual({ definitionIds: new Map(), versionIds: new Map(), created: [] });
  });

  it('a discard failure is logged and never hides the original error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(deleteRulesetDefinition).mockRejectedValue(new Error('delete failed'));
    await expect(discardMaterialised(['d1'])).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('d1'), expect.any(Error));
    log.mockRestore();
  });

  it('names the ruleset after the league and the preset, within the name limit', () => {
    expect(presetRulesetName(' Spring League ', 'Gen 9 OU')).toBe('Spring League · Gen 9 OU');
    expect(presetRulesetName('x'.repeat(500), 'Gen 9 OU').length).toBeLessThanOrEqual(200);
  });
});
