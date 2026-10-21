/**
 * Fidelity wave 2 (2D): the `?board=roster` list panel.
 *
 * The panel is the readable answer to a roster frieze no frozen pose can
 * show whole, so its contract is counting and linking: every roster line of
 * the section's own data, one row each, each row linking its focus panel,
 * band chips derived from the data, German on the plaza and English in the
 * three themes. No DOM environment here (vitest `node`), so the pure row
 * builders and filter helpers are asserted directly and the ≥ 14 px floor
 * is pinned on the source.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  filterRosterRows,
  rosterBandChips,
  type RosterListRow,
} from '../RosterListPanel';
import { buildThemeOverlayMaps, rosterRowsFromTiles } from '../ThemeOverlays';
import { plazaRosterRows } from '@/components/world/evoliga/EvoligaOverlays';
import { deriveRosterTiles } from '@/lib/worlds/route-data';
import { toLineId } from '@/lib/draft/line-identity';
import type { PointBuyListEntry, PriceGroup } from '@/types/point-buy';
import type { SeasonParticipant } from '@/types/season';
import type { RulesCopyFn, ThemeRouteData } from '../../types';
import { createTranslator } from '@/i18n/core';
import { worldClientMessages } from '@/i18n/messages/world/client';
import { formatPack } from '@/lib/format-pack';

/** The active format pack's painted price-band word, upper-cased like the painters. */
const bandWord = (locale: 'en' | 'de', group: PriceGroup) =>
  formatPack.messages[locale].paint.priceBand[group].toLocaleUpperCase(locale);

const HERE = join(fileURLToPath(import.meta.url), '..');

const GROUPS: PriceGroup[] = ['premium', 'hoch', 'mittel', 'guenstig', 'budget'];
const GROUP_PRICE: Record<PriceGroup, number> = { premium: 28, hoch: 24, mittel: 20, guenstig: 15, budget: 10 };

/** Fixture lines — names are synthetic tokens, never real species logic. */
function makeEntries(count: number): PointBuyListEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const group = GROUPS[i % GROUPS.length];
    return {
      id: `line-${i + 1}`,
      list_version_id: 'list-1',
      line_id: toLineId(`Mon${i + 1}`, `Mon${i + 1}b`),
      line_number: i + 1,
      base_pokemon: `Mon${i + 1}`,
      stage2_pokemon: `Mon${i + 1}b`,
      stage3_pokemon: null,
      price: GROUP_PRICE[group],
      kills_to_stage2: 3,
      additional_kills_to_stage3: null,
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
  });
}

function makeParticipant(id: string, name: string, gym: string | null): SeasonParticipant {
  return {
    id,
    name,
    discord_id: null,
    auth_user_id: null,
    ps_username: id,
    champions_username: '',
    is_admin: false,
    is_creator: false,
    is_guest: false,
    is_test_account: false,
    joined_date: '2026-09-01T00:00:00.000Z',
    avatar_url: null,
    avatar_config: null,
    status: 'active',
    suspended_until: null,
    ban_reason: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    gym_type: gym,
    core_types: null,
    core_assigned_at: null,
  } as SeasonParticipant;
}

