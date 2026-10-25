/**
 * `ReasonDialog` asks for a reason before an audited admin action. Radix
 * renders its dialog into a portal only after mount, so the mock renders the
 * content inline (as the other dialog tests do) and `renderToStaticMarkup`
 * shows the dialog's first render.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import ReasonDialog, { canConfirmReason } from '../ReasonDialog';

vi.mock('@radix-ui/react-dialog', () => ({
  Root: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <>{children}</> : null),
  Portal: ({ children }: { children: ReactNode }) => <>{children}</>,
  Overlay: () => null,
  Content: ({ children }: { children?: ReactNode }) => <div role="dialog">{children}</div>,
  Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Description: ({ children }: { children: ReactNode }) => <>{children}</>,
  Close: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}));

function dialog(props: Partial<Parameters<typeof ReasonDialog>[0]> = {}) {
  return (
    <ReasonDialog
      open
      onClose={() => {}}
      onConfirm={() => {}}
      title="Reset match"
      message="This cannot be undone."
      confirmLabel="Reset"
      reasonLabel="Reason"
      {...props}
    />
  );
}

/** Whether the tag carries the `disabled` attribute (the class list also holds `disabled:` utilities). */
function isDisabled(tag: string): boolean {
  return / disabled(=|>| )/.test(tag.slice(0, tag.indexOf('>') + 1));
}

/** The `<button …>` tags whose text is `label`. */
function buttons(html: string, label: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<\/button>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes(label));
}

describe('canConfirmReason', () => {
  it('needs a non-blank reason when one is required', () => {
    expect(canConfirmReason('', true)).toBe(false);
    expect(canConfirmReason('   \n ', true)).toBe(false);
    expect(canConfirmReason(' typo ', true)).toBe(true);
  });

  it('accepts anything when no reason is required', () => {
    expect(canConfirmReason('', false)).toBe(true);
  });
});

describe('ReasonDialog', () => {
  it('renders nothing while closed', () => {
    expect(renderWithI18n(dialog({ open: false }))).toBe('');
  });

  it('keeps confirm disabled until a reason is typed, and shows the counter and the impact slot', () => {
    const html = renderWithI18n(dialog({ children: <p>Two games are deleted.</p> }));

    expect(isDisabled(buttons(html, 'Reset')[0])).toBe(true);
    expect(html).toContain('A reason is required.');
    expect(html).toContain('0 / 500');
    expect(html).toContain('Two games are deleted.');
    expect(html).toContain('This cannot be undone.');
  });

  it('enables confirm for a reason it starts with, and counts its length', () => {
    const html = renderWithI18n(dialog({ initialReason: 'Wrong winner entered' }));

    expect(isDisabled(buttons(html, 'Reset')[0])).toBe(false);
    expect(html).not.toContain('A reason is required.');
    expect(html).toContain('20 / 500');
  });

  it('keeps confirm disabled for a whitespace-only start', () => {
    expect(buttons(renderWithI18n(dialog({ initialReason: '   ' })), 'Reset')[0]).toContain('disabled');
  });

  it('lets the action confirm without a reason when none is required', () => {
    const html = renderWithI18n(dialog({ reasonRequired: false }));
    expect(isDisabled(buttons(html, 'Reset')[0])).toBe(false);
    expect(html).not.toContain('A reason is required.');
  });

  it('blocks Cancel and confirm while loading, and a caller can hold confirm off', () => {
    const loading = renderWithI18n(dialog({ loading: true, initialReason: 'x' }));
    expect(isDisabled(buttons(loading, 'Cancel')[0])).toBe(true);
    expect(isDisabled(buttons(loading, 'Reset')[0])).toBe(true);

    const held = renderWithI18n(dialog({ confirmDisabled: true, initialReason: 'x' }));
    expect(isDisabled(buttons(held, 'Reset')[0])).toBe(true);
    expect(isDisabled(buttons(held, 'Cancel')[0])).toBe(false);
  });

  it('ties the required marker and the counter to the field for screen readers', () => {
    const describedBy = (html: string) => {
      const field = html.match(/<textarea\b[^>]*>/)?.[0] ?? '';
      expect(field).toContain('aria-required="true"');
      return (field.match(/aria-describedby="([^"]*)"/)?.[1] ?? '').split(' ').filter(Boolean);
    };
    const textOf = (html: string, id: string) => html.match(new RegExp(`<span id="${id}">([^<]*)</span>`))?.[1];

    const empty = renderWithI18n(dialog());
    const ids = describedBy(empty);
    expect(ids).toHaveLength(2);
    expect(textOf(empty, ids[0])).toBe('A reason is required.');
    expect(textOf(empty, ids[1])).toBe('0 / 500');

    const filled = renderWithI18n(dialog({ initialReason: 'Wrong winner entered' }));
    const filledIds = describedBy(filled);
    expect(filledIds).toHaveLength(1);
    expect(textOf(filled, filledIds[0])).toBe('20 / 500');

    const optional = renderWithI18n(dialog({ reasonRequired: false }));
    expect(optional.match(/<textarea\b[^>]*>/)?.[0]).toContain('aria-required="false"');
  });

  it('applies the length limit to the field', () => {
    expect(renderWithI18n(dialog({ maxLength: 40 }))).toContain('maxLength="40"');
  });

  it('renders the shared buttons and the counter in German', () => {
    const html = renderWithI18n(dialog({ confirmLabel: undefined }), { locale: 'de' });

    expect(html).toContain('Abbrechen');
    expect(html).toContain('Bestätigen');
    expect(html).toContain('Ein Grund ist erforderlich.');
    expect(html).toContain('0 / 500');
    expect(html).not.toContain('Cancel');
  });
});
