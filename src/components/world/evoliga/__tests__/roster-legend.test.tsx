/**
 * #roster on the EvoLiga plaza: the price groups are the table's filter, a row of toggle pills
 * (`PriceGroupBar`) between the controls and the table. One pill per distinct label
 * (`priceGroupFilterOptions`), never two that read the same, after an "All" pill; every pill and
 * table chip takes the colour of its displayed group, so groups that share a label share a colour.
 * Pressed state, counts and disabled state follow the controlled props (vitest 'node' has no
 * clicks; the toggle itself is `togglePriceGroup`, covered with the display helpers).
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
import { displayPriceGroup, priceGroupFilterOptions, priceGroupLineCounts } from '@/lib/evolution/point-buy-display';
import { lineIdOfEntry } from '@/lib/draft/line-identity';
import type { PointBuyListEntry, PriceGroup } from '@/types/point-buy';
import PriceGroupBar from '../PriceGroupBar';
import RosterSection from '../RosterSection';
import { PRICE_GROUP_CHIP } from '../price-group-chip';
import { stripMarkup } from '@/test/markup';

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
const COUNTS = priceGroupLineCounts(ENTRIES);

function render(locale: 'en' | 'de'): string {
  return renderWithI18n(<RosterSection entries={ENTRIES} hasListBound locale={locale} />, { locale });
}

interface Pill {
  /** `data-price-group`, or null for the "All" pill. */
  key: string | null;
  className: string;
  pressed: string;
  disabled: boolean;
  ariaLabel: string;
  /** The visible text: label and count. */
  text: string;
}

/** The filter pills in document order: the "All" pill first, then one per displayed group. */
function pills(html: string): Pill[] {
  return [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)]
    .filter(([, attrs]) => attrs.includes('aria-pressed'))
    .map(([, attrs, inner]) => ({
      key: /data-price-group="([^"]+)"/.exec(attrs)?.[1] ?? null,
      className: /class="([^"]*)"/.exec(attrs)?.[1] ?? '',
      pressed: /aria-pressed="([^"]+)"/.exec(attrs)?.[1] ?? '',
      disabled: /\bdisabled=""/.test(attrs),
      ariaLabel: /aria-label="([^"]*)"/.exec(attrs)?.[1] ?? '',
      text: stripMarkup(inner),
    }));
}

