/**
 * The attach-side queries: the summary read never selects the spec or the seed, the start signals map the
 * `rounds ( count )` embeds, ruleset ids are checked in chunks of 50 (an empty list makes no request), and both
 * writes are the Postgres functions with their database signals mapped to typed errors.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Step = [string, ...unknown[]];
interface Call {
  table: string;
  steps: Step[];
}

const state = vi.hoisted(() => ({
  calls: [] as { table: string; steps: [string, ...unknown[]][] }[],
  rpcCalls: [] as { name: string; args: unknown }[],
  respond: null as null | ((call: { table: string; steps: [string, ...unknown[]][] }) => {
    data?: unknown;
    count?: number | null;
    error?: unknown;
  }),
  rpcReply: null as null | { data?: unknown; error?: unknown },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => {
  function builder(table: string) {
    const call: Call = { table, steps: [] };
    state.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'in', 'is']) {
      chain[name] = (...args: unknown[]) => {
        call.steps.push([name, ...args]);
        return chain;
      };
    }
    const reply = () => state.respond?.(call) ?? { data: [], count: 0, error: null };
    chain.maybeSingle = () => Promise.resolve().then(() => ({ error: null, ...reply() }));
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ error: null, ...reply() });
    return chain;
  }
  return {
    supabase: {
      from: builder,
      rpc: (name: string, args: unknown) => {
        state.rpcCalls.push({ name, args });
        return Promise.resolve({ error: null, ...(state.rpcReply ?? { data: {} }) });
      },
    },
  };
});

import {
  attachSeasonFormat,
  detachSeasonFormat,
  getExistingRulesetIds,
  getSeasonFormat,
  getSeasonFormatSummary,
  getSeasonManualPhaseCount,
  getSeasonStartSignals,
  type AttachStageRow,
} from '../season-formats';
import { isSeasonStarted } from '@/lib/season/season-started';
import type { FormatDefinition } from '@/lib/format-kit/client';

const SEASON = '3f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5b';
const stepsOf = (call: Call, name: string) => call.steps.filter(([step]) => step === name);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeEach(() => {
  state.calls.length = 0;
  state.rpcCalls.length = 0;
  state.respond = null;
  state.rpcReply = null;
});

describe('getSeasonFormatSummary and getSeasonFormat', () => {
  const row = {
    season_id: SEASON,
    definition_id: 'd',
    version_no: 2,
    spec_hash: 'h',
    tunables: {},
    engine: 'kit',
    frozen_at: 't',
    amendments: [],
  };

  it('selects named columns without the spec and the seed', async () => {
    state.respond = () => ({ data: row });
    expect(await getSeasonFormatSummary(SEASON)).toEqual(row);
    const select = stepsOf(state.calls[0], 'select')[0][1] as string;
    expect(select).not.toContain('*');
    expect(select).not.toMatch(/\bspec\b/);
    expect(select).not.toContain('seed');
    expect(state.calls[0].table).toBe('season_formats');
    expect(stepsOf(state.calls[0], 'eq')[0].slice(1)).toEqual(['season_id', SEASON]);
  });

  it('answers null when nothing is attached', async () => {
    state.respond = () => ({ data: null });
    expect(await getSeasonFormatSummary(SEASON)).toBeNull();
  });

  it('answers null for a malformed id without a request', async () => {
    expect(await getSeasonFormatSummary('x')).toBeNull();
    expect(await getSeasonFormat('x')).toBeNull();
    expect(await getSeasonStartSignals('x')).toBeNull();
    expect(await getSeasonManualPhaseCount('x')).toBe(0);
    expect(state.calls).toHaveLength(0);
  });

  it('the full read adds the spec and the seed', async () => {
    state.respond = () => ({ data: { ...row, spec: { schema_version: 1 }, seed: 'abcdef12' } });
    const full = await getSeasonFormat(SEASON);
    expect(full?.seed).toBe('abcdef12');
    expect(full?.spec).toEqual({ schema_version: 1 });
    expect(stepsOf(state.calls[0], 'select')[0][1]).toBe(
      'season_id, definition_id, version_no, spec_hash, tunables, engine, frozen_at, amendments, spec, seed',
    );
  });

  it('rethrows a database error', async () => {
    const boom = { message: 'boom' };
    state.respond = () => ({ error: boom });
    await expect(getSeasonFormatSummary(SEASON)).rejects.toBe(boom);
  });
});

describe('getSeasonStartSignals', () => {
  it('reads the league and its phases in one request and maps the round count embeds', async () => {
    state.respond = () => ({
      data: {
        status: 'upcoming',
        tournaments: [
          { status: 'upcoming', rounds: [{ count: 0 }] },
          { status: 'upcoming', rounds: [{ count: 3 }] },
          { status: 'active', rounds: null },
        ],
      },
    });
    const signals = await getSeasonStartSignals(SEASON);
    expect(state.calls).toHaveLength(1);
    expect(stepsOf(state.calls[0], 'select')[0][1]).toBe('status, tournaments ( status, rounds ( count ) )');
    expect(signals).toEqual({
      status: 'upcoming',
      phases: [
        { status: 'upcoming', rounds_total: 0 },
        { status: 'upcoming', rounds_total: 3 },
        { status: 'active', rounds_total: 0 },
      ],
    });
    expect(isSeasonStarted(signals!)).toBe(true);
  });

  it('a league with no phases is not started while upcoming', async () => {
    state.respond = () => ({ data: { status: 'upcoming', tournaments: null } });
    const signals = await getSeasonStartSignals(SEASON);
    expect(signals).toEqual({ status: 'upcoming', phases: [] });
    expect(isSeasonStarted(signals!)).toBe(false);
  });

  it('answers null for a missing league', async () => {
    state.respond = () => ({ data: null });
    expect(await getSeasonStartSignals(SEASON)).toBeNull();
  });
});

describe('getSeasonManualPhaseCount', () => {
  it('head-counts the league phases without a format stage key', async () => {
    state.respond = () => ({ count: 2, data: null });
    expect(await getSeasonManualPhaseCount(SEASON)).toBe(2);
    const call = state.calls[0];
    expect(call.table).toBe('tournaments');
    expect(stepsOf(call, 'select')[0].slice(1)).toEqual(['id', { count: 'exact', head: true }]);
    expect(stepsOf(call, 'eq')[0].slice(1)).toEqual(['season_id', SEASON]);
    expect(stepsOf(call, 'is')[0].slice(1)).toEqual(['format_stage_key', null]);
  });
});

describe('getExistingRulesetIds', () => {
  it('makes no request for an empty list', async () => {
    expect((await getExistingRulesetIds([])).size).toBe(0);
    expect(state.calls).toHaveLength(0);
  });

  it('chunks 120 ids as 50, 50 and 20 and unions the answers', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => uuid(i + 1));
    state.respond = (call) => ({ data: (stepsOf(call, 'in')[0][2] as string[]).slice(0, 1).map((id) => ({ id })) });
    const found = await getExistingRulesetIds(ids);
    expect(state.calls.map((call) => (stepsOf(call, 'in')[0][2] as string[]).length)).toEqual([50, 50, 20]);
    expect(state.calls[0].table).toBe('rulesets');
    expect(stepsOf(state.calls[0], 'select')[0][1]).toBe('id');
    expect(stepsOf(state.calls[0], 'in')[0][1]).toBe('id');
    expect([...found].sort()).toEqual([uuid(1), uuid(51), uuid(101)]);
  });

  it('deduplicates ids and never sends a malformed one', async () => {
    state.respond = () => ({ data: [] });
    await getExistingRulesetIds([uuid(1), uuid(1), 'not-a-uuid']);
    expect(stepsOf(state.calls[0], 'in')[0][2]).toEqual([uuid(1)]);
    state.calls.length = 0;
    expect((await getExistingRulesetIds(['nope'])).size).toBe(0);
    expect(state.calls).toHaveLength(0);
  });
});

describe('attachSeasonFormat', () => {
  const spec = { schema_version: 1 } as unknown as FormatDefinition;
  const stage: AttachStageRow = {
    key: 'groups',
    name: 'Groups',
    bracket_type: 'round_robin',
    ruleset_id: uuid(9),
    best_of_default: 1,
    bo_overrides: {},
    is_doubles: false,
    bracket_reset_enabled: true,
    stage_order: 1,
    stage_spec: { v: 1, spec_hash: 'h', stage: {} as never, mapped_bracket_type: 'round_robin' },
  };
  const input = { seasonId: SEASON, definitionId: uuid(5), versionNo: 2, spec, specHash: 'h'.repeat(64), seed: 'abcdef12', stages: [stage] };

  it('calls format_attach_season with the frozen spec, hash, seed and stages', async () => {
    state.rpcReply = { data: { replaced: true, stages: [{ id: 't1', key: 'groups' }], removed_stage_ids: ['t2'] } };
    expect(await attachSeasonFormat(input)).toEqual({
      replaced: true,
      stages: [{ id: 't1', key: 'groups' }],
      removed_stage_ids: ['t2'],
    });
    expect(state.rpcCalls).toEqual([
      {
        name: 'format_attach_season',
        args: {
          p_season_id: SEASON,
          p_definition_id: uuid(5),
          p_version_no: 2,
          p_spec: spec,
          p_spec_hash: 'h'.repeat(64),
          p_seed: 'abcdef12',
          p_stages: [stage],
        },
      },
    ]);
  });

  it('reads a malformed function result as an empty one', async () => {
    state.rpcReply = { data: { stages: [{ id: 1 }, 'x'], removed_stage_ids: [1, 'a'] } };
    expect(await attachSeasonFormat(input)).toEqual({ replaced: false, stages: [], removed_stage_ids: ['a'] });
  });

  it.each([
    ['FORMAT_SEASON_NOT_CUSTOM', 'format_season_not_custom', 409],
    ['FORMAT_SEASON_STARTED', 'format_season_started', 409],
    ['FORMAT_SEASON_NOT_FOUND', 'season_not_found', 404],
  ])('maps %s', async (message, code, status) => {
    state.rpcReply = { error: { code: 'P0001', message } };
    await expect(attachSeasonFormat(input)).rejects.toMatchObject({ code, statusCode: status });
  });

  it('maps manual phases with their count', async () => {
    state.rpcReply = { error: { code: 'P0001', message: 'FORMAT_SEASON_HAS_MANUAL_PHASES', details: '{"count":3}' } };
    await expect(attachSeasonFormat(input)).rejects.toMatchObject({
      code: 'format_attach_manual_phases',
      params: { count: 3 },
    });
  });

  it('maps a definition deleted during the attach', async () => {
    state.rpcReply = {
      error: { code: '23503', message: 'insert or update on table "season_formats" violates foreign key constraint "season_formats_definition_id_fkey"' },
    };
    await expect(attachSeasonFormat(input)).rejects.toMatchObject({ code: 'format_not_found', statusCode: 404 });
  });

  it('rethrows an unrelated error unchanged', async () => {
    const boom = { code: '57014', message: 'canceling statement due to statement timeout' };
    state.rpcReply = { error: boom };
    await expect(attachSeasonFormat(input)).rejects.toBe(boom);
  });
});

describe('detachSeasonFormat', () => {
  it('calls format_detach_season and returns the removed stage ids', async () => {
    state.rpcReply = { data: { removed_stage_ids: ['a', 'b'] } };
    expect(await detachSeasonFormat(SEASON)).toEqual({ removed_stage_ids: ['a', 'b'] });
    expect(state.rpcCalls).toEqual([{ name: 'format_detach_season', args: { p_season_id: SEASON } }]);
  });

  it('maps nothing attached, started and a team that still points at a stage', async () => {
    state.rpcReply = { error: { code: 'P0001', message: 'FORMAT_NOTHING_ATTACHED' } };
    await expect(detachSeasonFormat(SEASON)).rejects.toMatchObject({ code: 'format_nothing_attached', statusCode: 404 });
    state.rpcReply = { error: { code: 'P0001', message: 'FORMAT_SEASON_STARTED' } };
    await expect(detachSeasonFormat(SEASON)).rejects.toMatchObject({ code: 'format_season_started', statusCode: 409 });
    state.rpcReply = {
      error: { code: '23503', message: 'update or delete on table "tournaments" violates foreign key constraint "teams_tournament_id_fkey" on table "teams"' },
    };
    await expect(detachSeasonFormat(SEASON)).rejects.toMatchObject({ code: 'format_detach_blocked', statusCode: 409 });
  });
});
