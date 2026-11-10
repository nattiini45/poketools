import { describe, expect, it } from 'vitest';
import { effectiveProposalStatus, matchProposalMachine } from '../proposal-state';

describe('matchProposalMachine', () => {
  it('answers, expires and cancels only a pending proposal', () => {
    for (const to of ['accepted', 'rejected', 'expired', 'cancelled'] as const) {
      expect(matchProposalMachine.sourcesOf(to)).toEqual(['pending']);
    }
  });

  it('lets only the responder accept or reject, and only the app expire', () => {
    expect(matchProposalMachine.nextStates('pending', 'responder').sort()).toEqual(['accepted', 'rejected']);
    expect(matchProposalMachine.nextStates('pending', 'system').sort()).toEqual(['cancelled', 'expired']);
    expect(matchProposalMachine.nextStates('pending', 'admin')).toEqual(['cancelled']);
  });

  it('refuses an answer to an answered proposal with the domain code', () => {
    expect(() => matchProposalMachine.assertTransition('accepted', 'rejected', 'responder')).toThrow(
      expect.objectContaining({ code: 'match_proposal_not_pending', statusCode: 409 }),
    );
  });

  it('reads a pending proposal past its expiry as expired', () => {
    const now = Date.parse('2026-11-09T12:00:00Z');
    expect(effectiveProposalStatus({ status: 'pending', expires_at: '2026-11-09T12:00:00Z' }, now)).toBe('expired');
    expect(effectiveProposalStatus({ status: 'pending', expires_at: '2026-11-09T12:00:01Z' }, now)).toBe('pending');
    expect(effectiveProposalStatus({ status: 'accepted', expires_at: '2026-11-01T00:00:00Z' }, now)).toBe('accepted');
  });
});
