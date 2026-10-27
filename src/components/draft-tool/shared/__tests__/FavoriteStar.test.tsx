import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import { buildFixtureCatalog, stubNames } from '@/lib/draft-finder/__tests__/fixture-index';
import InfoBox from '../../left/InfoBox';
import FavoriteStar from '../FavoriteStar';

const entry = buildFixtureCatalog().lines.find((l) => l.lineId === 'gastly--gengar')!;

describe('FavoriteStar', () => {
  it('is a decorative SVG star: a gold outline when not a favourite', () => {
    const html = renderToStaticMarkup(<FavoriteStar filled={false} />);
    expect(html).toMatch(/^<svg /);
    expect(html).toContain('lucide-star');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-filled="false"');
    expect(html).toContain('stroke-[color:var(--draft-star)]');
    expect(html).toContain('fill-transparent');
    expect(html).not.toContain('fill-[color:var(--draft-star)]');
  });

  it('fills the same star with the same gold when it is a favourite', () => {
    const html = renderToStaticMarkup(<FavoriteStar filled />);
    expect(html).toContain('data-filled="true"');
    expect(html).toContain('stroke-[color:var(--draft-star)]');
    expect(html).toContain('fill-[color:var(--draft-star)]');
    expect(html).not.toContain('fill-transparent');
  });

  it('leaves size and placement to the caller, never the colour', () => {
    const html = renderToStaticMarkup(<FavoriteStar filled={false} className="h-5 w-5" />);
    expect(html).toContain('h-5 w-5');
    expect(html).not.toMatch(/accent|text-\[var/);
  });
});

describe('the info box star', () => {
  const infoBox = (isFavorite: boolean) =>
    renderWithI18n(
      <InfoBox
        entry={entry}
        dl="en"
        names={stubNames}
        isFavorite={isFavorite}
        inCompare={false}
        compareFull={false}
        onToggleFavorite={() => {}}
        onToggleCompare={() => {}}
      />,
    );

  it('is the same star as the roster card, inside its toggle button (aria-pressed kept)', () => {
    const off = infoBox(false);
    expect(off).toMatch(/aria-pressed="false"[^>]*>\s*<svg[^>]*lucide-star/);
    expect(off).toContain('data-filled="false"');
    const on = infoBox(true);
    expect(on).toMatch(/aria-pressed="true"[^>]*>\s*<svg[^>]*lucide-star/);
    expect(on).toContain('data-filled="true"');
    expect(on).toContain('fill-[color:var(--draft-star)]');
  });
});

