/**
 * MatchStatusBadge: the label comes from `enums.matchStatus` in the viewer's
 * language (the unified wording, i18n-core §5.3), and the colour follows the
 * status whatever the text, so a translated or overridden chip keeps the
 * colour the English chip has.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import MatchStatusBadge from '../MatchStatusBadge';

describe('MatchStatusBadge', () => {
  it('prints the English label by default', () => {
    expect(renderToStaticMarkup(<MatchStatusBadge status="completed" />)).toContain('>Completed<');
  });

  it('uses the unified enum wording', () => {
    expect(renderWithI18n(<MatchStatusBadge status="in_progress" />)).toContain('>In progress<');
    expect(renderWithI18n(<MatchStatusBadge status="pending_confirmation" />)).toContain('>Awaiting confirmation<');
  });

  it('prints the German label under a German provider, in the same colour', () => {
    const english = renderWithI18n(<MatchStatusBadge status="pending_confirmation" />);
    const german = renderWithI18n(<MatchStatusBadge status="pending_confirmation" />, { locale: 'de' });
    expect(german).toContain('>Wartet auf Bestätigung<');
    expect(german.replace('Wartet auf Bestätigung', 'Awaiting confirmation')).toBe(english);
  });

  it('prints a given label with the colour of its status', () => {
    const english = renderToStaticMarkup(<MatchStatusBadge status="disputed" />);
    const german = renderToStaticMarkup(<MatchStatusBadge status="disputed" label="Strittig" />);
    expect(german).toContain('>Strittig<');
    expect(german).not.toContain('Disputed');
    expect(german.replace('Strittig', 'Disputed')).toBe(english);
  });
});
