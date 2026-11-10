/**
 * The scheduling panel offers an answer only to a proposal that is still open, and a new proposal once the pending
 * one has expired (match proposal machine, docs/state-machines.md).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { MatchProposalWithPlayers } from '@/types/match-proposal';
import MatchSchedulingPanel from '../MatchSchedulingPanel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const NOW = Date.parse('2026-11-09T12:00:00.000Z');

function proposal(expiresAt: string): MatchProposalWithPlayers {
  return {
    id: 'pr1',
    match_id: 'm1',
    proposer_id: 'p1',
    responder_id: 'p2',
    proposed_at: '2026-11-12T18:00:00.000Z',
    message: '',
    status: 'pending',
    expires_at: expiresAt,
    responded_at: null,
    created_at: '2026-11-07T12:00:00.000Z',
    updated_at: '2026-11-07T12:00:00.000Z',
    proposer_name: 'Ash',
    responder_name: 'Gary',
  };
}

function render(p: MatchProposalWithPlayers): string {
  return renderWithI18n(
    <MatchSchedulingPanel
      matchId="m1"
      status="scheduled"
      currentPlayerId="p2"
      canManage
      scheduledAt={null}
      roundDeadline={null}
      initialProposals={[p]}
    />,
    { requestTime: NOW },
  );
}

describe('MatchSchedulingPanel', () => {
  it('a pending proposal within its 48 h: the responder answers it, no new proposal', () => {
    const html = render(proposal('2026-11-10T12:00:00.000Z'));
    expect(html).toContain('>Accept<');
    expect(html).toContain('>Reject<');
    expect(html).not.toContain('>Propose<');
  });

  it('a pending proposal past its expiry: no answer, a new proposal can be made', () => {
    const html = render(proposal('2026-11-09T11:59:59.000Z'));
    expect(html).not.toContain('>Accept<');
    expect(html).not.toContain('>Reject<');
    expect(html).toContain('>Propose<');
  });
});
