import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { UpcomingVM } from '@/lib/draft-ui/snapshot-adapter';
import UpcomingOrderStrip from '../layout/UpcomingOrderStrip';

const item = (overrides: Partial<UpcomingVM>): UpcomingVM => ({
  slotId: 's1',
  playerId: 'p1',
  name: 'Misty',
  pickNumber: 4,
  round: 1,
  kind: 'normal',
  isViewer: false,
  roundBreakBefore: false,
  ...overrides,
});

const ITEMS: UpcomingVM[] = [item({ slotId: 's1' }), item({ slotId: 's2', pickNumber: 5, name: 'Dawn', kind: 'makeup' })];

describe('UpcomingOrderStrip make-up chips', () => {
  it('shows the make-up time of a live draft on the chip and in its label', () => {
    const html = renderWithI18n(<UpcomingOrderStrip items={ITEMS} activeSlot={null} makeupSeconds={150} />);
    expect(html).toContain('↻ 2:30');
    expect(html).toContain('aria-label="Make-up pick 5: Dawn, 2:30"');
  });

  it('shows no time for a null make-up time (slow draft: the ladder times every slot)', () => {
    const html = renderWithI18n(<UpcomingOrderStrip items={ITEMS} activeSlot={null} makeupSeconds={null} />);
    expect(html).toContain('↻');
    expect(html).not.toContain('2:30');
    expect(html).not.toMatch(/↻ \d/);
    expect(html).toContain('aria-label="Make-up pick 5: Dawn"');
  });

  it('defaults to no time and speaks German', () => {
    const html = renderWithI18n(<UpcomingOrderStrip items={ITEMS} activeSlot={null} />, { locale: 'de' });
    expect(html).toContain('aria-label="Nachhol-Pick 5: Dawn"');
  });
});
