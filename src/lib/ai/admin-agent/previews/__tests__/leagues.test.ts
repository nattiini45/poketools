import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requireAdmin: vi.fn(), requireAnyAdmin: vi.fn(), requireResourceAdmin: vi.fn(), requireDraftAdmin: vi.fn(), requireFormatViewer: vi.fn() }));
vi.mock('@/lib/ruleset-studio/guards', () => ({ requireRulesetViewer: vi.fn(), requireRulesetOwner: vi.fn(), assertRulesetUsable: vi.fn() }));
vi.mock('@/lib/season/clone', () => ({ assertCloneAllowed: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ listSeasons: vi.fn(), getSeasonById: vi.fn() }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getActiveListVersion: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroups: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getStagesBySeasonId: vi.fn() }));

import { requireAnyAdmin, requireResourceAdmin } from '@/lib/auth/helpers';
import { assertRulesetUsable } from '@/lib/ruleset-studio/guards';
import { RulesetStudioError } from '@/lib/ruleset-studio/errors';
import { assertCloneAllowed } from '@/lib/season/clone';
import { getActiveListVersion } from '@/lib/supabase/queries/point-buy-lists';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { getSeasonById, listSeasons } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import type { SessionPlayer } from '@/types/auth';
import type { ToolContext } from '../../registry/types';
import { leagueCreatePreview, phaseCreatePreview, roundSchedulePreview, tournamentCreatePreview } from '../leagues';

const SITE: SessionPlayer = { playerId: '11111111-1111-4111-8111-111111111111', name: 'Site', isAdmin: true, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' };
const SCOPED: SessionPlayer = { ...SITE, isAdmin: false, isResourceAdmin: true };
const RS = '22222222-2222-4222-8222-222222222222';
const L1 = '33333333-3333-4333-8333-333333333333';
const ctx: ToolContext = { role: 'site', maxPhase: 5, offeredTools: [], conversationId: null, now: () => new Date(0), timeZone: 'Europe/Berlin', locale: 'en', ports: {} };
type Ok<T> = { ok: true; data: T };
interface Preview {
  valid: boolean;
  blockers: Array<{ code: string; params_user_text: string }>;
  effects: string[];
  ruleset?: { visibility: string; version_no: number } | null;
}

const usable = (visibility = 'gallery') => ({ definition: { id: '44444444-4444-4444-8444-444444444444', slug: 'gen9-ou', visibility }, version_no: 3 });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAnyAdmin).mockResolvedValue(SITE);
  vi.mocked(requireResourceAdmin).mockResolvedValue(SITE);
  vi.mocked(listSeasons).mockResolvedValue([]);
  vi.mocked(getActiveListVersion).mockResolvedValue(null);
  vi.mocked(assertRulesetUsable).mockResolvedValue(usable() as never);
  vi.mocked(assertCloneAllowed).mockResolvedValue({ source: {} } as never);
});

