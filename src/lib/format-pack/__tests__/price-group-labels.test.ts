/**
 * Price groups are named by their point range (e.g. the example pack's 25–20 / 19–15 / 14–10 / 9–1):
 * every pack labels each stored group with the `max–min` range (en dash,
 * high to low) of the finder price tab it lies in, in all three places the UI names a group
 * (`enums.priceGroup`, `paint.priceBand`, `worldClient.rosterTable.priceGroup`) and in both
 * languages. Two stored groups in one tab therefore read the same, and the UI merges them into one
 * filter option / chip / legend tile / report row with one colour (`priceGroupFilterOptions`,
 * `priceGroupMatches`, `displayPriceGroup`, `countsByDisplayGroup` in
 * `@/lib/evolution/point-buy-display`).
 * Labels are derived from `epb.priceGroups` and `epb.priceTabs`, so a pack that retunes a range
 * must rename the group with it.
 *
 * Runs on the example pack, and on the private pack too when the companion overlay is on disk
 * (existence-gated like `pack-contract.test.ts`).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import examplePack from '../../../format-packs/example';
import type { FormatPack } from '../types';
import {
  canonicalPriceGroup,
  countsByDisplayGroup,
  displayPriceGroup,
  priceGroupFilterOptions,
  priceGroupMatches,
  priceGroupTabKey,
} from '@/lib/evolution/point-buy-display';

const PRIVATE_ENTRY = path.resolve(__dirname, '../../../format-packs/private/index.ts');
const HAS_PRIVATE = existsSync(PRIVATE_ENTRY);

/** The private pack, loaded by a computed specifier so no bundler resolves it statically. */
async function loadPrivatePack(): Promise<FormatPack> {
  const specifier = pathToFileURL(PRIVATE_ENTRY).href;
  const mod: unknown = await import(/* @vite-ignore */ specifier);
  return (mod as { default: FormatPack }).default;
}

type Group = FormatPack['epb']['priceGroupOrder'][number];

/** `max–min` with an en dash of the finder tab holding a stored group: its range label. */
function rangeLabel(pack: FormatPack, group: Group): string {
  const [min, max] = pack.epb.priceGroups[group];
  const tab = pack.epb.priceTabs.find((t) => t.min <= min && max <= t.max);
  if (!tab) throw new Error(`${pack.id} ${group} ${min}–${max} lies in no single price tab`);
  return `${tab.max}–${tab.min}`;
}

/** Every place a group is named, per locale: [where, label]. */
function labelSites(pack: FormatPack, group: Group): [string, string][] {
  return (['en', 'de'] as const).flatMap((locale) => {
    const m = pack.messages[locale];
    return [
      [`${locale} enums.priceGroup`, m.enums.priceGroup[group]],
      [`${locale} paint.priceBand`, m.paint.priceBand[group]],
      [`${locale} worldClient.rosterTable.priceGroup`, m.worldClient.rosterTable.priceGroup[group]],
    ] as [string, string][];
  });
}

function checkPack(pack: FormatPack): void {
  const order = pack.epb.priceGroupOrder;
  for (const group of order) {
    const expected = rangeLabel(pack, group);
    for (const [where, label] of labelSites(pack, group)) {
      expect(label, `${pack.id} ${where}.${group}`).toBe(expected);
    }
  }
  // Filters show one option per label: exactly one per tab that holds a group, and an option
  // covers every group that reads the same.
  const options = priceGroupFilterOptions(pack.epb);
  const labels = options.map((group) => rangeLabel(pack, group));
  expect(new Set(labels).size, `${pack.id} one filter option per label`).toBe(labels.length);
  expect(new Set(labels), `${pack.id} every label has an option`).toEqual(
    new Set(order.map((group) => rangeLabel(pack, group))),
  );
  for (const group of order) {
    const option = order.find((g) => g === canonicalPriceGroup(group, pack.epb));
    expect(option, `${pack.id} ${group} has a filter option`).toBeDefined();
    expect(rangeLabel(pack, option!), `${pack.id} ${group} filed under its own label`).toBe(rangeLabel(pack, group));
  }
}

