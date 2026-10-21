/**
 * T01: the shared atoms speak the viewer's language. English stays the
 * literal they always showed (also without a provider, D13); German comes
 * from the `shell` / `ui` namespaces, and Pokémon data names from the pkmn
 * layer. Rendered through react-dom/server (vitest 'node' env).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { renderWithI18n } from '@/test/i18n';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/insights',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import GuestBadge from '../GuestBadge';
import PokeballSpinner from '../PokeballSpinner';
import CategoryIcon from '../CategoryIcon';
import DeleteResourceButton from '../DeleteResourceButton';
import ArchiveButton from '../ArchiveButton';
import EditableDescription from '../EditableDescription';
import ScopeSelector from '../ScopeSelector';

describe('GuestBadge', () => {
  it('keeps English without a provider and translates under German', () => {
    expect(renderToStaticMarkup(<GuestBadge />)).toContain('>Guest<');
    expect(renderWithI18n(<GuestBadge />, { locale: 'de' })).toContain('>Gast<');
  });
});

describe('PokeballSpinner', () => {
  it('labels the status in the viewer language, German with a spaced ellipsis', () => {
    const en = renderWithI18n(<PokeballSpinner />);
    expect(en).toContain('aria-label="Loading"');
    expect(en).toContain('>Loading…<');
    const de = renderWithI18n(<PokeballSpinner />, { locale: 'de' });
    expect(de).toContain('aria-label="Wird geladen"');
    expect(de).toContain('>Wird geladen …<');
  });

  it('a custom label still wins', () => {
    expect(renderWithI18n(<PokeballSpinner label="Fetching" />, { locale: 'de' })).toContain('>Fetching …<');
  });
});

describe('CategoryIcon', () => {
  it('names the move category with the pkmn layer in the data locale', () => {
    expect(renderWithI18n(<CategoryIcon category="physical" />)).toContain('alt="Physical move"');
    expect(renderWithI18n(<CategoryIcon category="physical" />, { locale: 'de' })).toContain(
      'alt="Kategorie: Physisch"',
    );
    // "Keep Pokémon terms in English": German UI, English data names.
    expect(renderWithI18n(<CategoryIcon category="special" />, { locale: 'de', dataLocale: 'en' })).toContain(
      'alt="Kategorie: Special"',
    );
    expect(renderWithI18n(<CategoryIcon category="weird" />, { locale: 'de' })).toContain(
      'aria-label="Unbekannte Kategorie"',
    );
  });
});

describe('resource buttons', () => {
  it('DeleteResourceButton defaults to the localized "Delete" and keeps an explicit label', () => {
    const props = { resourceType: 'season', resourceId: 's1', resourceName: 'Liga', redirectTo: '/' } as const;
    expect(renderToStaticMarkup(<DeleteResourceButton {...props} />)).toContain('Delete');
    expect(renderWithI18n(<DeleteResourceButton {...props} />, { locale: 'de' })).toContain('Löschen');
    expect(renderWithI18n(<DeleteResourceButton {...props} label="Remove league" />, { locale: 'de' })).toContain(
      'Remove league',
    );
  });

  it('ArchiveButton reads Archive / Wiederherstellen', () => {
    expect(renderToStaticMarkup(<ArchiveButton resourceType="tournament" resourceId="t1" isArchived={false} />)).toContain(
      '>Archive<',
    );
    expect(
      renderWithI18n(<ArchiveButton resourceType="season" resourceId="s1" isArchived />, { locale: 'de' }),
    ).toContain('>Wiederherstellen<');
  });

  it('EditableDescription shows the empty-state copy in German', () => {
    const html = renderWithI18n(<EditableDescription resourceType="season" resourceId="s1" initialValue="" />, {
      locale: 'de',
    });
    expect(html).toContain('Noch keine Beschreibung.');
    expect(html).toContain('>Beschreibung hinzufügen<');
  });
});

describe('ScopeSelector', () => {
  it('translates the scope options and leaves league names untouched', () => {
    const html = renderWithI18n(
      <ScopeSelector
        scope={{ type: 'league', id: 'l1' }}
        leagues={[{ id: 'l1', name: 'EvoLiga Season 3' }]}
        tournaments={[]}
      />,
      { locale: 'de' },
    );
    expect(html).toContain('>Bereich<');
    expect(html).toContain('>Global (gesamte Zeit)<');
    expect(html).toContain('>Liga<');
    expect(html).toContain('>EvoLiga Season 3<');
  });
});
