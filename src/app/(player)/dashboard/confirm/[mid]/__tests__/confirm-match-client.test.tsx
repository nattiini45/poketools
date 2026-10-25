/**
 * The confirm/dispute buttons: the optional dispute reason shows only to a
 * viewer who can dispute, and the POST body carries it only with a dispute.
 */
import { describe, expect, it, vi } from 'vitest';
import { MATCH_REASON_MAX_LENGTH } from '@/lib/admin/match-detail';
import { renderWithI18n } from '@/test/i18n';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ConfirmMatchClient, { buildConfirmMatchBody } from '../ConfirmMatchClient';

describe('ConfirmMatchClient dispute reason', () => {
  it('shows the optional reason textarea when the viewer can dispute', () => {
    const html = renderWithI18n(
      <ConfirmMatchClient matchId="m1" canConfirm canDispute />,
    );
    expect(html).toContain('<textarea');
    expect(html).toContain('Reason for the dispute (optional)');
    expect(html).toContain(`maxLength="${MATCH_REASON_MAX_LENGTH}"`);
    expect(html).toContain(`0 / ${MATCH_REASON_MAX_LENGTH}`);
  });

  it('shows no textarea when the viewer can only confirm', () => {
    const html = renderWithI18n(
      <ConfirmMatchClient matchId="m1" canConfirm canDispute={false} />,
    );
    expect(html).not.toContain('<textarea');
    expect(html).toContain('Confirm Result');
  });

  it('shows no textarea when the viewer can do nothing', () => {
    const html = renderWithI18n(
      <ConfirmMatchClient matchId="m1" canConfirm={false} canDispute={false} />,
    );
    expect(html).not.toContain('<textarea');
    expect(html).toContain('You cannot take action on this match');
  });

  it('renders the German label under the de locale', () => {
    const html = renderWithI18n(
      <ConfirmMatchClient matchId="m1" canConfirm canDispute />,
      { locale: 'de' },
    );
    expect(html).toContain('Grund für die Anfechtung (optional)');
    expect(html).toContain('Wird den Admins angezeigt, die die Anfechtung prüfen.');
    expect(html).not.toContain('Reason for the dispute');
  });
});

describe('buildConfirmMatchBody', () => {
  it('trims the reason of a dispute', () => {
    expect(buildConfirmMatchBody('dispute', '  wrong winner \n')).toEqual({
      action: 'dispute',
      reason: 'wrong winner',
    });
  });

  it('omits an empty or whitespace-only reason', () => {
    expect(buildConfirmMatchBody('dispute', '')).toEqual({ action: 'dispute' });
    expect(buildConfirmMatchBody('dispute', ' \n\t ')).toEqual({ action: 'dispute' });
    expect('reason' in buildConfirmMatchBody('dispute', '   ')).toBe(false);
  });

  it('never sends a reason with a confirm', () => {
    expect(buildConfirmMatchBody('confirm', 'left over text')).toEqual({ action: 'confirm' });
  });

  it('keeps a reason of exactly the maximum length', () => {
    const reason = 'x'.repeat(MATCH_REASON_MAX_LENGTH);
    expect(buildConfirmMatchBody('dispute', reason).reason).toHaveLength(MATCH_REASON_MAX_LENGTH);
  });
});
