/**
 * The entry picker and its parts in static markup, in both languages: the virtualized listbox (roles, `aria-activedescendant`,
 * `aria-posinset` / `aria-setsize`, option names with the state in words), the state chips, the bulk bar, the detail bar and
 * the plain table (native checkboxes and buttons). The catalog is seeded into the module cache, so the picker renders its
 * ready state on the first pass. Pointer and keyboard behaviour live in the pure modules and have their own tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { expectLabelledControls, expectNoLeftovers, expectUniqueIds } from '@/test/markup';
import type { CatalogIndex, ItemRow, SpeciesRow } from '@/lib/pkmn/catalog-index';
import { stateLookup } from '@/lib/ruleset-kit/entry-state';
import { clearCatalogCache, fetchCatalogIndex } from '@/lib/ruleset-studio/editor/catalog-client';
import { EMPTY_SELECTION } from '@/lib/ruleset-studio/editor/picker/selection';
import { SPECIES_ROWS } from '@/lib/ruleset-studio/__tests__/editor/picker/fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import BulkBar from '../picker/BulkBar';
import DetailBar from '../picker/DetailBar';
import EntryPicker from '../picker/EntryPicker';
import EntryTable from '../picker/EntryTable';
import StateChip from '../picker/StateChip';
import { decodeIndex } from '@/lib/pkmn/catalog-index';

const response = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }));

async function seed(index: CatalogIndex): Promise<void> {
  const outcome = await fetchCatalogIndex({ kind: index.kind, gen: index.gen, scope: index.scope, preset: index.preset }, { fetch: () => response(index) });
  expect(outcome.ok).toBe(true);
}

const speciesIndex: CatalogIndex<'species'> = { v: 1, kind: 'species', gen: 9, scope: 'national', preset: null, rows: SPECIES_ROWS };
const BASE = { mode: 'block' as const, ids: ['koraidon', 'charizardmegax'] };
const RULES = { ban: ['garchomp'], unban: ['koraidon'], allow: null };
const HISTORY = { canUndo: true, canRedo: false, onUndo: () => undefined, onRedo: () => undefined };

function picker(overrides: Partial<Parameters<typeof EntryPicker>[0]> = {}) {
  return (
    <EntryPicker category="pokemon" rules={RULES} base={BASE} gen={9} scope="national" doubles={false} presetId={null} history={HISTORY} onAct={() => undefined} {...overrides} />
  );
}

beforeEach(() => clearCatalogCache());

describe('EntryPicker', () => {
  it('shows a loading skeleton, announced, until the catalog arrives', () => {
    const html = renderWithI18n(picker());
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading the entry list…');
    expect(html).not.toContain('role="listbox"');
  });

  it.each(['en', 'de'] as const)('renders the virtualized listbox with named, numbered options (%s)', async (locale) => {
    await seed(speciesIndex);
    const html = renderWithI18n(picker(), { locale });
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-multiselectable="true"');
    expect(html).toMatch(/aria-label="(Pokémon, 9 shown|Pokémon, 9 angezeigt)"/);
    const options = [...html.matchAll(/<div[^>]*role="option"[^>]*>/g)].map((m) => m[0]);
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option).toContain('aria-selected="false"');
      expect(option).toMatch(/aria-posinset="\d+"/);
      expect(option).toContain('aria-setsize="9"');
      expect(option).toMatch(/id="[^"]*-opt-[a-z]+"/);
    }
    expectUniqueIds(html);
    expectNoLeftovers(html);
    expectLabelledControls(html);
  });

  it('names every option with the entry and its state in words', async () => {
    await seed(speciesIndex);
    const english = renderWithI18n(picker());
    expect(english).toContain('aria-label="Garchomp, Banned by you"');
    expect(english).toContain('aria-label="Koraidon, Unbanned by you"');
    expect(english).toContain('aria-label="Charizard-Mega-X, Banned by preset"');
    expect(english).toContain('aria-label="Pikachu, Legal"');
    const german = renderWithI18n(picker(), { locale: 'de' });
    expect(german).toContain('Glurak, Erlaubt');
    expect(german).toContain('Von dir gebannt');
  });

  it('draws each Pokémon from the icon sheet (one cell per entry), with a sprite only where the sheet has no cell', async () => {
    await seed(speciesIndex);
    const html = renderWithI18n(picker());
    expect(html).toContain('pokemonicons-sheet.png');
    expect(html).toContain('image-rendering:pixelated');
    // Rattata has no sheet cell: its sprite is a plain lazy image.
    expect(html).toMatch(/<img[^>]*loading="lazy"/);
  });

  it('groups a Pokémon list by tier with headers that are hidden from assistive tech', async () => {
    await seed(speciesIndex);
    const html = renderWithI18n(picker());
    expect(html).toMatch(/aria-hidden="true"[^>]*><span>Uber<\/span>/);
  });

  it('in allowlist mode the options are allowed or not allowed and the buttons add and remove', async () => {
    await seed(speciesIndex);
    const html = renderWithI18n(picker({ rules: { ban: [], unban: [], allow: ['pikachu'] } }));
    expect(html).toContain('aria-label="Pikachu, Allowed"');
    expect(html).toContain('aria-label="Garchomp, Not allowed"');
    expect(html).toContain('Remove');
    expect(html).toContain('Allow');
  });

  it('keeps the list reachable by keyboard: one tab stop, the keyboard help and an undo button', async () => {
    await seed(speciesIndex);
    const html = renderWithI18n(picker());
    expect(html).toMatch(/role="listbox"[^>]*tabindex="0"|tabindex="0"[^>]*role="listbox"/);
    expect(html).toContain('Keyboard shortcuts');
    expect(html).toContain('aria-label="Undo"');
    expect(html).toContain('Arrow keys move through the list');
  });

  it('every other kind renders its own options', async () => {
    const moves: CatalogIndex<'moves'> = {
      v: 1,
      kind: 'moves',
      gen: 9,
      scope: 'standard',
      preset: null,
      rows: [
        ['earthquake', 'Earthquake', 'Ground', 0, 100, 100, 10, 1, 0],
        ['swift', 'Swift', 'Normal', 1, 60, 0, 20, 1, 0],
      ],
    };
    await seed(moves);
    const html = renderWithI18n(picker({ category: 'moves', scope: 'standard', rules: { ban: ['swift'], unban: [], allow: null }, base: null }));
    expect(html).toContain('aria-label="Swift, Banned by you"');
    expect(html).toContain('aria-label="Earthquake, Legal"');
    const items: CatalogIndex<'items'> = { v: 1, kind: 'items', gen: 9, scope: 'standard', preset: null, rows: [['leftovers', 'Leftovers', 6, 2, 242, 0] as ItemRow] };
    await seed(items);
    const itemHtml = renderWithI18n(picker({ category: 'items', scope: 'standard', rules: { ban: [], unban: [], allow: null }, base: null }));
    expect(itemHtml).toContain('itemicons-sheet.png');
    expect(itemHtml).toContain('aria-label="Leftovers, Legal"');
  });
});

describe('StateChip', () => {
  it('carries the state in words and a glyph, never colour alone', () => {
    const html = renderWithI18n(<StateChip state="you_banned" label="Banned by you" />);
    expect(html).toContain('Banned by you');
    expect(html).toContain('<svg');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-state="you_banned"');
  });

  it('an icon-only chip still names the state for assistive tech', () => {
    const html = renderWithI18n(<StateChip state="legal" label="Legal" iconOnly />);
    expect(html).toContain('<span class="sr-only">Legal</span>');
  });
});

describe('BulkBar', () => {
  const bar = (props: Partial<Parameters<typeof BulkBar>[0]> = {}) => (
    <BulkBar selectedCount={0} hiddenCount={0} filteredCount={87} narrowed={false} allowlist={false} onAct={() => undefined} onClear={() => undefined} onSelectAll={() => undefined} {...props} />
  );

  it('is absent with no selection and no narrowing', () => {
    expect(renderWithI18n(bar())).toBe('');
  });

  it('offers ban, unban, reset and clear for a selection, and says how many are hidden by the filters', () => {
    const html = renderWithI18n(bar({ selectedCount: 12, hiddenCount: 3 }));
    expect(html).toContain('12 selected');
    expect(html).toContain('3 are hidden by the filters');
    for (const label of ['Ban', 'Unban', 'Reset to preset', 'Clear selection']) expect(html).toContain(label);
    expect(html).not.toContain('Ban all');
  });

  it('offers "apply to everything the filters show" with the count when a search narrows the view', () => {
    const html = renderWithI18n(bar({ narrowed: true }));
    expect(html).toContain('All 87 filtered entries');
    expect(html).toContain('Ban all');
    expect(html).toContain('Select all 87');
  });

  it('in allowlist mode the actions add to and remove from the list; German text follows', () => {
    const html = renderWithI18n(bar({ selectedCount: 2, allowlist: true }));
    expect(html).toContain('Add to allowlist');
    expect(html).toContain('Remove from allowlist');
    expect(renderWithI18n(bar({ selectedCount: 2 }), { locale: 'de' })).toContain('Bannen');
  });
});

describe('DetailBar', () => {
  const [garchomp] = decodeIndex(speciesIndex).filter((entry) => entry.id === 'garchomp');
  const megaX = decodeIndex(speciesIndex).find((entry) => entry.id === 'charizardmegax');

  it('waits for the keyboard before it shows anything', () => {
    expect(renderWithI18n(<DetailBar entry={null} state={null} name="" tier="" description={undefined} descriptionFallback={false} allowlist={false} baseName={null} onAct={() => undefined} />)).toContain(
      'Move through the list to see details here.',
    );
  });

  it('shows a Pokémon with types, tier, base stats and real buttons', () => {
    const html = renderWithI18n(<DetailBar entry={garchomp} state="you_banned" name="Garchomp" tier="OU" description={undefined} descriptionFallback={false} allowlist={false} baseName={null} onAct={() => undefined} />);
    expect(html).toContain('Garchomp');
    expect(html).toContain('Banned by you');
    expect(html).toContain('Base stat total: 600');
    expect(html).toContain('<button');
    expect(html).toContain('Reset to preset');
    expect(html).toContain('Unban');
  });

  it('names the base species of a forme and marks a Mega Evolution and a past entry', () => {
    const html = renderWithI18n(<DetailBar entry={megaX!} state="preset_banned" name="Charizard-Mega-X" tier="Uber" description={undefined} descriptionFallback={false} allowlist={false} baseName="Charizard" onAct={() => undefined} />);
    expect(html).toContain('Mega Evolution or Primal reversion');
    expect(html).toContain('Only part of the National Dex');
  });

  it('shows the description of a move and marks an English fallback in German', () => {
    const swift = decodeIndex({ v: 1, kind: 'moves', gen: 9, scope: 'standard', preset: null, rows: [['swift', 'Swift', 'Normal', 1, 60, 0, 20, 1, 0]] })[0];
    const html = renderWithI18n(<DetailBar entry={swift} state="legal" name="Fangzahn" tier="" description="Never misses." descriptionFallback allowlist={false} baseName={null} onAct={() => undefined} />, { locale: 'de' });
    expect(html).toContain('Never misses.');
    expect(html).toContain('Trifft immer');
    expect(html).toContain('EN');
  });
});

describe('EntryTable', () => {
  const entries = decodeIndex(speciesIndex);
  const lookup = stateLookup(RULES, BASE);
  const table = (props: Partial<Parameters<typeof EntryTable>[0]> = {}) => (
    <EntryTable
      category="pokemon"
      entries={entries}
      stateOf={lookup.stateOf}
      descriptions={null}
      tagOf={(entry) => (entry.kind === 'species' ? String(entry.bst) : '')}
      selection={EMPTY_SELECTION}
      page={1}
      onPage={() => undefined}
      onToggleSelected={() => undefined}
      onSelectPage={() => undefined}
      onAct={() => undefined}
      allowlist={false}
      {...props}
    />
  );

  it('is a real table: a caption, column headers, row headers, native checkboxes and buttons', () => {
    const html = renderWithI18n(table());
    expect(html).toContain('<table');
    expect(html).toContain('<caption class="sr-only">Pokémon</caption>');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('aria-label="Ban Pikachu"');
    expect(html).toContain('aria-label="Ban Koraidon"');
    expect(html).not.toContain('role="listbox"');
    expectUniqueIds(html);
    expectLabelledControls(html);
    expectNoLeftovers(html);
  });

  it('pages fifty rows at a time and says which page it is on', () => {
    const many: SpeciesRow[] = Array.from({ length: 120 }, (_, i) => [`mon${i}`, `Mon${i}`, ['Normal'], 'OU', 'DOU', 'OU', 0, [1, 1, 1, 1, 1, 1], 1, 0, null]);
    const all = decodeIndex({ v: 1, kind: 'species', gen: 9, scope: 'standard', preset: null, rows: many });
    const html = renderWithI18n(table({ entries: all, page: 3 }));
    expect(html).toContain('Page 3 of 3');
    expect(html).toContain('Mon119');
    expect(html).not.toContain('Mon0<');
    expect(html).toMatch(/aria-label="Next page"|Next page/);
  });

  it('marks the selected rows and speaks German', () => {
    const html = renderWithI18n(table({ selection: { ids: new Set(['pikachu']), anchor: 'pikachu' } }), { locale: 'de' });
    expect(html).toContain('checked=""');
    expect(html).toContain('Zustand');
  });
});
