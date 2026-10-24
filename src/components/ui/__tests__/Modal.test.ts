/**
 * Modal layout: the dialog is a flex column capped to the viewport, the header stays fixed and only the body
 * scrolls, so a tall dialog (a long form, a list of findings) keeps its title and its buttons reachable on a phone.
 * The Radix portal does not render on the server, so the classes are checked on the exported layout strings and on
 * the way `Modal` applies them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { modalBodyLayout, modalContentLayout, modalHeaderLayout } from '../Modal';

const tokens = (classes: string) => classes.split(/\s+/);

describe('Modal layout', () => {
  it('caps the dialog to the dynamic viewport height and lays it out as a column', () => {
    const content = tokens(modalContentLayout);
    expect(content).toContain('flex');
    expect(content).toContain('flex-col');
    expect(content).toContain('max-h-[calc(100dvh-2rem)]');
  });

  it('scrolls the body and keeps the header in place', () => {
    const body = tokens(modalBodyLayout);
    expect(body).toContain('overflow-y-auto');
    expect(body).toContain('min-h-0');
    expect(tokens(modalHeaderLayout)).toContain('shrink-0');
  });

  it('applies the layout to the content, the header and the body, and no longer sets up a grid', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'Modal.tsx'), 'utf8');
    expect(source).toContain('modalContentLayout,');
    expect(source).toContain('className={modalHeaderLayout}');
    expect(source).toContain('className={modalBodyLayout}');
    expect(source).not.toMatch(/\bgrid\b/);
  });
});