describe('price group labels are point ranges', () => {
  it('the example pack names every group max–min in en and de', () => {
    checkPack(examplePack);
    expect(examplePack.messages.en.enums.priceGroup.premium).toBe('25–20');
    // guenstig (6–9) and budget (1–5) both lie in the 9–1 tab.
    expect(examplePack.messages.de.enums.priceGroup.guenstig).toBe('9–1');
    expect(examplePack.messages.de.enums.priceGroup.budget).toBe('9–1');
  });

  it('merges groups that share a tab into one filter option', () => {
    const epb = examplePack.epb;
    expect(priceGroupTabKey('guenstig', epb)).toBe('9-1');
    expect(priceGroupTabKey('budget', epb)).toBe('9-1');
    expect(priceGroupFilterOptions(epb)).toEqual(['premium', 'hoch', 'mittel', 'guenstig']);
    expect(canonicalPriceGroup('budget', epb)).toBe('guenstig');
    expect(priceGroupMatches('budget', 'guenstig', epb)).toBe(true);
    expect(priceGroupMatches('guenstig', 'budget', epb)).toBe(true);
    expect(priceGroupMatches('mittel', 'guenstig', epb)).toBe(false);
    expect(priceGroupMatches('premium', 'premium', epb)).toBe(true);
  });

  it('shows every stored group as its canonical group (one label, one colour)', () => {
    const epb = examplePack.epb;
    expect(epb.priceGroupOrder.map((g) => displayPriceGroup(g, epb))).toEqual([
      'premium',
      'hoch',
      'mittel',
      'guenstig',
      'guenstig',
    ]);
    for (const group of epb.priceGroupOrder) {
      expect(displayPriceGroup(group, epb)).toBe(canonicalPriceGroup(group, epb));
      expect(rangeLabel(examplePack, displayPriceGroup(group, epb))).toBe(rangeLabel(examplePack, group));
    }
  });

  it('folds per-group counts onto one row per label, summing the groups that read the same', () => {
    const epb = examplePack.epb;
    expect(countsByDisplayGroup({ premium: 1, hoch: 2, mittel: 0, guenstig: 3, budget: 4 }, epb)).toEqual([
      { group: 'premium', count: 1 },
      { group: 'hoch', count: 2 },
      { group: 'mittel', count: 0 },
      { group: 'guenstig', count: 7 },
    ]);
    // A missing count is 0, and the rows are still one per label.
    expect(countsByDisplayGroup({ budget: 2 }, epb)).toEqual([
      { group: 'premium', count: 0 },
      { group: 'hoch', count: 0 },
      { group: 'mittel', count: 0 },
      { group: 'guenstig', count: 2 },
    ]);
    // Without the shared tab nothing is merged: one row per stored group.
    const split = { ...epb, priceTabs: epb.priceTabs.filter((tab) => tab.key !== '9-1') };
    expect(countsByDisplayGroup({ guenstig: 3, budget: 4 }, split).map((r) => [r.group, r.count])).toEqual([
      ['premium', 0],
      ['hoch', 0],
      ['mittel', 0],
      ['guenstig', 3],
      ['budget', 4],
    ]);
  });

  it('keeps an unknown or tab-less group as its own option (no silent merge)', () => {
    const epb = {
      ...examplePack.epb,
      priceTabs: examplePack.epb.priceTabs.filter((tab) => tab.key !== '9-1'),
    };
    expect(priceGroupTabKey('budget', epb)).toBeNull();
    expect(canonicalPriceGroup('budget', epb)).toBe('budget');
    expect(priceGroupFilterOptions(epb)).toEqual(['premium', 'hoch', 'mittel', 'guenstig', 'budget']);
    expect(priceGroupMatches('budget', 'guenstig', epb)).toBe(false);
    expect(canonicalPriceGroup('nope', epb)).toBe('nope');
    expect(priceGroupMatches('budget', 'nope', epb)).toBe(false);
  });

  it('rejects a group whose range spans two tabs', () => {
    const split: FormatPack = {
      ...examplePack,
      epb: { ...examplePack.epb, priceGroups: { ...examplePack.epb.priceGroups, mittel: [8, 14] } },
    };
    expect(() => checkPack(split)).toThrow(/mittel/);
  });

  it('rejects a label that drifts from its range', () => {
    const drifted: FormatPack = {
      ...examplePack,
      epb: {
        ...examplePack.epb,
        priceGroups: { ...examplePack.epb.priceGroups, premium: [21, 25] },
        priceTabs: [{ key: '25-21', min: 21, max: 25 }, ...examplePack.epb.priceTabs.slice(1)],
      },
    };
    expect(() => checkPack(drifted)).toThrow(/premium/);
  });

  it('rejects a word label (the names before the ruling)', () => {
    const named: FormatPack = {
      ...examplePack,
      messages: {
        ...examplePack.messages,
        de: {
          ...examplePack.messages.de,
          enums: { priceGroup: { ...examplePack.messages.de.enums.priceGroup, hoch: 'Oben' } },
        },
      },
    };
    expect(() => checkPack(named)).toThrow(/de enums\.priceGroup\.hoch/);
  });

  it.skipIf(!HAS_PRIVATE)('the private pack names every group max–min in en and de', async () => {
    const pack = await loadPrivatePack();
    checkPack(pack);
    // Four range labels (30–27 / 26–23 / 22–18 / 17–8): four filter options and legend tiles.
    expect(priceGroupFilterOptions(pack.epb)).toHaveLength(4);
  });
});
