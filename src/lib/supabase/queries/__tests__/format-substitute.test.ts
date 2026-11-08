/**
 * The seat handover of a substitution (`format_substitute_seat`, 20261106090000_format_challenges.sql): the exact arguments of
 * the RPC wrapper, the answer read defensively, and the collision signals mapped to `FormatSubstituteError` (409, one code per
 * kind, each in the seasons catalog in English and German). The behaviour of the function itself is proved against a local
 * stack in `format-substitute.local.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rpcCalls: [] as { name: string; args: unknown }[],
  rpcReply: null as null | { data?: unknown; error?: unknown },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null, ...(state.rpcReply ?? {}) });
    },
  },
}));

import {
  FORMAT_SUBSTITUTE_ERROR_CODES,
  FormatSubstituteError,
  mapFormatSubstituteDbError,
  moveFormatSeat,
  noFormatSeatMove,
  parseFormatSeatMove,
} from '../format-substitute';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { UserFacingError } from '@/lib/api/user-facing-error';

const SEASON = '3f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5b';
const OUT = '4f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5c';
const IN = '5f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5d';
const PHASE = '6f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5e';

const signal = (message: string) => ({ code: 'P0001', message, details: null });

beforeEach(() => {
  state.rpcCalls.length = 0;
  state.rpcReply = null;
});

describe('moveFormatSeat', () => {
  it('calls format_substitute_seat with the league, both players, the scope, the handed-over phases and the dry-run flag', async () => {
    state.rpcReply = {
      data: {
        attached: true,
        moved: true,
        kept_phase_ids: [],
        rows: { relation_links: 2, resource_items: 1, action_submissions: 1, player_attrs: 0, track_progress: 3, challenges: 1 },
        total: 8,
      },
    };

    const result = await moveFormatSeat({ seasonId: SEASON, outPlayerId: OUT, inPlayerId: IN, leagueScope: false, phaseIds: [PHASE], dryRun: true });

    expect(state.rpcCalls).toEqual([
      {
        name: 'format_substitute_seat',
        args: { p_season_id: SEASON, p_out: OUT, p_in: IN, p_league_scope: false, p_phase_ids: [PHASE], p_dry_run: true },
      },
    ]);
    expect(result).toEqual({
      attached: true,
      moved: true,
      kept_phase_ids: [],
      rows: { relation_links: 2, resource_items: 1, action_submissions: 1, player_attrs: 0, track_progress: 3, challenges: 1 },
      total: 8,
    });
  });

  it('reads a seat that stays: not moved, the phases the player keeps', async () => {
    state.rpcReply = { data: { attached: true, moved: false, kept_phase_ids: [PHASE], rows: {}, total: 0 } };

    const result = await moveFormatSeat({ seasonId: SEASON, outPlayerId: OUT, inPlayerId: IN, leagueScope: false, phaseIds: [PHASE], dryRun: false });

    expect(result).toMatchObject({ attached: true, moved: false, kept_phase_ids: [PHASE], total: 0 });
    expect(result.rows).toEqual(noFormatSeatMove().rows);
  });

  it('answers a league without a format as nothing to move', async () => {
    state.rpcReply = { data: { attached: false, moved: false, kept_phase_ids: [], rows: {}, total: 0 } };

    await expect(
      moveFormatSeat({ seasonId: SEASON, outPlayerId: OUT, inPlayerId: IN, leagueScope: true, phaseIds: [], dryRun: false }),
    ).resolves.toEqual(noFormatSeatMove());
  });

  it('turns each collision signal into its own FormatSubstituteError with status 409', async () => {
    for (const code of FORMAT_SUBSTITUTE_ERROR_CODES) {
      state.rpcReply = { error: signal(code) };

      const error = await moveFormatSeat({ seasonId: SEASON, outPlayerId: OUT, inPlayerId: IN, leagueScope: true, phaseIds: [], dryRun: false }).catch(
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(FormatSubstituteError);
      expect(error).toMatchObject({ code, statusCode: 409, message: errorsSeasons.en[code] });
    }
  });

  it('leaves an error that is not a collision as it is', async () => {
    const unknown = { code: '57014', message: 'canceling statement due to statement timeout', details: null };
    state.rpcReply = { error: unknown };

    const error = await moveFormatSeat({ seasonId: SEASON, outPlayerId: OUT, inPlayerId: IN, leagueScope: true, phaseIds: [], dryRun: false }).catch(
      (err: unknown) => err,
    );

    expect(error).not.toBeInstanceOf(FormatSubstituteError);
    expect(error).toBe(unknown);
  });
});

describe('mapFormatSubstituteDbError', () => {
  it('maps only a P0001 whose message is one of its codes', () => {
    expect(mapFormatSubstituteDbError(signal('format_substitute_items_collide'))).toBeInstanceOf(FormatSubstituteError);
    expect(mapFormatSubstituteDbError({ code: '23505', message: 'format_substitute_items_collide' })).not.toBeInstanceOf(FormatSubstituteError);
    expect(mapFormatSubstituteDbError(signal('something_else'))).not.toBeInstanceOf(FormatSubstituteError);
  });

  it('keeps the runtime signals working through it (a stale format is still format_context_stale)', () => {
    const mapped = mapFormatSubstituteDbError(signal('format_context_stale'));
    expect(mapped).toBeInstanceOf(UserFacingError);
    expect(mapped).toMatchObject({ code: 'format_context_stale' });
  });
});

describe('the catalog', () => {
  it('has a German text for every collision and the kept-seat warning, with the same placeholders', async () => {
    const { default: de } = await import('@/i18n/messages/errors/seasons/de');
    const keys = [...FORMAT_SUBSTITUTE_ERROR_CODES, 'substitute_format_seat_kept'] as const;
    for (const key of keys) {
      const en = errorsSeasons.en[key];
      const german = (de as Record<string, unknown>)[key];
      expect(typeof en).toBe('string');
      expect(typeof german).toBe('string');
      expect((german as string).match(/\{\w+\}/g) ?? []).toEqual((en as string).match(/\{\w+\}/g) ?? []);
    }
  });
});

describe('parseFormatSeatMove', () => {
  it('reads a missing or malformed answer as a league without a format', () => {
    expect(parseFormatSeatMove(null)).toEqual(noFormatSeatMove());
    expect(parseFormatSeatMove('x')).toEqual(noFormatSeatMove());
    expect(parseFormatSeatMove([])).toEqual(noFormatSeatMove());
  });
});
