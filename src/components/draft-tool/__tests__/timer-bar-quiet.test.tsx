/** TimerBar under quiet hours: the held clock shows the quiet-hours chip and when it runs again, en + de. */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { computeClock, type ActiveSlotLike, type ClockView } from '@/lib/draft-ui/clock';
import TimerBar from '../layout/TimerBar';
import styles from '../draft-tool.module.css';

const BERLIN = { startHour: 0, endHour: 6, timeZone: 'Europe/Berlin' };
const SLOT: ActiveSlotLike = {
  duration_ms: 43_200_000,
  extensions_applied_ms: 0,
  deadline_at: '2026-10-18T14:00:00Z',
  remaining_ms_at_pause: null,
  quiet_hours: BERLIN,
};
const AT_0100 = Date.parse('2026-10-17T23:00:00Z'); // 01:00 Berlin, held until 06:00 (04:00Z)
const AT_1000 = Date.parse('2026-10-18T08:00:00Z'); // 10:00 Berlin, running

const clockAt = (now: number): ClockView => {
  const view = computeClock(SLOT, now);
  if (!view) throw new Error('no clock');
  return view;
};

const render = (clock: ClockView, locale: 'en' | 'de', compact = false) =>
  renderWithI18n(<TimerBar clock={clock} mode="slow" playerName="Dawn" compact={compact} />, { locale, timeZone: 'Europe/Berlin' });

describe('TimerBar quiet hours', () => {
  it('shows the held state with the time the clock runs again (en)', () => {
    const html = render(clockAt(AT_0100), 'en');
    expect(html).toContain('Quiet hours');
    expect(html).toContain('Clock held for quiet hours until');
    expect(html).toContain('06:00');
    expect(html).toContain(styles.bandPaused);
    // The absolute deadline line stays.
    expect(html).toMatch(/until <time/);
  });

  it('translates the held state (de)', () => {
    const html = render(clockAt(AT_0100), 'de');
    expect(html).toContain('Ruhezeit');
    expect(html).toContain('Ruhezeit: Die Uhr steht bis');
    expect(html).not.toContain('Quiet hours');
  });

  it('compact bar: chip only', () => {
    const html = render(clockAt(AT_0100), 'en', true);
    expect(html).toContain('Quiet hours');
    expect(html).not.toContain('Clock held for quiet hours until');
  });

  it('a running clock shows no quiet-hours text', () => {
    const html = render(clockAt(AT_1000), 'en');
    expect(html).not.toContain('Quiet hours');
    expect(html).not.toContain(styles.bandPaused);
  });
});