describe('league_create_preview', () => {
  it('lists what creating a league does and is valid for a plain request', async () => {
    const result = (await leagueCreatePreview.run({ name: 'Autumn League', format_type: 'singles', ruleset_id: RS, start_date: '2026-11-02', end_date: '2027-01-31' }, ctx)) as Ok<Preview & { name_in_use: boolean }>;
    expect(result.data.valid).toBe(true);
    expect(result.data.effects).toEqual(['public_immediately']);
    expect(result.data.ruleset).toMatchObject({ visibility: 'gallery', version_no: 3 });
    expect(result.data.name_in_use).toBe(false);
    expect(assertRulesetUsable).toHaveBeenCalledWith(SITE, RS);
  });

  it('adds creator_becomes_admin for a non-site admin and warns that a private ruleset becomes public', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue(SCOPED);
    vi.mocked(assertRulesetUsable).mockResolvedValue(usable('private') as never);
    const result = (await leagueCreatePreview.run({ name: 'Autumn', format_type: 'singles', ruleset_id: RS }, ctx)) as Ok<Preview>;
    expect(result.data.effects).toEqual(['public_immediately', 'creator_becomes_admin', 'private_ruleset_becomes_public']);
  });

  it('blocks an end date before the start date with the route\'s own code', async () => {
    const result = (await leagueCreatePreview.run({ name: 'Autumn', format_type: 'singles', start_date: '2026-12-01', end_date: '2026-11-01' }, ctx)) as Ok<Preview>;
    expect(result.data.valid).toBe(false);
    expect(result.data.blockers.map((b) => b.code)).toEqual(['SEASON_DATES_INVALID']);
  });

  it('blocks a ruleset version the admin may not use (another admin\'s private ruleset) or that does not exist', async () => {
    vi.mocked(assertRulesetUsable).mockRejectedValue(new RulesetStudioError('ruleset_forbidden'));
    const forbidden = (await leagueCreatePreview.run({ name: 'Autumn', format_type: 'singles', ruleset_id: RS }, ctx)) as Ok<Preview>;
    expect(forbidden.data.blockers.map((b) => b.code)).toEqual(['ruleset_forbidden']);
    expect(forbidden.data.ruleset).toBeNull();
    vi.mocked(assertRulesetUsable).mockRejectedValue(new RulesetStudioError('ruleset_not_found'));
    const missing = (await leagueCreatePreview.run({ name: 'Autumn', format_type: 'singles', ruleset_id: RS }, ctx)) as Ok<Preview>;
    expect(missing.data.blockers.map((b) => b.code)).toEqual(['ruleset_not_found']);
  });

  it('checks the clone permission and lists what the copy brings', async () => {
    vi.mocked(assertCloneAllowed).mockRejectedValue(new UserFacingError('x', { code: 'SEASON_CLONE_CUSTOM_FORMAT', status: 409 }));
    const refused = (await leagueCreatePreview.run({ name: 'Copy', format_type: 'singles', clone_from: { season_id: L1, copy_roster: true } }, ctx)) as Ok<Preview>;
    expect(refused.data.blockers.map((b) => b.code)).toEqual(['SEASON_CLONE_CUSTOM_FORMAT']);
    expect(refused.data.effects).toEqual(expect.arrayContaining(['clones_phases', 'clones_roster']));
    expect(assertCloneAllowed).toHaveBeenCalledWith(SITE, { sourceId: L1, copyAdmins: false });
  });

  it('describes the Evolution Point Buy side effects: shared battle ruleset, active list bound or not', async () => {
    vi.mocked(getActiveListVersion).mockResolvedValue({ id: RS, name: 'List v3', version: 3 } as never);
    const bound = (await leagueCreatePreview.run({ name: 'Point Buy League', format_type: 'evolution_point_buy' }, ctx)) as Ok<Preview & { active_point_buy_list: { version: number } | null }>;
    expect(bound.data.effects).toEqual(['public_immediately', 'ensures_point_buy_battle_ruleset', 'binds_active_point_buy_list']);
    expect(bound.data.active_point_buy_list).toMatchObject({ version: 3 });
    vi.mocked(getActiveListVersion).mockResolvedValue(null);
    const unbound = (await leagueCreatePreview.run({ name: 'Point Buy League', format_type: 'evolution_point_buy', ruleset_id: RS }, ctx)) as Ok<Preview>;
    expect(unbound.data.effects).toEqual(['public_immediately', 'point_buy_list_unbound']);
  });

  it('flags a name that is already a league', async () => {
    vi.mocked(listSeasons).mockResolvedValue([{ name: '  autumn league ' }] as never);
    const result = (await leagueCreatePreview.run({ name: 'Autumn League', format_type: 'singles' }, ctx)) as Ok<{ name_in_use: boolean }>;
    expect(result.data.name_in_use).toBe(true);
  });

  it('rejects what the create schema rejects (no name, unknown format) before any check', async () => {
    expect(await leagueCreatePreview.run({ format_type: 'singles' }, ctx)).toMatchObject({ code: 'validation_failed' });
    expect(await leagueCreatePreview.run({ name: 'x', format_type: 'round_robin' }, ctx)).toMatchObject({ code: 'validation_failed' });
    expect(assertRulesetUsable).not.toHaveBeenCalled();
  });
});

describe('tournament_create_preview', () => {
  const base = { name: 'Cup', bracket_type: 'single_elim', ruleset_id: RS };

  it('is valid for a plain request and names the effects', async () => {
    const result = (await tournamentCreatePreview.run(base, ctx)) as Ok<Preview>;
    expect(result.data).toMatchObject({ valid: true, effects: ['public_immediately'] });
  });

  it('rejects an even best-of with the route\'s own schema message', async () => {
    expect(await tournamentCreatePreview.run({ ...base, best_of_default: 2 }, ctx)).toMatchObject({ ok: false, code: 'validation_failed' });
  });

  it('checks best-of override round names against the bracket of the expected field', async () => {
    const good = (await tournamentCreatePreview.run({ ...base, bo_overrides_json: '{"Finals":5,"Semifinals":3}', expected_participants: 8 }, ctx)) as Ok<Preview>;
    expect(good.data.valid).toBe(true);
    const bad = (await tournamentCreatePreview.run({ ...base, bo_overrides_json: '{"Round 9":5}', expected_participants: 8 }, ctx)) as Ok<Preview>;
    expect(bad.data.blockers.map((b) => b.code)).toEqual(['bo_override_key_unknown']);
    expect(bad.data.blockers[0].params_user_text).toContain('Round 9');
    const notJson = (await tournamentCreatePreview.run({ ...base, bo_overrides_json: '{nope' }, ctx)) as Ok<Preview>;
    expect(notJson.data.blockers.map((b) => b.code)).toEqual(['invalid_json']);
    const evenBo = (await tournamentCreatePreview.run({ ...base, bo_overrides_json: '{"Finals":4}' }, ctx)) as Ok<Preview>;
    expect(evenBo.data.blockers.map((b) => b.code)).toEqual(['validation_failed']);
  });

  it('blocks a ruleset the admin may not use', async () => {
    vi.mocked(assertRulesetUsable).mockRejectedValue(new RulesetStudioError('ruleset_forbidden'));
    const result = (await tournamentCreatePreview.run(base, ctx)) as Ok<Preview>;
    expect(result.data.valid).toBe(false);
  });
});

