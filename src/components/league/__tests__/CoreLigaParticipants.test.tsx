/**
 * CoreLigaParticipants: the heading defaults to the English the season pages
 * show; the league hub passes it in the world's language.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CoreLigaParticipants from '../CoreLigaParticipants';
import type { CoreTriple } from '@/types/season';
import { renderWithI18n } from '@/test/i18n';

const PARTICIPANTS: { id: string; name: string; coreTypes: CoreTriple | null }[] = [
  { id: 'a', name: 'Ash', coreTypes: ['Fire', 'Water', 'Grass'] },
  { id: 'b', name: 'Brock', coreTypes: null },
];

describe('CoreLigaParticipants', () => {
  it('heads the card "Core Liga assignments" by default', () => {
    const html = renderToStaticMarkup(<CoreLigaParticipants participants={PARTICIPANTS} />);
    expect(html).toContain('>Core Liga assignments</h3>');
    expect(html).toContain('Ash');
    expect(html).not.toContain('Brock');
  });

  it('uses the given heading', () => {
    const html = renderToStaticMarkup(
      <CoreLigaParticipants participants={PARTICIPANTS} heading="Core-Liga-Typen" />,
    );
    expect(html).toContain('>Core-Liga-Typen</h3>');
    expect(html).not.toContain('Core Liga assignments');
  });
});

describe('CoreLigaParticipants in German', () => {
  it('heads the card in the viewer language by default', () => {
    const html = renderWithI18n(<CoreLigaParticipants participants={PARTICIPANTS} />, { locale: 'de' });
    expect(html).toContain('>Core-Liga-Zuteilungen</h3>');
    expect(html).not.toContain('Core Liga assignments');
  });

  it('still prefers an explicit heading', () => {
    const html = renderWithI18n(<CoreLigaParticipants participants={PARTICIPANTS} heading="Core-Liga-Typen" />, {
      locale: 'de',
    });
    expect(html).toContain('>Core-Liga-Typen</h3>');
  });
});
