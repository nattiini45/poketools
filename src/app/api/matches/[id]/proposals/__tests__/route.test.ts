import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/match-proposals', () => ({
  createMatchProposal: vi.fn(),
  getPendingProposalForParticipant: vi.fn(),
  listMatchProposals: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { GET, POST } from '@/app/api/matches/[id]/proposals/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { createMatchProposal, getPendingProposalForParticipant, listMatchProposals } from '@/lib/supabase/queries/match-proposals';
import { logAuditEvent } from '@/lib/audit/log';

const player = { playerId: 'player-1', name: 'Alice' };
const match = {
  id: 'match-1',
  tournament_id: 'tournament-1',
  player_1_id: 'player-1',
  player_2_id: 'player-2',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  status: 'scheduled',
};
const proposal = {
  id: 'proposal-1',
  match_id: 'match-1',
  proposer_id: 'player-1',
  responder_id: 'player-2',
  proposed_at: '2099-05-21T18:00:00.000Z',
  message: 'Evening works',
  status: 'pending',
  expires_at: '2099-05-22T18:00:00.000Z',
  responded_at: null,
  created_at: '2026-05-21T00:00:00Z',
  updated_at: '2026-05-21T00:00:00Z',
};
const params = { params: Promise.resolve({ id: 'match-1' }) };

function request(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

describe('match proposal list/create route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(player as never);
    vi.mocked(getMatchById).mockResolvedValue(match as never);
    vi.mocked(getPendingProposalForParticipant).mockResolvedValue(null);
    vi.mocked(createMatchProposal).mockResolvedValue(proposal as never);
    vi.mocked(listMatchProposals).mockResolvedValue([]);
  });

  it('lists proposals for match participants', async () => {
    vi.mocked(listMatchProposals).mockResolvedValueOnce([{ ...proposal, proposer_name: 'Alice', responder_name: 'Bob' }] as never);

    const res = await GET({} as NextRequest, params);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(listMatchProposals).toHaveBeenCalledWith('match-1');
  });

  it('creates a future proposal and audits it', async () => {
    const res = await POST(request({ proposed_at: '2099-05-21T18:00:00.000Z', message: 'Evening works' }), params);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(createMatchProposal).toHaveBeenCalledWith(expect.objectContaining({
      match_id: 'match-1',
      proposer_id: 'player-1',
      responder_id: 'player-2',
      proposed_at: '2099-05-21T18:00:00.000Z',
    }));
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'match.proposal.create' }));
  });

  it('rejects proposal creation by non-participants', async () => {
    vi.mocked(requirePlayer).mockResolvedValueOnce({ playerId: 'outsider', name: 'Outsider' } as never);

    const res = await POST(request({ proposed_at: '2099-05-21T18:00:00.000Z' }), params);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.code).toBe('match_proposal_participants_only');
    expect(createMatchProposal).not.toHaveBeenCalled();
  });

  it('rejects duplicate active proposals for either participant', async () => {
    vi.mocked(getPendingProposalForParticipant)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(proposal as never);

    const res = await POST(request({ proposed_at: '2099-05-21T18:00:00.000Z' }), params);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('pending proposal');
    expect(body.code).toBe('match_proposal_pending_exists');
    expect(createMatchProposal).not.toHaveBeenCalled();
  });

  it('rejects past proposal times', async () => {
    const res = await POST(request({ proposed_at: '2000-05-21T18:00:00.000Z' }), params);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('future');
    expect(body.code).toBe('match_proposal_time_past');
    expect(createMatchProposal).not.toHaveBeenCalled();
  });

  it('sends match_not_found and match_access_required with their codes', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(null as never);
    const missing = await GET({} as NextRequest, params);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ success: false, error: 'Match not found', code: 'match_not_found' });

    vi.mocked(requirePlayer).mockResolvedValueOnce({ playerId: 'outsider', name: 'Outsider' } as never);
    const forbidden = await GET({} as NextRequest, params);
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ success: false, error: 'Match access required', code: 'match_access_required' });
  });

  it('sends validation_failed with the issues as a param for a malformed body', async () => {
    const res = await POST(request({ proposed_at: 'not a date' }), params);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
    expect(createMatchProposal).not.toHaveBeenCalled();
  });

  it('sets expires_at to ~48h after creation regardless of how soon proposed_at is', async () => {
    const FIXED_NOW = new Date('2026-05-26T10:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    try {
      // Proposed time is only 3 hours away — expiry must still be +48h, not collapsed.
      const proposedAt = new Date(FIXED_NOW.getTime() + 3 * 60 * 60 * 1000).toISOString();
      await POST(request({ proposed_at: proposedAt }), params);

      const expectedExpiry = new Date(FIXED_NOW.getTime() + 48 * 60 * 60 * 1000).toISOString();
      expect(createMatchProposal).toHaveBeenCalledWith(
        expect.objectContaining({ expires_at: expectedExpiry, proposed_at: proposedAt }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
