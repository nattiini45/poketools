/**
 * The preview drawer (static markup): the toggle sits in the toolbar next to Save draft and Publish and points at the
 * drawer that EditorLayout renders closed, with the preview content still mounted. A toolbar outside a layout has no
 * toggle.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import EditorLayout from '../EditorLayout';
import EditorToolbar from '../EditorToolbar';
import { createShellText } from '../text';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const text = createShellText(formatStudioEditorMessages, 'en');

const toolbar = (
  <EditorToolbar
    text={text}
    name="Name"
    save={{ status: 'idle' }}
    dirty={false}
    counts={{ errors: 0, warnings: 0, notes: 0 }}
    visibility="private"
    publishedVersion={null}
    canDelete={false}
    backHref="/a"
    readOnlyHref="/b"
    onSave={() => undefined}
    onPublish={() => undefined}
    onShare={() => undefined}
    onFork={() => undefined}
    onDelete={() => undefined}
  />
);

describe('the preview drawer', () => {
  it('has its toggle in the toolbar, closed, pointing at the mounted drawer', () => {
    const html = renderWithI18n(
      <EditorLayout rootAttribute="data-x" dirty={false} onSave={() => undefined} toolbar={toolbar} outline={<p>outline</p>} main={<p>main</p>} side={<p>side content</p>} previewLabel="Preview">
        {null}
      </EditorLayout>,
      { locale: 'en' },
    );
    const toggle = /<button[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"/.exec(html) ?? /<button[^>]*aria-controls="([^"]+)"[^>]*aria-expanded="false"/.exec(html);
    expect(toggle).not.toBeNull();
    expect(html).toContain(`id="${toggle?.[1]}"`);
    expect(html).toContain('side content');
    expect(html).toMatch(/class="hidden /);
  });

  it('a toolbar outside a layout has no toggle', () => {
    expect(renderWithI18n(toolbar, { locale: 'en' })).not.toContain('aria-controls');
  });
});
