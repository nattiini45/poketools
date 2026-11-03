/**
 * Wiki index rows navigate through real links: every visible row holds an `<a href>` to its English canonical entry
 * whose text is the viewer's localized name, the link covers the whole row (stretched link) and gets a focus ring, and
 * nothing on the row depends on a JavaScript click handler.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import AbilitiesIndexClient from '@/app/(public)/wiki/abilities/AbilitiesIndexClient';
import ItemsIndexClient from '@/app/(public)/wiki/items/ItemsIndexClient';
import MovesIndexClient from '@/app/(public)/wiki/moves/MovesIndexClient';
import PokemonIndexClient from '@/app/(public)/wiki/pokemon/PokemonIndexClient';

const MOVES = [
  { name: 'Earthquake', type: 'Ground', category: 'Physical', basePower: 100, accuracy: 100, pp: 10, earliestGen: 1 },
  { name: 'Thunder Wave', type: 'Electric', category: 'Status', basePower: 0, accuracy: 90, pp: 20, earliestGen: 1 },
];

function anchors(html: string): { href: string; text: string }[] {
  return [...html.matchAll(/<a [^>]*href="(\/(?:wiki|pokemon)\/[^"]+)"[^>]*>(.*?)<\/a>/g)].map((m) => ({
    href: m[1],
    text: m[2].split(/<[^>]*>/).join(''),
  }));
}

describe('wiki index rows are links', () => {
  it('moves: one anchor per row with the English href and the localized name', () => {
    const html = renderWithI18n(<MovesIndexClient data={MOVES} />);
    expect(anchors(html)).toEqual([
      { href: '/wiki/moves/Earthquake', text: 'Earthquake' },
      { href: '/wiki/moves/Thunder%20Wave', text: 'Thunder Wave' },
    ]);
  });

  it('moves in German: the link text is German, the href stays English', () => {
    const html = renderWithI18n(<MovesIndexClient data={MOVES} />, { locale: 'de' });
    const found = anchors(html);
    expect(found.map((a) => a.href).sort()).toEqual(['/wiki/moves/Earthquake', '/wiki/moves/Thunder%20Wave']);
    expect(found.find((a) => a.href === '/wiki/moves/Earthquake')?.text).toBe('Erdbeben');
  });

  it('pokemon, abilities and items link to their detail pages', () => {
    const pokemon = renderWithI18n(
      <PokemonIndexClient
        data={[{ name: 'Garchomp', types: ['Dragon', 'Ground'], hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102, bst: 600, earliestGen: 4 }]}
      />,
    );
    expect(anchors(pokemon)).toEqual([{ href: '/pokemon/Garchomp', text: 'Garchomp' }]);
    const abilities = renderWithI18n(
      <AbilitiesIndexClient data={[{ name: 'Levitate', desc: 'Immune to Ground.', descFallback: false, rating: 3.5, earliestGen: 3 }]} />,
    );
    expect(anchors(abilities)).toEqual([{ href: '/wiki/abilities/Levitate', text: 'Levitate' }]);
    const items = renderWithI18n(
      <ItemsIndexClient data={[{ name: 'Oran Berry', desc: 'Restores HP.', descFallback: false, earliestGen: 3, category: 'Berry' }]} />,
    );
    expect(anchors(items)).toEqual([{ href: '/wiki/items/Oran%20Berry', text: 'Oran Berry' }]);
  });

  it('stretches the link over its row and shows a focus ring', () => {
    const html = renderWithI18n(<MovesIndexClient data={MOVES} />);
    const link = /<a [^>]*href="\/wiki\/moves\/Earthquake"[^>]*>/.exec(html)?.[0] ?? '';
    expect(link).toContain('after:absolute');
    expect(link).toContain('after:inset-0');
    expect(link).toContain('focus-visible:ring-2');
    const row = /<tr class="([^"]*)">(?:(?!<\/tr>)[\s\S])*Earthquake/.exec(html)?.[1] ?? '';
    expect(row.split(' ')).toContain('relative');
  });

  it('keeps the stretched link above later cells (a positioned type badge must not cover it)', () => {
    const html = renderWithI18n(
      <PokemonIndexClient
        data={[{ name: 'Garchomp', types: ['Dragon', 'Ground'], hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102, bst: 600, earliestGen: 4 }]}
      />,
    );
    const link = /<a [^>]*href="\/pokemon\/Garchomp"[^>]*>/.exec(html)?.[0] ?? '';
    expect(link.match(/class="([^"]*)"/)?.[1].split(' ')).toContain('after:z-10');
    const rowTag = /<tr class="([^"]*)">(?:(?!<\/tr>)[\s\S])*Garchomp/.exec(html)?.[1] ?? '';
    const rowClasses = rowTag.split(' ');
    expect(rowClasses).toContain('relative');
    expect(rowClasses).toContain('isolate');
    expect(html).toContain('Dragon');
    expect(html.match(/after:absolute/g)).toHaveLength(1);
  });

  it('keeps every other cell on the row as plain content', () => {
    const html = renderWithI18n(<MovesIndexClient data={MOVES} />);
    expect(anchors(html)).toHaveLength(MOVES.length);
    expect(html).not.toContain('role="link"');
  });
});
