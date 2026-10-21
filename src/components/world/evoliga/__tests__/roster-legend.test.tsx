/**
 * #roster on the EvoLiga plaza: the price-group legend shows one tile per distinct label
 * (`priceGroupFilterOptions`), never two tiles that read the same, and every tile and table chip
 * takes the colour of its displayed group, so groups that share a label share a colour.
 *
 * Rendered through react-dom/server (vitest 'node' env) with the active pack (the example pack in
 * the public project: guenstig and budget both read '9–1').
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  function Link({ href, children, ...rest }: { href: string; children?: ReactNode; [key: string]: unknown }) {
    return createElement('a', { ...rest, href }, children);
  }
  return { default: Link };
});

vi.mock('next/image', async () => {
  const { createElement } = await import('react');
  function Image({ src, alt }: { src: string; alt: string }) {
    return createElement('img', { src, alt });
  }
  return { default: Image };
});

import { renderWithI18n } from '@/test/i18n';
import { epbPack, formatPack } from '@/lib/format-pack';
import { displayPriceGroup, priceGroupFilterOptions } from '@/lib/evolution/point-buy-display';
import { lineIdOfEntry } from '@/lib/draft/line-identity';
import type { PointBuyListEntry, PriceGroup } from '@/types/point-buy';
import RosterSection from '../RosterSection';
import { PRICE_GROUP_CHIP } from '../price-group-chip';

function entry(id: string, group: PriceGroup, price: number): PointBuyListEntry {
  const e: Omit<PointBuyListEntry, 'line_id'> = {
    id,
    list_version_id: 'v1',
    line_number: Number(id.replace(/\D/g, '')) || 1,
    base_pokemon: 'Charmander',
    stage2_pokemon: 'Charmeleon',
    stage3_pokemon: 'Charizard',
    price,
    kills_to_stage2: 3,
    additional_kills_to_stage3: 4,
    price_group: group,
    early_rating: null,
    mid_rating: null,
    late_rating: null,
    rationale: null,
    historical_data: null,
    special_rules: null,
    special_rules_text: null,
    sources: null,
    legacy_tier: null,
    species_ids: null,
  };
  return { ...e, line_id: lineIdOfEntry(e) };
}

const ENTRIES = epbPack.priceGroupOrder.map((group, i) => entry(`e${i + 1}`, group, epbPack.priceGroups[group][1]));

function render(locale: 'en' | 'de'): string {
  return renderWithI18n(<RosterSection entries={ENTRIES} hasListBound locale={locale} />, { locale });
}

/** The legend tiles: [group key, class, text]. */
function legendTiles(html: string): [string, string, string][] {
  return [...html.matchAll(/<li data-price-group="([^"]+)" class="([^"]*)">([^<]*)<\/li>/g)].map((m) => [m[1], m[2], m[3]]);
}

describe('EvoLiga #roster price-group legend', () => {
  it('the active pack has two stored groups that read the same (the case this guards)', () => {
    const labels = epbPack.priceGroupOrder.map((g) => formatPack.messages.en.worldClient.rosterTable.priceGroup[g]);
    expect(new Set(labels).size).toBeLessThan(labels.length);
  });

  it.each(['en', 'de'] as const)('%s: one tile per distinct label, in ladder order', (locale) => {
    const tiles = legendTiles(render(locale));
    const options = priceGroupFilterOptions();
    expect(tiles.map(([key]) => key)).toEqual(options);
    expect(tiles).toHaveLength(4);
    const labels = tiles.map(([, , label]) => label);
    expect(new Set(labels).size).toBe(labels.length);
    const pack = formatPack.messages[locale].worldClient.rosterTable.priceGroup;
    expect(new Set(labels)).toEqual(new Set(epbPack.priceGroupOrder.map((g) => pack[g])));
  });

  it('each tile wears its group colour, and no two tiles share one', () => {
    const tiles = legendTiles(render('en'));
    for (const [key, className] of tiles) expect(className).toContain(PRICE_GROUP_CHIP[key as PriceGroup]);
    expect(new Set(tiles.map(([key]) => PRICE_GROUP_CHIP[key as PriceGroup])).size).toBe(tiles.length);
  });

  it('table chips of groups that share a label share its colour and label', () => {
    const html = render('en');
    for (const group of epbPack.priceGroupOrder) {
      const shown = displayPriceGroup(group);
      const label = formatPack.messages.en.worldClient.rosterTable.priceGroup[shown];
      expect(html).toContain(`font-medium ${PRICE_GROUP_CHIP[shown]}">${label}</span>`);
    }
    const merged = epbPack.priceGroupOrder.filter((g) => displayPriceGroup(g) !== g);
    expect(merged.length).toBeGreaterThan(0);
    for (const group of merged) expect(html).not.toContain(`font-medium ${PRICE_GROUP_CHIP[group]}">`);
  });

  it('no list bound: the notice under the neutral heading, no legend', () => {
    const html = renderWithI18n(<RosterSection entries={[]} hasListBound={false} locale="en" />);
    expect(legendTiles(html)).toEqual([]);
    expect(html).toContain('No point-buy list has been bound to this league yet.');
    expect(html).toMatch(/<h2[^>]*>Roster<\/h2>/);
    expect(html).not.toMatch(/<h2[^>]*>Point-Buy list<\/h2>/);
  });

  it('no list bound (de): Kader, not Point-Buy-Liste', () => {
    const html = renderWithI18n(<RosterSection entries={[]} hasListBound={false} locale="de" />, { locale: 'de' });
    expect(html).toMatch(/<h2[^>]*>Kader<\/h2>/);
    expect(html).not.toMatch(/<h2[^>]*>Point-Buy-Liste<\/h2>/);
  });

  it.each([
    ['en', 'Point-Buy list'],
    ['de', 'Point-Buy-Liste'],
  ] as const)('%s: a bound list keeps the point-buy heading, also when it is empty', (locale, heading) => {
    for (const entries of [ENTRIES, []]) {
      const html = renderWithI18n(<RosterSection entries={entries} hasListBound locale={locale} />, { locale });
      expect(html).toMatch(new RegExp(`<h2[^>]*>${heading}</h2>`));
    }
  });
});
