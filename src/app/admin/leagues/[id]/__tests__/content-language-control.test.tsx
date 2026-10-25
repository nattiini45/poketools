/**
 * The content-language picker on the league Settings tab sits under a section subtitle that already explains
 * the language, so the select carries no second copy of that sentence (react-dom/server, vitest 'node' env).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { default: ContentLanguageControl } = await import('../_components/ContentLanguageControl');

describe('ContentLanguageControl', () => {
  it('shows the select without repeating the section explanation', () => {
    const html = renderWithI18n(<ContentLanguageControl seasonId="s1" currentLanguage="de" />);

    expect(html).toContain('Content language (Discord, reports, overlays)');
    expect(html).not.toContain('The language of text nobody reads on this site');
    expect(html).not.toContain('aria-describedby');
  });

  it('does the same in German', () => {
    const html = renderWithI18n(<ContentLanguageControl seasonId="s1" currentLanguage="de" />, { locale: 'de' });

    expect(html).toContain('Inhaltssprache (Discord, Berichte, Overlays)');
    expect(html).not.toContain('aria-describedby');
  });
});
