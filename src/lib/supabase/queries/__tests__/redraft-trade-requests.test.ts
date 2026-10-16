import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabase } from '@/lib/__tests__/helpers/supabase-mock';

// ── Supabase mock ─────────────────────────────────────────────────────
vi.mock('@/lib/supabase/client', () => ({
  supabase: createMockSupabase(),
}));

import { supabase } from '@/lib/supabase/client';
import {
  createTradeRequest,
  getTradeRequest,
  getPendingTradeRequestsForPlayer,
  getPendingTradeRequestsForSeason,
  setConsent,
  executeTradeRequest,
  cancelTradeRequest,
  TradeRequestExecutionError,
  tradeRpcRejection,
  type TradeRpcRejection,
} from '../redraft-trade-requests';

type MockSupabase = ReturnType<typeof createMockSupabase>;
const mock = supabase as unknown as MockSupabase;

// ── Fixtures ──────────────────────────────────────────────────────────

const rowFixture = {
  id: 'tr-1',
  season_id: 's1',
  initiated_by: 'admin-1',
  player_a_id: 'pa',
  from_tracker_a_id: 'ta',
  line_a: 'Charmander',
  player_b_id: 'pb',
  from_tracker_b_id: 'tb',
  line_b: 'Bulbasaur',
  status: 'pending',
  consent_a: false,
  consent_b: false,
  created_at: '2026-08-13T00:00:00Z',
  executed_at: null,
  cancelled_at: null,
  cancelled_by: null,
  executed_tracker_ids: null,
};

