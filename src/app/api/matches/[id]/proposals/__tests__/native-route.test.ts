import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { GET, POST } from '../route';
import { POST as accept } from '@/app/api/match-proposals/[id]/accept/route';
import { POST as reject } from '@/app/api/match-proposals/[id]/reject/route';

const h = vi.hoisted(() => ({
  mode: vi.fn(), nativeOwner: vi.fn(), legacyOwner: vi.fn(), standalone: vi.fn(),
  auth: vi.fn(), match: vi.fn(), legacyMatch: vi.fn(), legacyProposal: vi.fn(), nativeProposal: vi.fn(),
  create: vi.fn(), legacyCreate: vi.fn(), list: vi.fn(), respond: vi.fn(),
  audit: vi.fn(), expire: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: h.auth, AuthError: class AuthError extends Error {} }));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: h.mode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  findNativePhaseAliasOwner: h.nativeOwner, findLegacyPhaseAliasOwner: h.legacyOwner, standaloneMatchAliasExists: h.standalone,
}));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: h.match }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: h.legacyMatch }));
vi.mock('@/lib/supabase/queries/match-proposals', () => ({
  getMatchProposalById: h.legacyProposal, getPhaseMatchProposalById: h.nativeProposal, listPhaseMatchProposals: h.list,
  createPhaseMatchProposal: h.create, createMatchProposal: h.legacyCreate, respondToPhaseMatchProposal: h.respond,
}));
vi.mock('@/lib/revalidation', () => ({ revalidatePhaseMatchPages: h.expire }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: h.audit }));

const id = '10000000-0000-4000-8000-000000000001';
const owner = { kind: 'phase', phase_id: '20000000-0000-4000-8000-000000000002', season_id: '30000000-0000-4000-8000-000000000003' };
const proposal = {
  id: '40000000-0000-4000-8000-000000000004', match_id: id, proposer_id: 'one', responder_id: 'two',
  proposed_at: '2099-05-21T18:00:00.000Z', expires_at: '2099-05-22T18:00:00.000Z', status: 'pending',
};
const params = (value = id) => ({ params: Promise.resolve({ id: value }) });
const request = (method: string, body?: unknown) => new NextRequest('http://localhost', {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

beforeEach(() => {
  vi.resetAllMocks();
  h.mode.mockResolvedValue('phase');
  h.nativeOwner.mockResolvedValue(owner);
  h.auth.mockResolvedValue({ playerId: 'one', name: 'One' });
  h.match.mockResolvedValue({
    id, phase_id: owner.phase_id, player_1_id: 'one', player_2_id: 'two',
    player_1_name: 'One', player_2_name: 'Two', status: 'scheduled', notes: 'private',
  });
  h.nativeProposal.mockResolvedValue(proposal);
  h.list.mockResolvedValue([proposal]);
  h.create.mockResolvedValue(proposal);
});

it('reads and creates only through the verified native match, without a tournament lookup', async () => {
  expect((await GET(request('GET'), params())).status).toBe(200);
  expect(h.list).toHaveBeenCalledExactlyOnceWith(id, 'one');
  expect((await POST(request('POST', { proposed_at: proposal.proposed_at, message: 'Evening' }), params())).status).toBe(201);
  expect(h.create).toHaveBeenCalledExactlyOnceWith(owner.phase_id, id, 'one', proposal.proposed_at, 'Evening');
  expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ resource_type: 'phase_match', resource_id: id }));
  expect(h.legacyMatch).not.toHaveBeenCalled();
  expect(h.legacyCreate).not.toHaveBeenCalled();
});

it('rejects a non-seat before reading proposal messages or writing', async () => {
  h.auth.mockResolvedValue({ playerId: 'other', name: 'Other' });
  expect((await GET(request('GET'), params())).status).toBe(403);
  expect((await POST(request('POST', { proposed_at: proposal.proposed_at }), params())).status).toBe(403);
  expect(h.list).not.toHaveBeenCalled();
  expect(h.create).not.toHaveBeenCalled();
});

it('returns only the native time in the match response, and expires the correct owner tags', async () => {
  h.auth.mockResolvedValue({ playerId: 'two', name: 'Two' });
  const answered = { ...proposal, status: 'accepted' };
  h.respond.mockResolvedValue(answered);
  const res = await accept(request('POST'), params(proposal.id));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, data: { proposal: answered, match: { scheduled_at: proposal.proposed_at } } });
  expect(h.respond).toHaveBeenCalledExactlyOnceWith(owner.phase_id, id, proposal.id, 'two', true);
  expect(h.expire).toHaveBeenCalledExactlyOnceWith(owner.phase_id, id, owner.season_id);
  expect(h.legacyProposal).not.toHaveBeenCalled();
});

it('rejects only as the designated responder and does not reschedule', async () => {
  expect((await reject(request('POST'), params(proposal.id))).status).toBe(403);
  expect(h.respond).not.toHaveBeenCalled();
  h.auth.mockResolvedValue({ playerId: 'two', name: 'Two' });
  h.respond.mockResolvedValue({ ...proposal, status: 'rejected' });
  expect((await reject(request('POST'), params(proposal.id))).status).toBe(200);
  expect(h.respond).toHaveBeenCalledExactlyOnceWith(owner.phase_id, id, proposal.id, 'two', false);
  expect(h.expire).not.toHaveBeenCalled();
});

it('does not fall back to a same-ID retired proposal, including during maintenance', async () => {
  h.nativeProposal.mockResolvedValue(null);
  h.legacyProposal.mockResolvedValue(proposal);
  expect((await accept(request('POST'), params(proposal.id))).status).toBe(404);
  h.nativeProposal.mockResolvedValue(proposal);
  h.mode.mockResolvedValue('frozen_phase');
  h.legacyOwner.mockResolvedValue(null);
  expect((await accept(request('POST'), params(proposal.id))).status).toBe(503);
  expect(h.respond).not.toHaveBeenCalled();
});

it('preserves an atomic refusal after the route read, with no audit or invalidation', async () => {
  h.auth.mockResolvedValue({ playerId: 'two', name: 'Two' });
  h.respond.mockRejectedValue(new UserFacingError('Proposal is no longer pending', { code: 'match_proposal_not_pending', status: 409 }));
  const response = await accept(request('POST'), params(proposal.id));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'match_proposal_not_pending' });
  expect(h.audit).not.toHaveBeenCalled();
  expect(h.expire).not.toHaveBeenCalled();
});
