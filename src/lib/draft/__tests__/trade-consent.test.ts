import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { safeErrorResponse } from '@/lib/api/error-response';
import { TradeConsentError, createPendingTradeRequest, resolveTradeSides } from '@/lib/draft/trade-consent';

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getListEntries: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/redraft-trade-requests', () => ({
  createTradeRequest: vi.fn(),
}));

import { getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { createTradeRequest } from '@/lib/supabase/queries/redraft-trade-requests';

const tracker = (id: string, playerId: string, base: string) => ({
  id,
  season_id: 'season-1',
  player_id: playerId,
  base_pokemon: base,
});

const entry = (base: string, specialRules: string[] = []) => ({
  id: `entry-${base}`,
  list_version_id: 'lv-1',
  base_pokemon: base,
  price: 10,
  special_rules: specialRules,
});

describe('TradeConsentError', () => {
  it('extends UserFacingError so safeErrorResponse passes it through', () => {
    const err = new TradeConsentError('The offered line A cannot be traded', 409);
    expect(err).toBeInstanceOf(UserFacingError);
    expect(err.name).toBe('TradeConsentError');
    expect(err.message).toBe('The offered line A cannot be traded');
    expect(err.statusCode).toBe(409);
  });

  it('defaults to status 400', () => {
    expect(new TradeConsentError('nope').statusCode).toBe(400);
  });

  it('safeErrorResponse returns the specific message and status', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = safeErrorResponse(
        new TradeConsentError('Source tracker for player A not found', 404),
        'Failed to initiate trade request'
      );
      const json = await res.json();
      expect(res.status).toBe(404);
      expect(json.error).toBe('Source tracker for player A not found');
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('resolveTradeSides', () => {
  beforeEach(() => {
    vi.mocked(getSeasonTrackers).mockResolvedValue([
      tracker('t-1', 'player-a', 'Charmander') as never,
      tracker('t-2', 'player-b', 'Poliwag') as never,
    ]);
    vi.mocked(getListEntries).mockResolvedValue([
      entry('Charmander'),
      entry('Poliwag'),
    ] as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects with TradeConsentError (404) when a tracker does not exist', async () => {
    await expect(
      resolveTradeSides('season-1', 'player-a', 'missing', 'player-b', 't-2', 'lv-1')
    ).rejects.toMatchObject({ name: 'TradeConsentError', statusCode: 404 });
  });

  it('rejects with TradeConsentError (403) on tracker ownership mismatch', async () => {
    await expect(
      resolveTradeSides('season-1', 'player-b', 't-1', 'player-a', 't-2', 'lv-1')
    ).rejects.toMatchObject({ name: 'TradeConsentError', statusCode: 403 });
  });

  it('codes every refusal with its errors/draft-legacy key and the side', async () => {
    await expect(
      resolveTradeSides('season-1', 'player-a', 'missing', 'player-b', 't-2', 'lv-1')
    ).rejects.toMatchObject({ code: 'trade_source_tracker_not_found', params: { side: 'A' } });
    await expect(
      resolveTradeSides('season-1', 'player-a', 't-1', 'player-b', 'missing', 'lv-1')
    ).rejects.toMatchObject({ code: 'trade_source_tracker_not_found', params: { side: 'B' } });
    await expect(
      resolveTradeSides('season-1', 'player-b', 't-1', 'player-a', 't-2', 'lv-1')
    ).rejects.toMatchObject({
      message: 'The offered line A does not belong to player A',
      code: 'trade_line_not_owned',
      params: { side: 'A' },
    });
    await expect(
      resolveTradeSides('season-1', 'player-a', 't-1', 'player-a', 't-2', 'lv-1')
    ).rejects.toMatchObject({ code: 'trade_line_not_owned', params: { side: 'B' } });
  });

  it('codes a line missing from the bound list and an untradeable line', async () => {
    vi.mocked(getListEntries).mockResolvedValue([entry('Poliwag')] as never);
    await expect(
      resolveTradeSides('season-1', 'player-a', 't-1', 'player-b', 't-2', 'lv-1')
    ).rejects.toMatchObject({ statusCode: 400, code: 'trade_line_not_in_list', params: { side: 'A' } });

    vi.mocked(getListEntries).mockResolvedValue([
      entry('Charmander'),
      { ...entry('Poliwag'), special_rules: { no_redraft: true } },
    ] as never);
    await expect(
      resolveTradeSides('season-1', 'player-a', 't-1', 'player-b', 't-2', 'lv-1')
    ).rejects.toMatchObject({
      message: 'Poliwag cannot be traded',
      code: 'trade_line_untradeable',
      params: { pokemon: 'Poliwag' },
    });
  });
});

describe('createPendingTradeRequest', () => {
  const sides = {
    sideA: { player_id: 'player-a', from_tracker_id: 't-1', line: 'Charmander', entry: entry('Charmander') },
    sideB: { player_id: 'player-b', from_tracker_id: 't-2', line: 'Poliwag', entry: entry('Poliwag') },
  } as never;

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('codes a pending-trade clash (23505) and a vanished line (23503) as 409s', async () => {
    vi.mocked(createTradeRequest).mockRejectedValueOnce({ code: '23505' });
    await expect(createPendingTradeRequest('season-1', 'admin', sides)).rejects.toMatchObject({
      statusCode: 409,
      message: 'One of these lines already has a pending trade',
      code: 'trade_line_pending',
    });
    vi.mocked(createTradeRequest).mockRejectedValueOnce({ code: '23503' });
    await expect(createPendingTradeRequest('season-1', 'admin', sides)).rejects.toMatchObject({
      statusCode: 409,
      message: 'A selected line is no longer available',
      code: 'trade_line_gone',
    });
  });
});