describe('rosterRowsFromTiles — the English themes', () => {
  it('lists every tile of a 92-line roster, in roster order, each linking ?mon=', () => {
    const entries = makeEntries(92);
    const tiles = deriveRosterTiles({ rosterLines: entries, participants: [], teamAces: {} });
    const rows = rosterRowsFromTiles(tiles, []);

    // Row count = the section's list (RosterSection maps rosterTiles 1:1)
    // = the painted "OF N" total the friezes print.
    expect(rows).toHaveLength(tiles.length);
    expect(rows).toHaveLength(92);
    expect(rows.map((row) => row.line)).toEqual(tiles.map((tile) => tile.line));
    for (const row of rows) {
      expect(row.href).toBe(`?mon=${row.id}`);
      expect(row.sprite).toBe(true);
      expect(row.trainer).toBeNull();
      expect(row.price).not.toBeNull();
    }
  });

  it('paints English band words (no German price-group key leaks)', () => {
    const rows = rosterRowsFromTiles(
      deriveRosterTiles({ rosterLines: makeEntries(5), participants: [], teamAces: {} }),
      [],
    );
    expect(rows.map((row) => row.bandLabel)).toEqual((['premium', 'hoch', 'mittel', 'guenstig', 'budget'] as const).map((group) => bandWord('en', group)));
  });

  it('participant fallback: no sprite, no price, a ?team= link and the trainer named', () => {
    const participants = [makeParticipant('p-1', 'Mara', 'Fire'), makeParticipant('p-2', 'Toby', null)];
    const tiles = deriveRosterTiles({ rosterLines: null, participants, teamAces: { 'p-1': 'AceOne' } });
    const rows = rosterRowsFromTiles(tiles, participants);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'AceOne', trainer: 'Mara', sprite: false, price: null, href: '?team=p-1' });
    expect(rows[1]).toMatchObject({ name: 'Toby', trainer: 'Toby', band: 'open', href: '?team=p-2' });
  });

  it('encodes ids into the href', () => {
    const [row] = rosterRowsFromTiles([{ id: 'a b&c', line: 1, name: 'X', band: 'premium', price: 28 }], []);
    expect(row.href).toBe('?mon=a%20b%26c');
  });
});

