import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getPhaseMatchById: vi.fn(),
  assertMayRecordPhaseResult: vi.fn(),
  recordGameResult: vi.fn(),
  createPhaseMomentsBatch: vi.fn(),
  emitPhaseResultEffects: vi.fn(),
  logAuditEvent: vi.fn(),
  revalidatePhaseMatchPages: vi.fn(),
  expireSeasonReads: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: h.getPhaseMatchById }));
vi.mock('@/lib/auth/phase-access', () => ({ assertMayRecordPhaseResult: h.assertMayRecordPhaseResult }));
vi.mock('@/lib/supabase/queries/phase-broadcast-moments', () => ({ createPhaseMomentsBatch: h.createPhaseMomentsBatch }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: h.logAuditEvent }));
vi.mock('@/lib/revalidation', () => ({
  revalidatePhaseMatchPages: h.revalidatePhaseMatchPages,
  expireSeasonReads: h.expireSeasonReads,
}));
vi.mock('../services', () => ({
  createNativePhaseServices: vi.fn(() => ({ matches: { recordGameResult: h.recordGameResult } })),
}));
vi.mock('../result-effects', () => ({ emitPhaseResultEffects: h.emitPhaseResultEffects }));

import { recordNativeManualResult } from '../manual-result';
import type { manualResultSchema } from '@/lib/validation';
import type { z } from 'zod';

const PHASE_ID = '33333333-3333-4333-8333-333333333333';
const SEASON_ID = '44444444-4444-4444-8444-444444444444';
const MATCH_ID = '12345678-1234-4123-8123-123456789abc';
const P1_ID = '11111111-1111-4111-8111-111111111111';
const P2_ID = '22222222-2222-4222-8222-222222222222';

const owner = { kind: 'phase' as const, phase_id: PHASE_ID, season_id: SEASON_ID };
const match = {
  id: MATCH_ID,
  phase_id: PHASE_ID,
  player_1_id: P1_ID,
  player_2_id: P2_ID,
  player_1_name: 'Alice',
  player_2_name: 'Bob',
};
const player = { playerId: P1_ID, name: 'Alice', isAdmin: false } as never;
const body = {
  match_id: MATCH_ID,
  winner_id: P1_ID,
  pokemon_stats: [
    { player_id: P1_ID, pokemon: [{ pokemon_name: 'Pikachu', kos_dealt: 2 }] },
    { player_id: P2_ID, pokemon: [{ pokemon_name: 'Charizard' }] },
  ],
} as z.infer<typeof manualResultSchema>;
const invalidateMatch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  h.getPhaseMatchById.mockResolvedValue(match);
  h.assertMayRecordPhaseResult.mockResolvedValue({ asAdmin: false });
  h.recordGameResult.mockResolvedValue({ game_id: 'g-1', bo_reached: false });
});

describe('recordNativeManualResult', () => {
  it('audits a player report as a game.player_report row keyed to the phase match and game', async () => {
    await recordNativeManualResult(owner, player, body, invalidateMatch);

    expect(h.logAuditEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        actor_id: P1_ID,
        actor_name: 'Alice',
        action: 'game.player_report',
        resource_type: 'phase_game',
        resource_id: 'g-1',
        resource_name: 'Alice vs Bob',
        metadata: {
          match_id: MATCH_ID,
          phase_id: PHASE_ID,
          season_id: SEASON_ID,
          winner_id: P1_ID,
          source: 'manual',
        },
      })
    );
  });

  it('writes no audit row when the result was never recorded', async () => {
    h.recordGameResult.mockRejectedValue(new Error('db'));

    await expect(recordNativeManualResult(owner, player, body, invalidateMatch)).rejects.toThrow('db');
    expect(h.logAuditEvent).not.toHaveBeenCalled();
  });
});
