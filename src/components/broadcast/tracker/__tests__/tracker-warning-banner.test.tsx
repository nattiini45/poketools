/**
 * The battle tracker's warning banner (code review CR-6): a 200 from
 * /api/manual-result with `data.warning` (moments not saved) shows the
 * catalogued text in the viewer's language, and its dismiss control clears it.
 * The submit round trip itself (fetch -> outcome with the warning) is covered
 * by submitManualResult in lib/broadcast/__tests__/manual-result-response.test.ts.
 *
 * Tests run in `node` without a DOM, so the dismiss wiring is exercised on the
 * hook-free view's element tree.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import TrackerWarningBanner, { TrackerWarningBannerView } from '../TrackerWarningBanner';
import { MOMENTS_NOT_SAVED_WARNING } from '@/lib/broadcast/moment-limits';

const WARNING = {
  code: MOMENTS_NOT_SAVED_WARNING,
  error: 'The game was recorded, but its 2 marked moments could not be saved. The failure was logged.',
  params: { count: 2 },
};

describe('TrackerWarningBanner', () => {
  it('shows the moments-not-saved warning as a status in English', () => {
    const html = renderWithI18n(<TrackerWarningBanner warning={WARNING} onDismiss={() => {}} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('The game was recorded, but its 2 marked moments could not be saved. The failure was logged.');
    expect(html).toContain('aria-label="Dismiss"');
  });

  it('shows the warning in German, translated from its code', () => {
    const html = renderWithI18n(<TrackerWarningBanner warning={WARNING} onDismiss={() => {}} />, { locale: 'de' });
    expect(html).toContain(
      'Die Partie wurde eingetragen, aber 2 markierte Momente konnten nicht gespeichert werden. Der Fehler wurde protokolliert.'
    );
    expect(html).toContain('aria-label="Schließen"');
    expect(html).not.toContain('The game was recorded');
  });

  it('the dismiss control calls onDismiss (the tracker clears its warning state)', () => {
    const onDismiss = vi.fn();
    const tree = TrackerWarningBannerView({ text: 'x', dismissLabel: 'Dismiss', onDismiss });
    const children = (tree.props as { children: ReactNode[] }).children;
    const button = children.find(
      (c): c is ReactElement<{ onClick: () => void }> => isValidElement(c) && c.type === 'button'
    );
    expect(button).toBeDefined();
    button!.props.onClick();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
