import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TypeBadgeView from '../TypeBadgeView';
import TypeBadge from '../TypeBadge';
import { renderWithI18n } from '@/test/i18n';

describe('TypeBadgeView', () => {
  it('renders the label it is given, styled by the English type key', () => {
    const html = renderToStaticMarkup(<TypeBadgeView type="Fire" label="Feuer" />);
    expect(html).toContain('Feuer');
    expect(html).toContain('bg-poke-type-fire');
    expect(html).toContain('min-w-[4.5rem]');
  });

  it('falls back to the muted style for an unknown type and honours size and className', () => {
    const html = renderToStaticMarkup(<TypeBadgeView type="Stellar" label="Stellar" size="compact" className="extra" />);
    expect(html).toContain('bg-poke-muted');
    expect(html).toContain('min-w-0');
    expect(html).toContain('extra');
  });

  it('is what the client TypeBadge renders, so both badges look the same', () => {
    const client = renderWithI18n(<TypeBadge type="Fire" />, { locale: 'de' });
    const view = renderToStaticMarkup(<TypeBadgeView type="Fire" label="Feuer" />);
    expect(client).toBe(view);
  });
});
