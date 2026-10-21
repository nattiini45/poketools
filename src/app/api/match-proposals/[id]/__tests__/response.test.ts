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
  updateMatchSchedule: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/match-proposals', () => ({
  acceptMatchProposal: vi.fn(),
  cancelPendingMatchProposalsForMatch: vi.fn(),
  expireMatchProposal: vi.fn(),
  getMatchProposalById: vi.fn(),
  rejectMatchProposal: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST as acceptPost } from '@/app/api/match-proposals/[id]/accept/route';
import { POST as rejectPost } from '@/app/api/match-proposals/[id]/reject/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getMatchById, updateMatchSchedule } from '@/lib/supabase/queries/matches';
import {
  acceptMatchProposal,
  cancelPendingMatchProposalsForMatch,
  expireMatchProposal,
  getMatchProposalById,
  rejectMatchProposal,
} from '@/lib/supabase/queries/match-proposals';
import { revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';

const player = { playerId: 'player-2', name: 'Bob' };
const proposal = {
  id: 'e42be528-73db-4ad0-86f3-1083e6a413f2',
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
const match = {
  id: 'match-1',
  tournament_id: 'tournament-1',
  player_1_id: 'player-1',
  player_2_id: 'player-2',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  status: 'scheduled',
};
const params = { params: Promise.resolve({ id: 'e42be528-73db-4ad0-86f3-1083e6a413f2' }) };

describe('match proposal response routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(player as never);
    vi.mocked(getMatchProposalById).mockResolvedValue(proposal as never);
    vi.mocked(getMatchById).mockResolvedValue(match as never);
    vi.mocked(acceptMatchProposal).mockResolvedValue({ ...proposal, status: 'accepted', responded_at: 'now' } as never);
    vi.mocked(rejectMatchProposal).mockResolvedValue({ ...proposal, status: 'rejected', responded_at: 'now' } as never);
    vi.mocked(cancelPendingMatchProposalsForMatch).mockResolvedValue([]);
    vi.mocked(updateMatchSchedule).mockResolvedValue({ ...match, scheduled_at: proposal.proposed_at } as never);
  });

  it('accepts a pending proposal and schedules the match', async () => {
    const res = await acceptPost({} as NextRequest, params);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(acceptMatchProposal).toHaveBeenCalledWith('e42be528-73db-4ad0-86f3-1083e6a413f2');
    expect(updateMatchSchedule).toHaveBeenCalledWith('match-1', proposal.proposed_at);
    expect(cancelPendingMatchProposalsForMatch).toHaveBeenCalledWith('match-1');
    expect(revalidateMatchPages).toHaveBeenCalledWith('tournament-1', 'match-1');
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'match.proposal.accept' }));
  });

  it('rejects a pending proposal', async () => {
    const res = await rejectPost({} as NextRequest, params);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(rejectMatchProposal).toHaveBeenCalledWith('e42be528-73db-4ad0-86f3-1083e6a413f2');
    expect(updateMatchSchedule).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'match.proposal.reject' }));
  });

  it('forbids proposer from accepting their own proposal', async () => {
    vi.mocked(requirePlayer).mockResolvedValueOnce({ playerId: 'player-1', name: 'Alice' } as never);

    const res = await acceptPost({} as NextRequest, params);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.code).toBe('match_proposal_accept_responder_only');
    expect(acceptMatchProposal).not.toHaveBeenCalled();
  });

  it('expires stale proposals before accepting', async () => {
    vi.mocked(getMatchProposalById).mockResolvedValueOnce({ ...proposal, expires_at: '2000-05-22T18:00:00.000Z' } as never);

    const res = await acceptPost({} as NextRequest, params);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('expired');
    expect(body.code).toBe('match_proposal_expired');
    expect(expireMatchProposal).toHaveBeenCalledWith('e42be528-73db-4ad0-86f3-1083e6a413f2');
    expect(acceptMatchProposal).not.toHaveBeenCalled();
  });

  it('rejects responses for completed matches', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce({ ...match, status: 'completed' } as never);

    const res = await acceptPost({} as NextRequest, params);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('completed');
    expect(body.code).toBe('match_schedule_closed');
    expect(acceptMatchProposal).not.toHaveBeenCalled();
  });

  it('sends a code for each reject failure and for a missing proposal', async () => {
    vi.mocked(getMatchProposalById).mockResolvedValueOnce(null as never);
    const missing = await rejectPost({} as NextRequest, params);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ success: false, error: 'Proposal not found', code: 'match_proposal_not_found' });

    vi.mocked(requirePlayer).mockResolvedValueOnce({ playerId: 'player-1', name: 'Alice' } as never);
    const notResponder = await rejectPost({} as NextRequest, params);
    expect(notResponder.status).toBe(403);
    expect((await notResponder.json()).code).toBe('match_proposal_reject_responder_only');

    vi.mocked(getMatchProposalById).mockResolvedValueOnce({ ...proposal, status: 'accepted' } as never);
    const notPending = await rejectPost({} as NextRequest, params);
    expect(notPending.status).toBe(409);
    expect(await notPending.json()).toEqual({
      success: false,
      error: 'Proposal is no longer pending',
      code: 'match_proposal_not_pending',
    });
    expect(rejectMatchProposal).not.toHaveBeenCalled();
  });
});
