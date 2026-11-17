import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({}));
vi.mock('@/lib/supabase/queries/games', () => ({}));
vi.mock('@/lib/supabase/queries/ratings', () => ({}));
vi.mock('@/lib/tournament/enrollment-sync', () => ({}));
vi.mock('@/lib/supabase/queries/format-engine', () => ({ getSeasonKitHead: vi.fn(), getStandingAdjustments: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-formats', () => ({ getSeasonFormat: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime', () => ({ getFormatRuntime: vi.fn() }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhasesBySeasonId: vi.fn(), getPhaseParticipantsBatch: vi.fn(), getPhaseById: vi.fn() }));

import { classicLeague } from '@/lib/format-kit/presets';
import { contentHash } from '@/lib/studio-core/json';
import type { Json } from '@/types/database';
import type { PhaseParticipant, PhaseWithDetails } from '@/types/league-phase';
import type { SeasonFormatRow } from '@/lib/format-studio/library-types';
import { getSeasonKitHead, getStandingAdjustments } from '@/lib/supabase/queries/format-engine';
import { getSeasonFormat } from '@/lib/supabase/queries/season-formats';
import { getFormatRuntime } from '@/lib/supabase/queries/format-runtime';
import { getPhasesBySeasonId, getPhaseParticipantsBatch, getPhaseById } from '@/lib/supabase/queries/league-phases';
import { loadKitPhase, loadKitStandingsData } from '@/lib/format-engine/load';
import { kitAdvancingPlayers } from '@/lib/format-engine/advance';
import { runAutoAdvance } from '@/lib/format-engine/auto-advance';
import { loadFreshKitContext, loadMaskContext } from '@/lib/format-engine/runtime/load';
import { nativeKitStorage, type NativeKitConsumers } from '../kit-storage';
import { onNativePhaseStatusChanged } from '@/lib/format-engine/runtime/hooks';
import { computeStageStandings } from '@/lib/format-engine/standings';
import type { NativeKitStatusPort } from '../kit-events';
import type { FormatRuntime } from '@/lib/supabase/queries/format-runtime';

const spec = structuredClone(classicLeague);
spec.stages[0].rank = [{ kind: 'metric', metric: 'seed', direction: 'asc' }];
spec.edges[0].gate = 'auto';
const format: SeasonFormatRow = {
  season_id: 'league', definition_id: 'definition', version_no: 1, spec_hash: contentHash(spec), tunables: {},
  engine: 'kit', frozen_at: '2026-11-17T00:00:00Z', amendments: [], spec, seed: 'synthetic-seed', revision: 7,
};

function phase(id: string, stageIndex: number): PhaseWithDetails {
  const stage = spec.stages[stageIndex];
  return {
    id, season_id: 'league', name: 'Synthetic phase', description: '', bracket_type: stageIndex === 0 ? 'round_robin' : 'single_elim',
    ruleset_id: 'version', best_of_default: 1, bo_overrides: {}, is_doubles: false, team_visibility: 'hidden_until_match',
    status: 'upcoming', current_round: 0, stage_order: stageIndex + 1, advancement_rule: null, enrollment_source: null,
    archived: false, legacy: false, bracket_reset_enabled: false, third_place_enabled: false,
    format_stage_key: stage.key, format_group: 0, stage_spec: { v: 1, stage } as unknown as Json,
    season_format_type: 'custom', created_at: '2026-11-17T00:00:00Z', updated_at: '2026-11-17T00:00:00Z',
    ruleset_name: 'Synthetic rules', season_name: 'Synthetic league', participant_count: 2,
  };
}

function player(id: string, seed: number): PhaseParticipant {
  return {
    id, seed, starting_bracket: 'winners', name: `Player ${seed}`, discord_id: null, auth_user_id: null,
    ps_username: '', champions_username: '', is_admin: false, is_creator: false, is_guest: true, is_test_account: true,
    joined_date: null, avatar_url: null, avatar_config: null, status: 'active', suspended_until: null, ban_reason: null,
    created_at: '2026-11-17T00:00:00Z', updated_at: '2026-11-17T00:00:00Z',
  };
}

const consumers = {
  outcomes: vi.fn<NativeKitConsumers['outcomes']>(), matchIds: vi.fn<NativeKitConsumers['matchIds']>(),
  gameCounts: vi.fn<NativeKitConsumers['gameCounts']>(), kills: vi.fn<NativeKitConsumers['kills']>(),
  enroll: vi.fn<NativeKitConsumers['enroll']>(),
};
const storage = nativeKitStorage(consumers);

beforeEach(() => {
  vi.clearAllMocks();
  spec.rules = structuredClone(classicLeague.rules);
  delete spec.stages[0].foreach_group;
  vi.mocked(getSeasonKitHead).mockResolvedValue({ engine: 'kit', seed: format.seed, revision: 7, clockShiftSeconds: 0 });
  vi.mocked(getSeasonFormat).mockResolvedValue(format);
  vi.mocked(getStandingAdjustments).mockResolvedValue([]);
  vi.mocked(getPhasesBySeasonId).mockResolvedValue([phase('source', 0), phase('target', 1)]);
  vi.mocked(getPhaseById).mockResolvedValue(phase('target', 1));
  vi.mocked(getPhaseParticipantsBatch).mockResolvedValue(new Map([['source', [player('p2', 2), player('p1', 1)]]]));
  vi.mocked(getFormatRuntime).mockResolvedValue({ relationLinks: [], resourceItems: [], actionSubmissions: [], eventLog: [], flags: [], playerAttrs: [], trackProgress: [], checks: [], adjustments: [] });
  consumers.outcomes.mockResolvedValue([]);
  consumers.matchIds.mockResolvedValue([{ id: 'match', phase_id: 'source' }]);
  consumers.gameCounts.mockResolvedValue({});
  consumers.kills.mockResolvedValue({});
  consumers.enroll.mockResolvedValue({ enrolled_count: 2 });
});

describe('native phase status reactions', () => {
  let runtime: FormatRuntime;
  let port: NativeKitStatusPort;
  let addedPoints: number;

  beforeEach(() => {
    spec.rules = [
      { kind: 'rule.on_event', id: 'start_notice', on: { event: 'stage_start', stage: 'league' }, effects: [{ effect: 'notify', to: { who: 'all' }, message: { base: 'en', en: { v: 'Synthetic start', s: 'human' } } }] },
      { kind: 'rule.on_event', id: 'end_points', on: { event: 'stage_end', stage: 'league' }, effects: [{ effect: 'adjust_points', stage: 'league', to: { who: 'all' }, points: 5 }] },
    ];
    runtime = { relationLinks: [], resourceItems: [], actionSubmissions: [], eventLog: [], flags: [], playerAttrs: [], trackProgress: [], checks: [], adjustments: [] };
    vi.mocked(getFormatRuntime).mockImplementation(async () => runtime);
    addedPoints = 0;
    port = {
      storage,
      settled: vi.fn().mockResolvedValue(true),
      table: vi.fn(async () => computeStageStandings({ stage: spec.stages[0], participantIds: ['p1', 'p2'], participantNames: {}, matches: [], outcomes: {}, byes: [], seeds: { p1: 1, p2: 2 } })),
      invalidate: vi.fn(),
      writeEvent: vi.fn(async (input) => {
        if (runtime.eventLog.some((row) => row.event_key === input.eventKey)) return false;
        runtime.eventLog.push({ id: input.eventKey, season_id: input.seasonId, event: input.event, event_key: input.eventKey, payload: input.payload, ops: input.ops as unknown as Json, fired_by: input.firedBy, fired_at: '2026-11-17T00:00:00Z' });
        for (const op of input.ops) {
          if (op.op === 'adjust_points') addedPoints += op.points;
          if (op.op === 'lock_action') runtime.flags.push({ season_id: input.seasonId, key: `action:${op.action}`, value: 'locked', updated_at: '2026-11-17T00:00:00Z' });
        }
        return true;
      }),
    };
  });

  it('fires native start/end plans and applies stage-end effects before auto enrollment', async () => {
    const start = await onNativePhaseStatusChanged({ phase: { id: 'source', season_id: 'league' }, from: 'upcoming', to: 'active' }, port);
    expect(start).toMatchObject({ applied: true, held: false, advance: { ran: false } });
    expect(port.writeEvent).toHaveBeenCalledWith(expect.objectContaining({ eventKey: 'stage_start:league', revision: 7, notifications: [expect.objectContaining({ players: ['p1', 'p2'] })] }));
    consumers.enroll.mockImplementation(async () => {
      expect(addedPoints).toBe(10);
      expect(runtime.eventLog.map((row) => row.event_key)).toContain('stage_end:league');
      return { enrolled_count: 2 };
    });
    const end = await onNativePhaseStatusChanged({ phase: { id: 'source', season_id: 'league' }, from: 'active', to: 'completed' }, port);
    expect(end).toMatchObject({ applied: true, held: false, advance: { results: [{ target_phase_id: 'target', enrolled_count: 2 }] } });
    expect(port.table).toHaveBeenCalled();
    expect(port.invalidate).toHaveBeenCalledWith('league', ['source', 'target']);
  });

  it('holds the advance after an event failure, retries the reaction, and never replaces an existing contribution', async () => {
    const write = port.writeEvent;
    port.writeEvent = vi.fn().mockRejectedValue(new Error('synthetic event failure'));
    const request = { phase: { id: 'source', season_id: 'league' }, from: 'active' as const, to: 'completed' as const };
    expect(await onNativePhaseStatusChanged(request, port)).toMatchObject({ applied: false, held: true, advance: { ran: false } });
    expect(port.writeEvent).toHaveBeenCalledTimes(2);
    expect(consumers.enroll).not.toHaveBeenCalled();
    port.writeEvent = write;
    expect(await onNativePhaseStatusChanged({ ...request, retry: true }, port)).toMatchObject({ applied: true, held: false, advance: { ran: true } });
    vi.mocked(getPhaseById).mockResolvedValue({ ...phase('target', 1), enrollment_source: { type: 'standings', source_phase_id: 'source', synced_at: '2026-11-17T00:00:00Z', frozen: false, contributions: [{ source_phase_id: 'source', player_ids: ['p1', 'p2'] }] } });
    expect(await onNativePhaseStatusChanged({ ...request, from: 'completed', retry: true }, port)).toMatchObject({ applied: true, held: false, advance: { ran: false } });
    expect(consumers.enroll).toHaveBeenCalledTimes(1);
    expect(addedPoints).toBe(10);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('defers stage-end events until match effects are settled', async () => {
    vi.mocked(port.settled).mockResolvedValue(false);
    const request = { phase: { id: 'source', season_id: 'league' }, from: 'active' as const, to: 'completed' as const };
    expect(await onNativePhaseStatusChanged(request, port)).toMatchObject({ applied: false, held: true });
    expect(port.writeEvent).not.toHaveBeenCalled();
    expect(consumers.enroll).not.toHaveBeenCalled();
    vi.mocked(port.settled).mockResolvedValue(true);
    expect(await onNativePhaseStatusChanged({ ...request, retry: true }, port)).toMatchObject({ applied: true, advance: { ran: true } });
  });

  it('keeps a committed stage-end effect and allows advancement when later check planning fails', async () => {
    vi.mocked(port.table).mockRejectedValue(new Error('synthetic standings failure'));
    const result = await onNativePhaseStatusChanged({ phase: { id: 'source', season_id: 'league' }, from: 'active', to: 'completed' }, port);
    expect(result).toMatchObject({ applied: false, held: false, advance: { ran: true } });
    expect(port.writeEvent).toHaveBeenCalledTimes(1);
    expect(addedPoints).toBe(10);
    expect(consumers.enroll).toHaveBeenCalledTimes(1);
  });

  it('repairs an action-lock cascade through the native writer without replaying the stage event', async () => {
    spec.rules = [
      { kind: 'player.action', id: 'picks', label: { base: 'en', en: { v: 'Synthetic picks', s: 'human' } }, window: {}, steps: [], lock: 'on_close' },
      { kind: 'rule.on_event', id: 'lock_picks', on: { event: 'stage_start', stage: 'league' }, effects: [{ effect: 'lock_action', action: 'picks' }] },
    ];
    const request = { phase: { id: 'source', season_id: 'league' }, from: 'upcoming' as const, to: 'active' as const };
    const persist = port.writeEvent;
    let cascadeFailed = false;
    port.writeEvent = vi.fn(async (input) => {
      if (input.event === 'action_locked' && !cascadeFailed) {
        cascadeFailed = true;
        throw new Error('synthetic cascade failure');
      }
      return persist(input);
    });
    await onNativePhaseStatusChanged(request, port);
    expect(runtime.eventLog.map((row) => row.event_key)).toEqual(['stage_start:league']);
    await onNativePhaseStatusChanged(request, port);
    expect(runtime.eventLog.map((row) => row.event_key)).toEqual(['stage_start:league', 'action_locked:picks']);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('holds foreach-group advancement until the final native group ends, then advances every source once', async () => {
    spec.stages[0].foreach_group = { from: 'qualifiers' };
    const source = { ...phase('source', 0), format_group: 1, status: 'completed' as const };
    const sibling = { ...phase('sibling', 0), format_group: 2, status: 'active' as const };
    const target = phase('target', 1);
    vi.mocked(getPhasesBySeasonId).mockResolvedValue([source, sibling, target]);
    vi.mocked(getPhaseById).mockImplementation(async (id) => id === 'source' ? source : id === 'sibling' ? sibling : target);
    const request = { phase: { id: 'source', season_id: 'league' }, from: 'active' as const, to: 'completed' as const };
    expect(await onNativePhaseStatusChanged(request, port)).toMatchObject({ applied: true, advance: { ran: false } });
    expect(port.writeEvent).not.toHaveBeenCalled();
    expect(consumers.enroll).not.toHaveBeenCalled();
    vi.mocked(getPhaseById).mockImplementation(async (id) => id === 'source' ? source : id === 'sibling' ? { ...sibling, status: 'completed' } : target);
    expect(await onNativePhaseStatusChanged({ ...request, phase: { id: 'sibling', season_id: 'league' } }, port)).toMatchObject({ applied: true, advance: { ran: true } });
    expect(consumers.enroll.mock.calls.map((call) => call[2])).toEqual(['sibling', 'source']);
    expect(runtime.eventLog.map((row) => row.event_key)).toEqual(['stage_end:league']);
  });
});

describe('native kit orchestration without tournament-shaped rows', () => {
  it('loads standings, seed metrics and runtime context from native enrollment', async () => {
    const data = await loadKitStandingsData('league', { storage });
    expect(data?.stageOfMatch).toEqual({ match: 'source' });
    expect(data?.seeds?.source).toEqual({ p1: 1, p2: 2 });
    const loaded = await loadKitPhase('league', 'source', storage);
    expect(loaded?.tableExtras.seeds).toEqual({ p1: 1, p2: 2 });
    const ctx = await loadFreshKitContext('league', storage);
    expect(ctx?.phases[0].members).toEqual(['p1', 'p2']);
    const mask = await loadMaskContext('league', storage);
    expect(mask?.phases[0].members).toEqual(['p2', 'p1']);
    expect(getPhaseParticipantsBatch).toHaveBeenCalledWith(['source', 'target']);
    expect(consumers.outcomes).toHaveBeenCalledWith(['source']);
  });

  it('shares the advancement engine and forwards auto enrollment only to the explicit native consumer', async () => {
    const selected = await kitAdvancingPlayers({
      seasonId: 'league', sourcePhaseId: 'source', targetPhaseId: 'target', participantIds: ['p2', 'p1'],
      participantNames: { p1: 'Player One', p2: 'Player Two' }, matches: [], byes: [], groupOf: {},
    }, storage);
    expect(selected?.map((row) => row.player_id)).toEqual(['p1', 'p2']);
    expect(await runAutoAdvance('league', 'source', storage)).toEqual([{ target_phase_id: 'target', enrolled_count: 2 }]);
    expect(consumers.enroll).toHaveBeenCalledExactlyOnceWith('league', 'target', 'source');
  });

  it('does not overwrite an auto target that has started', async () => {
    vi.mocked(getPhaseById).mockResolvedValue({ ...phase('target', 1), status: 'active' });
    expect(await runAutoAdvance('league', 'source', storage)).toEqual([]);
    expect(consumers.enroll).not.toHaveBeenCalled();
  });
});