describe('plazaRosterRows — the German Kaderliste', () => {
  it('lists every entry in line order with German band words (umlauts kept)', () => {
    const entries = makeEntries(12).reverse();
    const rows = plazaRosterRows(entries, 'de');
    expect(rows).toHaveLength(12);
    expect(rows.map((row) => row.line)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(rows.slice(0, 5).map((row) => row.bandLabel)).toEqual((['premium', 'hoch', 'mittel', 'guenstig', 'budget'] as const).map((group) => bandWord('de', group)));
    for (const row of rows) expect(row.href).toBe(`?mon=${row.id}`);
  });

  it('follows the viewer: English band words for an English viewer (i18n D11)', () => {
    const rows = plazaRosterRows(makeEntries(5), 'en');
    expect(rows.map((row) => row.bandLabel)).toEqual((['premium', 'hoch', 'mittel', 'guenstig', 'budget'] as const).map((group) => bandWord('en', group)));
  });

  it('an empty list yields no rows (the panel shows its empty state)', () => {
    expect(plazaRosterRows([], 'de')).toEqual([]);
  });
});

describe('rosterBandChips / filterRosterRows', () => {
  const rows = plazaRosterRows(makeEntries(23), 'de');

  it('one chip per band label present, ordered as a value ladder, counts summing to the total', () => {
    const chips = rosterBandChips(rows);
    // guenstig and budget lie in one finder tab and read the same, so they share one chip.
    expect(chips.map((chip) => chip.band)).toEqual(['premium', 'hoch', 'mittel', 'guenstig']);
    expect(new Set(chips.map((chip) => chip.label)).size).toBe(chips.length);
    expect(chips.reduce((sum, chip) => sum + chip.count, 0)).toBe(rows.length);
    const bottom = rows.filter((row) => row.band === 'guenstig' || row.band === 'budget').length;
    expect(chips[3].count).toBe(bottom);
  });

  it('bands with distinct labels keep distinct chips', () => {
    const distinct: RosterListRow[] = [
      { id: 'a', line: 1, name: 'A', band: 'guenstig', bandLabel: '17–13', price: 15, sprite: true, trainer: null, href: null },
      { id: 'b', line: 2, name: 'B', band: 'budget', bandLabel: '12–8', price: 10, sprite: true, trainer: null, href: null },
    ];
    expect(rosterBandChips(distinct).map((chip) => chip.band)).toEqual(['guenstig', 'budget']);
    expect(filterRosterRows(distinct, 'budget').map((row) => row.id)).toEqual(['b']);
  });

  it('bands without prices keep first-appearance order after the priced ones', () => {
    const mixed: RosterListRow[] = [
      { id: 'a', line: 1, name: 'A', band: 'water', bandLabel: 'WATER', price: null, sprite: false, trainer: 'A', href: null },
      { id: 'b', line: 2, name: 'B', band: 'fire', bandLabel: 'FIRE', price: null, sprite: false, trainer: 'B', href: null },
      { id: 'c', line: 3, name: 'C', band: 'water', bandLabel: 'WATER', price: null, sprite: false, trainer: 'C', href: null },
    ];
    expect(rosterBandChips(mixed)).toEqual([
      { band: 'water', label: 'WATER', count: 2 },
      { band: 'fire', label: 'FIRE', count: 1 },
    ]);
  });

  it('filters to one band keeping roster order; null shows every row', () => {
    const premium = filterRosterRows(rows, 'premium');
    expect(premium.every((row) => row.band === 'premium')).toBe(true);
    expect(premium.map((row) => row.line)).toEqual([...premium.map((row) => row.line)].sort((a, b) => a - b));
    expect(filterRosterRows(rows, null)).toHaveLength(rows.length);
    expect(filterRosterRows(rows, 'nope')).toEqual([]);
  });

  it('a merged chip filters to every band under its label, in roster order', () => {
    const bottom = filterRosterRows(rows, 'guenstig');
    expect(new Set(bottom.map((row) => row.band))).toEqual(new Set(['guenstig', 'budget']));
    expect(bottom.map((row) => row.line)).toEqual([...bottom.map((row) => row.line)].sort((a, b) => a - b));
    expect(filterRosterRows(rows, 'budget')).toEqual(bottom);
  });
});

describe('buildThemeOverlayMaps — ?board=roster', () => {
  const rulesCopy: RulesCopyFn = () => ({ rulesetName: 'X', rows: [], note: null });

  it('registers roster even for a participant-fallback league, titled plainly', () => {
    const participants = [makeParticipant('p-1', 'Mara', 'Fire')];
    const data = {
      league: { id: 's', name: 'L', participant_count: 1 },
      stages: [],
      participants,
      entries: [],
      rosterTiles: deriveRosterTiles({ rosterLines: null, participants, teamAces: {} }),
      trackers: [],
      teamAces: {},
      standings: [],
      fixtures: [],
      formatRules: null,
      rulesetName: null,
      hasDraftPool: false,
    } as unknown as ThemeRouteData;
    const maps = buildThemeOverlayMaps(data, rulesCopy);
    expect(Object.hasOwn(maps.board.contents, 'roster')).toBe(true);
    expect(maps.board.titles.roster).toBe('Roster');
  });
});

describe('RosterListPanel source — the ≥ 14 px row floor and the per-world language', () => {
  const source = readFileSync(join(HERE, '..', 'RosterListPanel.tsx'), 'utf8');

  it('never sets sub-14 px text (no text-xs / arbitrary small sizes)', () => {
    expect(source).not.toMatch(/text-xs|text-\[(?:1[0-3]|[0-9])px\]|text-\[0?\.\d+rem\]/);
    // Rows and chips inherit the panel's text-sm (14 px).
    expect(source).toContain('className="space-y-3 text-sm"');
  });

  it('takes its copy from world/client in the viewer’s language, in every world (i18n D11)', () => {
    expect(source).toContain('useT(worldClientMessages)');
    expect(source).not.toMatch(/locale: RosterListLocale|const COPY/);
    expect(worldClientMessages.en.rosterList.all).toBe('All');
    expect(worldClientMessages.de.rosterList.all).toBe('Alle');
    expect(createTranslator(worldClientMessages, 'en')('rosterList.price', { price: 28 })).toBe('28 pts');
    expect(createTranslator(worldClientMessages, 'de')('rosterList.price', { price: 28 })).toBe('28 Pkt');
  });
});
