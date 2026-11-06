/**
 * The challenge-ladder queries (`format_challenges`, 20261106090000_format_challenges.sql): the domain signals of the
 * `format_challenge_*` functions mapped to `FormatChallengeError` (one status per code), the exact arguments of each RPC
 * wrapper, the `challenge_expired` a late response raises, and the reads' uuid and filter handling.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Step = [string, ...unknown[]];

const state = vi.hoisted(() => ({
  calls: [] as { table: string; steps: Step[] }[],
  rpcCalls: [] as { name: string; args: unknown }[],
  respond: null as null | ((call: { table: string; steps: Step[] }) => { data?: unknown; error?: unknown }),
  rpcReply: null as null | { data?: unknown; error?: unknown },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, steps: [] as Step[] };
      state.calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'or', 'order', 'range', 'maybeSingle']) {
        chain[name] = (...args: unknown[]) => {
          call.steps.push([name, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null, ...(state.respond?.(call) ?? {}) });
      return chain;
    },
    rpc: (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null, ...(state.rpcReply ?? {}) });
    },
  },
}));

import {
  FORMAT_CHALLENGE_ERROR_CODES,
  FormatChallengeError,
  cancelFormatChallenge,
  createFormatChallenge,
  expireFormatChallenges,
  getFormatChallenge,
  listFormatChallenges,
  mapFormatChallengeDbError,
  respondToFormatChallenge,
  type FormatChallengeErrorCode,
} from '../format-challenges';
import { UserFacingError } from '@/lib/api/user-facing-error';

const SEASON = '3f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5b';
const PHASE = '6f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5e';
const P1 = '4f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5c';
const P2 = '5f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5d';
const CHALLENGE = '7f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5f';

/** The HTTP status each code answers with: a refusal the player can act on carries its class. */
const EXPECTED_STATUS: Record<FormatChallengeErrorCode, number> = {
  challenge_self: 400,
  challenge_phase_not_found: 404,
  challenge_phase_closed: 409,
  challenge_not_participant: 400,
  challenge_no_open_round: 409,
  challenge_rank_range: 400,
  challenge_max_open: 409,
  challenge_already_open: 409,
  challenge_cooldown: 409,
  challenge_not_found: 404,
  challenge_not_defender: 403,
  challenge_not_challenger: 403,
  challenge_not_open: 409,
  challenge_expired: 409,
  challenge_not_ladder: 409,
};

const signal = (message: string, code = 'P0001') => ({ code, message, details: null });

const row = (over: Record<string, unknown> = {}) => ({
  id: CHALLENGE,
  season_id: SEASON,
  phase_id: PHASE,
  challenger_id: P1,
  defender_id: P2,
  status: 'open',
  round: 2,
  created_at: 't',
  expires_at: 't2',
  responded_at: null,
  match_id: null,
  ...over,
});

const stepsOf = (call: { steps: Step[] }, name: string) => call.steps.filter(([step]) => step === name);

beforeEach(() => {
  state.calls.length = 0;
  state.rpcCalls.length = 0;
  state.respond = null;
  state.rpcReply = null;
});

describe('mapFormatChallengeDbError', () => {
  it('maps every signal code to a typed, user-facing error with its own status', () => {
    expect([...FORMAT_CHALLENGE_ERROR_CODES].sort()).toEqual(Object.keys(EXPECTED_STATUS).sort());
    for (const code of FORMAT_CHALLENGE_ERROR_CODES) {
      const mapped = mapFormatChallengeDbError(signal(code));
      expect(mapped, code).toBeInstanceOf(FormatChallengeError);
      const error = mapped as FormatChallengeError;
      expect(error).toBeInstanceOf(UserFacingError);
      expect(error.code, code).toBe(code);
      expect(error.statusCode, code).toBe(EXPECTED_STATUS[code]);
      expect(error.message.length, code).toBeGreaterThan(0);
    }
  });

  it('matches the SQLSTATE and the message, never a signal word outside the ladder', () => {
    // Right word, wrong SQLSTATE: not this module's signal.
    expect(mapFormatChallengeDbError(signal('challenge_self', '23505'))).not.toBeInstanceOf(FormatChallengeError);
    // Unknown P0001 (a planner bug) and a non-object error pass through unchanged.
    const invalidOp = signal('invalid_op');
    expect(mapFormatChallengeDbError(invalidOp)).toBe(invalidOp);
    expect(mapFormatChallengeDbError('boom')).toBe('boom');
  });
});