describe('redraft-trade-requests query module', () => {
  beforeEach(() => {
    mock.__reset();
  });

  describe('createTradeRequest', () => {
    it('inserts a pending request with both consents false and returns it', async () => {
      mock.__setResult([rowFixture]);

      const result = await createTradeRequest({
        season_id: 's1',
        initiated_by: 'admin-1',
        player_a_id: 'pa',
        from_tracker_a_id: 'ta',
        line_a: 'Charmander',
        player_b_id: 'pb',
        from_tracker_b_id: 'tb',
        line_b: 'Bulbasaur',
      });

      // Inserted into the right table.
      expect(mock.from).toHaveBeenCalledWith('redraft_trade_requests');
      expect(mock.insert).toHaveBeenCalledTimes(1);
      const inserted = mock.insert.mock.calls[0][0];
      expect(inserted).toMatchObject({
        season_id: 's1',
        initiated_by: 'admin-1',
        player_a_id: 'pa',
        from_tracker_a_id: 'ta',
        line_a: 'Charmander',
        player_b_id: 'pb',
        from_tracker_b_id: 'tb',
        line_b: 'Bulbasaur',
        status: 'pending',
        consent_a: false,
        consent_b: false,
      });

      expect(result.id).toBe('tr-1');
      expect(result.status).toBe('pending');
    });

    it('propagates insert errors (callers map 23505 to 409)', async () => {
      const uniqueErr = Object.assign(new Error('duplicate'), { code: '23505' });
      mock.__setError(uniqueErr);

      await expect(
        createTradeRequest({
          season_id: 's1',
          initiated_by: 'admin-1',
          player_a_id: 'pa',
          from_tracker_a_id: 'ta',
          line_a: 'Charmander',
          player_b_id: 'pb',
          from_tracker_b_id: 'tb',
          line_b: 'Bulbasaur',
        })
      ).rejects.toThrow('duplicate');
    });
  });

  describe('getTradeRequest', () => {
    it('returns the row mapped to TradeRequest', async () => {
      mock.__setResult([rowFixture]);
      const result = await getTradeRequest('tr-1');
      expect(mock.from).toHaveBeenCalledWith('redraft_trade_requests');
      expect(mock.eq).toHaveBeenCalledWith('id', 'tr-1');
      expect(result?.id).toBe('tr-1');
    });

    it('returns null when no row matches (maybeSingle)', async () => {
      mock.__setResult([]);
      const result = await getTradeRequest('missing');
      expect(result).toBeNull();
    });
  });

  describe('getPendingTradeRequestsForPlayer', () => {
    it('filters by season, status=pending, and either player side', async () => {
      mock.__setResult([rowFixture]);
      await getPendingTradeRequestsForPlayer('s1', 'pa');
      expect(mock.from).toHaveBeenCalledWith('redraft_trade_requests');
      expect(mock.eq).toHaveBeenCalledWith('season_id', 's1');
      expect(mock.eq).toHaveBeenCalledWith('status', 'pending');
      expect(mock.or).toHaveBeenCalledWith('player_a_id.eq.pa,player_b_id.eq.pa');
    });
  });

  describe('getPendingTradeRequestsForSeason', () => {
    it('filters by season and status=pending', async () => {
      mock.__setResult([rowFixture]);
      await getPendingTradeRequestsForSeason('s1');
      expect(mock.eq).toHaveBeenCalledWith('season_id', 's1');
      expect(mock.eq).toHaveBeenCalledWith('status', 'pending');
    });
  });

  describe('setConsent', () => {
    it('flips consent_a to true for side a on a pending request', async () => {
      const consented = { ...rowFixture, consent_a: true };
      mock.__setResult([consented]);

      const result = await setConsent('tr-1', 'a');

      expect(mock.update).toHaveBeenCalledWith({ consent_a: true });
      expect(mock.eq).toHaveBeenCalledWith('id', 'tr-1');
      expect(mock.eq).toHaveBeenCalledWith('status', 'pending');
      expect(result?.consent_a).toBe(true);
    });

    it('flips consent_b to true for side b', async () => {
      const consented = { ...rowFixture, consent_b: true };
      mock.__setResult([consented]);
      const result = await setConsent('tr-1', 'b');
      expect(mock.update).toHaveBeenCalledWith({ consent_b: true });
      expect(result?.consent_b).toBe(true);
    });

    it('returns null when the request is no longer pending', async () => {
      mock.__setResult([]);
      const result = await setConsent('tr-1', 'a');
      expect(result).toBeNull();
    });
  });

  describe('executeTradeRequest', () => {
    const swaps = [
      {
        player_id: 'pa',
        from_tracker_id: 'ta',
        new_tracker: { base_pokemon: 'Bulbasaur' },
        history: { to_base_pokemon: 'Bulbasaur', points_spent: 0 },
      },
      {
        player_id: 'pb',
        from_tracker_id: 'tb',
        new_tracker: { base_pokemon: 'Charmander' },
        history: { to_base_pokemon: 'Charmander', points_spent: 0 },
      },
    ] as never;

    it('invokes the epb_execute_trade_request RPC with the request id + swaps and returns the new tracker ids', async () => {
      mock.__setResult(['new-ta', 'new-tb']);

      const result = await executeTradeRequest('tr-1', swaps);

      expect(mock.rpc).toHaveBeenCalledWith('epb_execute_trade_request', {
        p_request_id: 'tr-1',
        p_swaps: expect.arrayContaining([
          expect.objectContaining({ player_id: 'pa', from_tracker_id: 'ta' }),
          expect.objectContaining({ player_id: 'pb', from_tracker_id: 'tb' }),
        ]),
      });
      expect(result).toEqual(['new-ta', 'new-tb']);
    });

    it('returns [] when the RPC returns no ids', async () => {
      mock.__setResult(null as never);
      const result = await executeTradeRequest('tr-1', swaps);
      expect(result).toEqual([]);
    });

    it('maps a P0001 RPC failure to TradeRequestExecutionError carrying the message', async () => {
      const rpcErr = Object.assign(new Error('phase_closed'), { code: 'P0001' });
      mock.__setError(rpcErr);

      await expect(executeTradeRequest('tr-1', swaps)).rejects.toMatchObject({
        name: 'TradeRequestExecutionError',
        message: 'phase_closed',
        rpcCode: 'P0001',
        code: 'redraft_phase_not_open',
      });
      // The typed error is an instance of the declared class.
      await expect(executeTradeRequest('tr-1', swaps)).rejects.toBeInstanceOf(
        TradeRequestExecutionError
      );
    });

    it('rethrows a non-P0001 Postgres error verbatim (no mapping)', async () => {
      const otherErr = Object.assign(new Error('boom'), { code: '23505' });
      mock.__setError(otherErr);

      await expect(executeTradeRequest('tr-1', swaps)).rejects.toBe(otherErr);
    });
  });

  describe('tradeRpcRejection', () => {
    it.each([
      ['Trade request not found', { code: 'trade_request_not_found' }],
      ['request_not_executable', { code: 'trade_request_not_executable' }],
      ['phase_closed', { code: 'redraft_phase_not_open' }],
      ['multiple_draft_pools', { code: 'trade_multiple_draft_pools' }],
      ['insufficient_points', { code: 'trade_insufficient_points' }],
      [
        'Source tracker 3f0c not found for this player in this season',
        { code: 'trade_source_tracker_unavailable' },
      ],
      [
        'Line Charmander is already owned by another player',
        { code: 'trade_line_already_owned', params: { pokemon: 'Charmander' } },
      ],
      ['something new', { code: 'trade_execution_rejected', params: { reason: 'something new' } }],
    ] as [string, TradeRpcRejection][])('maps the RPC reason %j to its catalog code', (message, expected) => {
      expect(tradeRpcRejection(message)).toEqual(expected);
      const err = new TradeRequestExecutionError(message, 'P0001');
      expect(err.code).toBe(expected.code);
      expect(err.params).toEqual(expected.params);
    });
  });

  describe('cancelTradeRequest', () => {
    it('cancels a pending request and records cancelled_by', async () => {
      const cancelled = {
        ...rowFixture,
        status: 'cancelled',
        cancelled_at: '2026-08-13T01:00:00Z',
        cancelled_by: 'pa',
      };
      mock.__setResult([cancelled]);
      const result = await cancelTradeRequest('tr-1', 'pa');
      expect(mock.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'cancelled', cancelled_by: 'pa' })
      );
      expect(mock.eq).toHaveBeenCalledWith('id', 'tr-1');
      expect(mock.eq).toHaveBeenCalledWith('status', 'pending');
      expect(result?.status).toBe('cancelled');
      expect(result?.cancelled_by).toBe('pa');
    });

    it('returns null when the request is no longer pending', async () => {
      mock.__setResult([]);
      const result = await cancelTradeRequest('tr-1', 'pa');
      expect(result).toBeNull();
    });
  });
});