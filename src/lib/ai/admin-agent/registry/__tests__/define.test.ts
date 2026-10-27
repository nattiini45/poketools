import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  requireAnyAdmin: vi.fn(),
  requireResourceAdmin: vi.fn(),
  requireDraftAdmin: vi.fn(),
  requireFormatViewer: vi.fn(),
}));
vi.mock('@/lib/ruleset-studio/guards', () => ({
  requireRulesetViewer: vi.fn(),
  requireRulesetOwner: vi.fn(),
  assertRulesetUsable: vi.fn(),
}));

import { requireAnyAdmin, requireResourceAdmin } from '@/lib/auth/helpers';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { SessionPlayer } from '@/types/auth';
import { defineRunnable } from '../define';
import { uuidArg } from '../atoms';
import type { ToolContext } from '../types';

const PLAYER: SessionPlayer = {
  playerId: '11111111-1111-4111-8111-111111111111',
  name: 'Admin',
  isAdmin: false,
  isResourceAdmin: true,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
};
const ID = '22222222-2222-4222-8222-222222222222';
const ctx: ToolContext = {
  role: 'scoped',
  maxPhase: 5,
  offeredTools: [],
  conversationId: null,
  now: () => new Date('2026-10-26T10:00:00Z'),
  timeZone: 'Europe/Berlin',
  locale: 'en',
  ports: {},
};

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAnyAdmin).mockResolvedValue(PLAYER);
  vi.mocked(requireResourceAdmin).mockResolvedValue(PLAYER);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

const output = z.strictObject({ id: z.string(), count: z.number().int() });

function tool(execute: (args: { league_id: string }) => Promise<unknown>) {
  return defineRunnable('season', {
    name: 'sample_get',
    class: 'R',
    description: 'A sample tool used only by the test of the call path.',
    args: z.strictObject({ league_id: uuidArg('League id') }),
    phase: 0,
    guard: (args) => ({ kind: 'season', id: args.league_id }),
    output,
    execute: execute as never,
  });
}

describe('the call path of a runnable tool', () => {
  it('validates the arguments with the full constraints before the guard or the data is touched', async () => {
    const execute = vi.fn();
    const result = await tool(execute).run({ league_id: 'not-a-uuid' }, ctx);
    expect(result).toMatchObject({ ok: false, code: 'validation_failed' });
    expect(JSON.stringify(result)).toContain('league_id');
    expect(requireResourceAdmin).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(await tool(execute).run({ league_id: ID, extra: 1 }, ctx)).toMatchObject({ code: 'validation_failed' });
  });

  it('runs the guard first and reads nothing when it refuses', async () => {
    const execute = vi.fn();
    vi.mocked(requireResourceAdmin).mockRejectedValue(Object.assign(new Error('Admin access required for this resource'), { statusCode: 403, code: 'forbidden' }));
    expect(await tool(execute).run({ league_id: ID }, ctx)).toEqual({ ok: false, code: 'forbidden' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes the guarded token with the LIVE player to execute and returns the validated result', async () => {
    const execute = vi.fn(async (_args: unknown, guarded: unknown) => ({ id: (guarded as { player: SessionPlayer }).player.playerId, count: 2 }));
    const sample = defineRunnable('season', {
      name: 'sample_get',
      class: 'R',
      description: 'A sample tool used only by the test of the call path.',
      args: z.strictObject({ league_id: uuidArg('League id') }),
      phase: 0,
      guard: (args) => ({ kind: 'season', id: args.league_id }),
      output,
      execute: execute as never,
    });
    expect(await sample.run({ league_id: ID }, ctx)).toEqual({ ok: true, data: { id: PLAYER.playerId, count: 2 } });
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', ID);
  });

  it('fails closed on a result the strict output schema rejects, and logs paths, not values', async () => {
    const leaky = tool(async () => ({ id: 'a', count: 1, discord_id: 'discord-SECRET-111' }));
    const result = await leaky.run({ league_id: ID }, ctx);
    expect(result).toEqual({ ok: false, code: 'agent_harness_error' });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('discord-SECRET-111');
    expect(JSON.stringify(errorSpy.mock.calls)).toContain('sample_get');
  });

  it('never lets err.message reach the model: an unexpected error is a harness error with the text only in the log', async () => {
    const boom = tool(async () => {
      throw new Error('duplicate key value violates unique constraint "players_discord_id_key" (discord-SECRET-111)');
    });
    const result = await boom.run({ league_id: ID }, ctx);
    expect(result).toEqual({ ok: false, code: 'agent_harness_error' });
    expect(JSON.stringify(result)).not.toContain('constraint');
    expect(String((errorSpy.mock.calls[0][1] as Error).message)).toContain('players_discord_id_key');
  });

  it('forwards a domain error as its catalogued code and params', async () => {
    const missing = tool(async () => {
      throw new UserFacingError('League not found', { code: 'SEASON_NOT_FOUND', status: 404 });
    });
    expect(await missing.run({ league_id: ID }, ctx)).toEqual({ ok: false, code: 'SEASON_NOT_FOUND' });
    const limited = tool(async () => {
      throw new UserFacingError('Rate limit exceeded', { code: 'rate_limited', params: { seconds: 42 }, status: 429 });
    });
    expect(await limited.run({ league_id: ID }, ctx)).toEqual({ ok: false, code: 'rate_limited', params: { seconds: 42 } });
  });

  it('refuses a guard function that returns a different kind than the tool declares', async () => {
    const drifted = defineRunnable('season', {
      name: 'sample_get',
      class: 'R',
      description: 'A sample tool used only by the test of the call path.',
      args: z.strictObject({}),
      phase: 0,
      guard: () => ({ kind: 'any' }) as never,
      output,
      execute: vi.fn() as never,
    });
    expect(await drifted.run({}, ctx)).toEqual({ ok: false, code: 'agent_harness_error' });
    expect(requireAnyAdmin).not.toHaveBeenCalled();
  });
});
