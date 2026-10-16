import { beforeEach, describe, expect, it, vi } from 'vitest';

const chainMethods = [
  'from', 'select', 'insert', 'update', 'delete', 'eq', 'lte', 'or', 'order', 'limit',
];

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    'from', 'select', 'insert', 'update', 'delete', 'eq', 'lte', 'or', 'order', 'limit',
  ]) {
    mb[method] = vi.fn().mockReturnValue(mb);
  }
  mb.single = vi.fn();
  mb.maybeSingle = vi.fn();
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockBuilder,
}));

vi.mock('@/lib/utils/uuid', () => ({
  assertValidUuid: vi.fn(),
}));

import {
  acceptMatchProposal,
  cancelPendingMatchProposalsForMatch,
  createMatchProposal,
  listMatchProposals,
  listPendingMatchProposalsForPlayer,
} from '../match-proposals';

const proposalRow = {
  id: 'proposal-1',
  match_id: 'match-1',
  proposer_id: 'player-1',
  responder_id: 'player-2',
  proposed_at: '2026-05-21T18:00:00Z',
  message: 'Evening works',
  status: 'pending',
  expires_at: '2026-05-22T18:00:00Z',
  responded_at: null,
  created_at: '2026-05-21T00:00:00Z',
  updated_at: '2026-05-21T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const method of chainMethods) {
    mockBuilder[method].mockReturnValue(mockBuilder);
  }
});

describe('queries/match-proposals', () => {
  it('creates a match proposal', async () => {
    mockBuilder.single.mockResolvedValue({ data: proposalRow, error: null });

    const result = await createMatchProposal({
      match_id: 'match-1',
      proposer_id: 'player-1',
      responder_id: 'player-2',
      proposed_at: '2026-05-21T18:00:00Z',
      expires_at: '2026-05-22T18:00:00Z',
      message: 'Evening works',
    });

    expect(result.id).toBe('proposal-1');
    expect(mockBuilder.from).toHaveBeenCalledWith('match_proposals');
    expect(mockBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      match_id: 'match-1',
      proposer_id: 'player-1',
      responder_id: 'player-2',
    }));
  });

  it('lists proposals for a match with proposer and responder names', async () => {
    mockBuilder.order.mockReturnValue({
      data: [{ ...proposalRow, proposer: { name: 'Alice' }, responder: { name: 'Bob' } }],
      error: null,
    });

    const result = await listMatchProposals('match-1');

    expect(result[0].proposer_name).toBe('Alice');
    expect(result[0].responder_name).toBe('Bob');
    expect(mockBuilder.eq).toHaveBeenCalledWith('match_id', 'match-1');
  });

  it('lists pending proposals for either side of a player match', async () => {
    mockBuilder.order.mockReturnValue({ data: [], error: null });

    await listPendingMatchProposalsForPlayer('player-1');

    expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'pending');
    expect(mockBuilder.or).toHaveBeenCalledWith('proposer_id.eq.player-1,responder_id.eq.player-1');
    expect(mockBuilder.order).toHaveBeenCalledWith('expires_at', { ascending: true });
  });

  it('accepts a pending proposal with responded_at metadata', async () => {
    mockBuilder.single.mockResolvedValue({ data: { ...proposalRow, status: 'accepted', responded_at: 'now' }, error: null });

    const result = await acceptMatchProposal('proposal-1');

    expect(result.status).toBe('accepted');
    expect(mockBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'accepted' }));
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'proposal-1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'pending');
  });

  it('cancels pending proposals for a repaired or reset match', async () => {
    mockBuilder.select.mockReturnValue({ data: [{ ...proposalRow, status: 'cancelled', responded_at: 'now' }], error: null });

    const result = await cancelPendingMatchProposalsForMatch('match-1');

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('cancelled');
    expect(mockBuilder.eq).toHaveBeenCalledWith('match_id', 'match-1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'pending');
  });
});