describe('phase_create_preview', () => {
  const stage = (name: string, order: number, status = 'upcoming') => ({ id: `00000000-0000-4000-8000-00000000000${order}`, name, stage_order: order, status });
  const body = { league_id: L1, name: 'Playoffs', bracket_type: 'single_elim', ruleset_id: RS };

  beforeEach(() => {
    vi.mocked(getSeasonById).mockResolvedValue({ id: L1, name: 'Autumn' } as never);
  });

  it('describes the first phase as filled from the roster and a later one from the previous standings', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([]);
    const first = (await phaseCreatePreview.run({ ...body, name: 'Group stage', bracket_type: 'round_robin' }, ctx)) as Ok<Preview & { insert_at: number }>;
    expect(first.data).toMatchObject({ valid: true, insert_at: 1, effects: ['enrolls_league_roster'] });
    vi.mocked(getStagesBySeasonId).mockResolvedValue([stage('Group stage', 1)] as never);
    const second = (await phaseCreatePreview.run({ ...body, advancement_count: 4 }, ctx)) as Ok<Preview & { insert_at: number }>;
    expect(second.data).toMatchObject({ valid: true, insert_at: 2, effects: ['enrolls_previous_phase_standings'] });
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', L1);
  });

  it('blocks a name that is taken in the league, case-insensitively', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([stage('playoffs', 1)] as never);
    const result = (await phaseCreatePreview.run(body, ctx)) as Ok<Preview>;
    expect(result.data.blockers.map((b) => b.code)).toContain('PHASE_NAME_TAKEN');
  });

  it('blocks an insert before a phase that has started, and one out of range', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([stage('Group stage', 1, 'active'), stage('Finals', 2)] as never);
    const locked = (await phaseCreatePreview.run({ ...body, insert_at: 1 }, ctx)) as Ok<Preview>;
    expect(locked.data.blockers.map((b) => b.code)).toContain('PHASE_INSERT_LOCKED');
    const range = (await phaseCreatePreview.run({ ...body, insert_at: 9 }, ctx)) as Ok<Preview>;
    expect(range.data.blockers.map((b) => b.code)).toContain('PHASE_INSERT_INVALID');
    const fine = (await phaseCreatePreview.run({ ...body, insert_at: 3 }, ctx)) as Ok<Preview>;
    expect(fine.data.valid).toBe(true);
  });

  it('answers SEASON_NOT_FOUND for an unknown league', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(null);
    expect(await phaseCreatePreview.run(body, ctx)).toEqual({ ok: false, code: 'SEASON_NOT_FOUND' });
  });

  it('validates the assembled body with the real phase schema (an even best-of is a blocker)', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([]);
    expect(await phaseCreatePreview.run({ ...body, best_of_default: 2 }, ctx)).toMatchObject({ ok: false, code: 'validation_failed' });
  });
});

describe('round_schedule_preview', () => {
  it('answers one circle: N-1 rounds for an even field, N for an odd one', async () => {
    const even = (await roundSchedulePreview.run({ participant_count: 12 }, ctx)) as Ok<{ circles: number; total_rounds: number }>;
    expect(even.data).toMatchObject({ circles: 1, total_rounds: 11 });
    const odd = (await roundSchedulePreview.run({ participant_count: 7 }, ctx)) as Ok<{ total_rounds: number }>;
    expect(odd.data.total_rounds).toBe(7);
  });

  it('plans the weeks of a league\'s groups', async () => {
    vi.mocked(getSeasonGroups).mockResolvedValue([
      { id: 'a', season_id: L1, name: 'A', sort_order: 1, player_ids: ['p1', 'p2', 'p3', 'p4'] },
      { id: 'b', season_id: L1, name: 'B', sort_order: 2, player_ids: ['p5', 'p6', 'p7', 'p8'] },
    ] as never);
    const result = (await roundSchedulePreview.run({ league_id: L1 }, ctx)) as Ok<{ total_rounds: number; first_half_last_week: number; blockers: unknown[] }>;
    expect(result.data.total_rounds).toBeGreaterThan(0);
    expect(result.data.first_half_last_week).toBe(Math.floor(result.data.total_rounds / 2));
    expect(result.data.blockers).toEqual([]);
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', L1);
  });

  it('reports a league without groups instead of inventing a plan, and needs one of the two inputs', async () => {
    vi.mocked(getSeasonGroups).mockResolvedValue([]);
    const none = (await roundSchedulePreview.run({ league_id: L1 }, ctx)) as Ok<{ total_rounds: number | null; blockers: Array<{ code: string }> }>;
    expect(none.data.total_rounds).toBeNull();
    expect(none.data.blockers.map((b) => b.code)).toEqual(['SEASON_GROUP_NOT_FOUND']);
    expect(await roundSchedulePreview.run({}, ctx)).toMatchObject({ code: 'validation_failed' });
  });
});