describe('the RPC wrappers', () => {
  it('createFormatChallenge passes the ten arguments and returns the row', async () => {
    state.rpcReply = { data: row() };
    await expect(
      createFormatChallenge({
        seasonId: SEASON,
        phaseId: PHASE,
        challengerId: P1,
        defenderId: P2,
        challengerRank: 3,
        defenderRank: 1,
        rankRange: 3,
        maxOpen: 2,
        cooldownRounds: 1,
        acceptWindowHours: 72,
      }),
    ).resolves.toMatchObject({ status: 'open', challenger_id: P1 });

    expect(state.rpcCalls).toEqual([
      {
        name: 'format_challenge_create',
        args: {
          p_season_id: SEASON,
          p_phase_id: PHASE,
          p_challenger: P1,
          p_defender: P2,
          p_challenger_rank: 3,
          p_defender_rank: 1,
          p_rank_range: 3,
          p_max_open: 2,
          p_cooldown_rounds: 1,
          p_accept_window_hours: 72,
        },
      },
    ]);
  });

  it('throws the mapped error when the create is refused', async () => {
    state.rpcReply = { error: signal('challenge_max_open') };
    await expect(
      createFormatChallenge({
        seasonId: SEASON,
        phaseId: PHASE,
        challengerId: P1,
        defenderId: P2,
        challengerRank: 2,
        defenderRank: 1,
        rankRange: 1,
        maxOpen: 1,
        cooldownRounds: 0,
        acceptWindowHours: 24,
      }),
    ).rejects.toMatchObject({ name: 'FormatChallengeError', code: 'challenge_max_open', statusCode: 409 });
  });

  it('answers a challenge and returns the accepted row', async () => {
    state.rpcReply = { data: row({ status: 'accepted', match_id: 'm-1', responded_at: 't3' }) };
    await expect(respondToFormatChallenge({ seasonId: SEASON, challengeId: CHALLENGE, playerId: P2, accept: true })).resolves.toMatchObject({
      status: 'accepted',
      match_id: 'm-1',
    });
    expect(state.rpcCalls).toEqual([
      { name: 'format_challenge_respond', args: { p_season_id: SEASON, p_challenge_id: CHALLENGE, p_player: P2, p_accept: true } },
    ]);
  });

  it('raises challenge_expired for a response after the accept window (the row is stored as expired)', async () => {
    state.rpcReply = { data: row({ status: 'expired', responded_at: 't3' }) };
    await expect(respondToFormatChallenge({ seasonId: SEASON, challengeId: CHALLENGE, playerId: P2, accept: true })).rejects.toMatchObject({
      name: 'FormatChallengeError',
      code: 'challenge_expired',
      statusCode: 409,
    });
  });

  it('cancels for the challenger, and for an admin with a NULL player', async () => {
    state.rpcReply = { data: row({ status: 'cancelled' }) };
    await expect(cancelFormatChallenge(SEASON, CHALLENGE, P1)).resolves.toMatchObject({ status: 'cancelled' });
    await expect(cancelFormatChallenge(SEASON, CHALLENGE, null)).resolves.toMatchObject({ status: 'cancelled' });
    // The league is part of the call: a challenge id of another league is challenge_not_found.
    expect(state.rpcCalls.map((call) => call.args)).toEqual([
      { p_season_id: SEASON, p_challenge_id: CHALLENGE, p_player: P1 },
      { p_season_id: SEASON, p_challenge_id: CHALLENGE, p_player: null },
    ]);
  });

  it('expires one league or all of them and returns the count', async () => {
    state.rpcReply = { data: 3 };
    await expect(expireFormatChallenges(SEASON)).resolves.toBe(3);
    await expect(expireFormatChallenges(null)).resolves.toBe(3);
    expect(state.rpcCalls.map((call) => call.args)).toEqual([{ p_season_id: SEASON }, { p_season_id: null }]);
  });

  it('maps a refusal of the cancel, not just of the create', async () => {
    state.rpcReply = { error: signal('challenge_not_challenger') };
    await expect(cancelFormatChallenge(SEASON, CHALLENGE, P2)).rejects.toMatchObject({ code: 'challenge_not_challenger', statusCode: 403 });
  });
});

describe('the reads', () => {
  it('reads a league’s challenges oldest first, one request for a short page', async () => {
    state.respond = () => ({ data: [row()] });
    const rows = await listFormatChallenges(SEASON);
    expect(rows).toHaveLength(1);
    expect(state.calls).toHaveLength(1);
    const [call] = state.calls;
    expect(call.table).toBe('format_challenges');
    expect(stepsOf(call, 'eq')).toEqual([['eq', 'season_id', SEASON]]);
    expect(stepsOf(call, 'order')).toEqual([
      ['order', 'created_at'],
      ['order', 'id'],
    ]);
    expect(stepsOf(call, 'range')).toEqual([['range', 0, 999]]);
    expect(stepsOf(call, 'or')).toEqual([]);
  });

  it('narrows by phase, status and player', async () => {
    await listFormatChallenges(SEASON, { phaseId: PHASE, status: 'accepted', playerId: P1 });
    const [call] = state.calls;
    expect(stepsOf(call, 'eq')).toEqual([
      ['eq', 'season_id', SEASON],
      ['eq', 'phase_id', PHASE],
      ['eq', 'status', 'accepted'],
    ]);
    expect(stepsOf(call, 'or')).toEqual([['or', `challenger_id.eq.${P1},defender_id.eq.${P1}`]]);
  });

  it('returns nothing for an id that is not a uuid, without a request', async () => {
    await expect(listFormatChallenges('nope')).resolves.toEqual([]);
    await expect(listFormatChallenges(SEASON, { phaseId: 'nope' })).resolves.toEqual([]);
    await expect(listFormatChallenges(SEASON, { playerId: 'nope' })).resolves.toEqual([]);
    await expect(getFormatChallenge('nope')).resolves.toBeNull();
    expect(state.calls).toEqual([]);
  });

  it('reads one challenge by id and throws a failed read', async () => {
    state.respond = () => ({ data: row() });
    await expect(getFormatChallenge(CHALLENGE)).resolves.toMatchObject({ id: CHALLENGE });
    expect(state.calls[0].table).toBe('format_challenges');
    expect(stepsOf(state.calls[0], 'eq')).toEqual([['eq', 'id', CHALLENGE]]);

    state.calls.length = 0;
    const boom = { message: 'boom' };
    state.respond = () => ({ error: boom });
    await expect(getFormatChallenge(CHALLENGE)).rejects.toBe(boom);
  });
});
