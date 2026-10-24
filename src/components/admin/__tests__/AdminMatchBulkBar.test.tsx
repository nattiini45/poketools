/**
 * AdminMatchBulkBar (server render): nothing without a selection; with one, the plural count, the region label,
 * Clear and the three actions, sticky at the bottom with phone-sized touch targets.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import AdminMatchBulkBar from '../AdminMatchBulkBar';

const render = (count: number, locale: 'en' | 'de' = 'en') =>
  renderWithI18n(<AdminMatchBulkBar count={count} onClear={() => {}} onAction={() => {}} />, { locale });

describe('AdminMatchBulkBar', () => {
  it('renders nothing at zero selected', () => {
    expect(render(0)).toBe('');
  });

  it('shows the singular and plural count with Clear and the three actions', () => {
    const one = render(1);
    expect(one).toContain('1 match selected');
    const three = render(3);
    expect(three).toContain('3 matches selected');
    expect(three).toContain('role="region"');
    expect(three).toContain('aria-label="Bulk actions"');
    for (const label of ['Clear selection', 'Confirm as reported', 'Set time', 'Add note']) {
      expect(three).toContain(`>${label}</button>`);
    }
    // Order: confirm, schedule, note.
    expect(three.indexOf('Confirm as reported')).toBeLessThan(three.indexOf('Set time'));
    expect(three.indexOf('Set time')).toBeLessThan(three.indexOf('Add note'));
  });

  it('keeps every button enabled', () => {
    expect(render(1)).not.toContain('disabled=""');
  });

  it('is translated to German', () => {
    const html = render(2, 'de');
    expect(html).toContain('2 Spiele ausgewählt');
    expect(render(1, 'de')).toContain('1 Spiel ausgewählt');
    expect(html).toContain('aria-label="Sammelaktionen"');
    for (const label of ['Auswahl aufheben', 'Wie gemeldet bestätigen', 'Zeit festlegen', 'Notiz hinzufügen']) {
      expect(html).toContain(`>${label}</button>`);
    }
  });

  it('sticks to the bottom above the content, wraps, and uses 44px targets and theme tokens', () => {
    const html = render(2);
    const bar = /<div role="region"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? /<div class="([^"]*)"[^>]*role="region"/.exec(html)?.[1] ?? '';
    expect(bar.split(/\s+/)).toEqual(expect.arrayContaining(['sticky', 'bottom-3', 'z-30', 'flex-wrap', 'mb-3', 'bg-poke-surface']));
    expect(bar).not.toMatch(/bg-(black|slate|gray|zinc|neutral)-/);
    const buttons = html.match(/<button [^>]*>/g) ?? [];
    expect(buttons).toHaveLength(4);
    for (const button of buttons) expect(button).toContain('min-h-[44px]');
  });

  it('mentions the cap only when it is reached', () => {
    expect(render(99)).not.toContain('up to 100');
    expect(render(100)).toContain('You can select up to 100 matches at once.');
  });
});
