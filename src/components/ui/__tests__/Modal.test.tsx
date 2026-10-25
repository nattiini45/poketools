/**
 * `Modal` is fixed and centred, so tall content (the reset impact list, a
 * reason field, the buttons) must scroll inside it on a short viewport instead
 * of running off the screen. The Radix portal renders nothing on the server, so
 * the primitives are replaced by plain elements that keep their class names.
 * What is under test is the frame's own markup: a dialog taller than the
 * viewport must keep its header and scroll its body, otherwise the buttons at
 * the bottom cannot be reached.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';

vi.mock('@radix-ui/react-dialog', () => {
  const passthrough =
    (tag: 'div' | 'h2' | 'button') =>
    ({ className, children }: { className?: string; children?: ReactNode }) => {
      const Tag = tag;
      return <Tag className={className}>{children}</Tag>;
    };
  return {
    Root: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Portal: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Overlay: passthrough('div'),
    Content: passthrough('div'),
    Title: passthrough('h2'),
    Close: passthrough('button'),
  };
});

import Modal from '../Modal';

describe('Modal', () => {
  const html = renderWithI18n(
    <Modal open onClose={() => {}} title="Set time">
      <p>Body text</p>
    </Modal>,
  );

  it('caps its height to the viewport and scrolls its own content', () => {
    expect(html).toContain('max-h-[calc(100dvh-2rem)]');
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('Body text');
  });

  it('caps the dialog at the viewport height and lays it out as a column', () => {
    const content = /<div class="([^"]*max-h-[^"]*)">/.exec(html)?.[1] ?? '';
    expect(content).toContain('max-h-[calc(100dvh-2rem)]');
    expect(content).toContain('flex-col');
    expect(content).not.toMatch(/(^| )grid( |$)/);
  });

  it('keeps the header in place and scrolls only the body', () => {
    expect(html).toMatch(/<div class="[^"]*shrink-0[^"]*">\s*<h2/);
    expect(html).toMatch(/<div class="[^"]*min-h-0[^"]*overflow-y-auto[^"]*"><p>Body text<\/p><\/div>/);
  });
});
