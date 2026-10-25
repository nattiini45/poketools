/**
 * `Modal` is fixed and centred, so tall content (the reset impact list, a
 * reason field, the buttons) must scroll inside it on a short viewport instead
 * of running off the screen. Radix renders into a portal only after mount, so
 * the mock renders the content inline and keeps its class list.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import Modal from '../Modal';

vi.mock('@radix-ui/react-dialog', () => ({
  Root: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <>{children}</> : null),
  Portal: ({ children }: { children: ReactNode }) => <>{children}</>,
  Overlay: () => null,
  Content: ({ className, children }: { className?: string; children?: ReactNode }) => (
    <div role="dialog" className={className}>
      {children}
    </div>
  ),
  Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Close: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}));

describe('Modal', () => {
  it('caps its height to the viewport and scrolls its own content', () => {
    const html = renderWithI18n(
      <Modal open onClose={() => {}} title="Reset match">
        <p>Body</p>
      </Modal>,
    );
    expect(html).toContain('max-h-[calc(100dvh-2rem)]');
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('Body');
  });
});