describe('EvoLiga #roster price-group pills', () => {
  it('the active pack has two stored groups that read the same (the case this guards)', () => {
    const labels = epbPack.priceGroupOrder.map((g) => formatPack.messages.en.worldClient.rosterTable.priceGroup[g]);
    expect(new Set(labels).size).toBeLessThan(labels.length);
  });

  it.each(['en', 'de'] as const)('%s: "All", then one pill per distinct label, in ladder order', (locale) => {
    const [all, ...rest] = pills(render(locale));
    expect(all.key).toBeNull();
    expect(rest.map(({ key }) => key)).toEqual(priceGroupFilterOptions());
    expect(rest).toHaveLength(4);
    const pack = formatPack.messages[locale].worldClient.rosterTable.priceGroup;
    const labels = rest.map(({ text }) => text.replace(/ \d+$/, ''));
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(labels)).toEqual(new Set(epbPack.priceGroupOrder.map((g) => pack[g])));
    expect(all.text).toBe(locale === 'en' ? `All price groups ${ENTRIES.length}` : `Alle Preisgruppen ${ENTRIES.length}`);
  });

  it('the pills sit between the controls and the table, under a labelled group', () => {
    const html = render('en');
    const group = /<div role="group" aria-labelledby="([^"]+)"/.exec(html);
    expect(group).not.toBeNull();
    expect(html).toMatch(new RegExp(`<h3 id="${group![1]}"[^>]*>Price groups</h3>`));
    expect(html.indexOf('type="search"')).toBeLessThan(html.indexOf('role="group"'));
    expect(html.indexOf('role="group"')).toBeLessThan(html.indexOf('<table'));
  });

  it('the pills replaced the dropdown: only the sort select is left', () => {
    const html = render('en');
    expect(html.match(/<select\b/g)).toHaveLength(1);
    expect(html).not.toContain('Filter by price group');
  });

  it('each pill wears its group colour, and no two pills share one', () => {
    const groupPills = pills(render('en')).filter(({ key }) => key !== null);
    for (const { key, className } of groupPills) expect(className).toContain(PRICE_GROUP_CHIP[key as PriceGroup]);
    expect(new Set(groupPills.map(({ key }) => PRICE_GROUP_CHIP[key as PriceGroup])).size).toBe(groupPills.length);
  });

  it('every pill carries the one button base: touch height, rounded, focus ring, text-sm and a border', () => {
    for (const { className } of pills(render('en'))) {
      expect(className).toContain('min-h-9');
      expect(className).toContain('rounded-full');
      expect(className).toContain('text-sm');
      expect(className).toContain('focus-visible:outline-arena-focus');
      expect(className).toMatch(/\bborder\b/);
    }
  });

  it('shows how many lines each group holds, merged groups together, and the total on "All"', () => {
    const [all, ...rest] = pills(render('en'));
    expect(rest.map(({ key, text }) => [key, Number(text.split(' ').pop())])).toEqual(
      COUNTS.map(({ group, count }) => [group, count]),
    );
    expect(COUNTS.reduce((sum, { count }) => sum + count, 0)).toBe(ENTRIES.length);
    expect(COUNTS.some(({ count }) => count > 1)).toBe(true);
    expect(all.text).toContain(String(ENTRIES.length));
  });

  it.each([
    ['en', '1 line', '2 lines'],
    ['de', '1 Linie', '2 Linien'],
  ] as const)('%s: the accessible name is the label with a plural line count', (locale, one, other) => {
    const group = priceGroupFilterOptions()[0];
    const label = formatPack.messages[locale].worldClient.rosterTable.priceGroup[group];
    const nameFor = (count: number) =>
      pills(
        renderWithI18n(<PriceGroupBar selected="" onSelect={() => {}} counts={[{ group, count }]} />, { locale }),
      ).find(({ key }) => key === group)!.ariaLabel;
    expect(nameFor(1)).toBe(`${label}: ${one}`);
    expect(nameFor(2)).toBe(`${label}: ${other}`);
  });

  it('nothing selected: only "All" is pressed', () => {
    expect(pills(render('en')).map(({ pressed }) => pressed)).toEqual(['true', 'false', 'false', 'false', 'false']);
  });

  it.each(priceGroupFilterOptions())('selected %s: only its pill is pressed, with a ring and bold type', (selected) => {
    const all = pills(renderWithI18n(<PriceGroupBar selected={selected} onSelect={() => {}} counts={COUNTS} />));
    const on = all.filter(({ pressed }) => pressed === 'true');
    expect(on.map(({ key }) => key)).toEqual([selected]);
    expect(on[0].className).toContain('ring-2');
    expect(on[0].className).toContain('font-bold');
    const off = all.filter(({ pressed }) => pressed === 'false');
    expect(off).toHaveLength(all.length - 1);
    for (const { className } of off) expect(className).not.toContain('ring-2');
  });

  it('a group without lines is disabled, unless it is the selected one (the filter stays undoable)', () => {
    const [first, second] = priceGroupFilterOptions();
    const counts = [
      { group: first, count: 0 },
      { group: second, count: 3 },
    ];
    const idle = pills(renderWithI18n(<PriceGroupBar selected="" onSelect={() => {}} counts={counts} />));
    expect(idle.map(({ disabled }) => disabled)).toEqual([false, true, false]);
    const selected = pills(renderWithI18n(<PriceGroupBar selected={first} onSelect={() => {}} counts={counts} />));
    expect(selected.map(({ disabled }) => disabled)).toEqual([false, false, false]);
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

  it('no list bound: the notice under the neutral heading, no pills', () => {
    const html = renderWithI18n(<RosterSection entries={[]} hasListBound={false} locale="en" />);
    expect(pills(html)).toEqual([]);
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
