import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import { buildChips } from '@/lib/draft-finder/chips';
import { compileCriteria, evaluateLine, runFinder } from '@/lib/draft-finder/engine';
import {
  EMPTY_FILTERS,
  FILTER_GROUP_KEYS,
  INITIAL_FILTER_SHEET,
  initialFinderState,
  type FilterSheetState,
  type FinderFilters,
  type FinderViewState,
} from '@/lib/draft-finder/filter-types';
import { prepareIndex } from '@/lib/draft-finder/prepare';
import { BANNED, buildFixtureCatalog, buildFixtureIndex } from '@/lib/draft-finder/__tests__/fixture-index';
import { toDraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import { snapshot } from '@/lib/draft-ui/__tests__/fixtures';
import ActiveFilterChips from '../ActiveFilterChips';
import FilterPanel from '../FilterPanel';
import FinderBar from '../FinderBar';
import { HoverDetailsContent, hasHoverDetails } from '../HoverDetails';
import PriceTabs from '../PriceTabs';
import RosterCard from '../RosterCard';
import RosterWall from '../RosterWall';
import { testNames } from './label-context';

/**
 * Radix renders its dialog into a portal only after mount, so `renderToStaticMarkup` would show nothing.
 * The mock renders the filter sheet inline (as in confirm-dialog.test.tsx).
 */
vi.mock('@radix-ui/react-dialog', () => ({
  Root: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <>{children}</> : null),
  Portal: ({ children }: { children: ReactNode }) => <>{children}</>,
  Overlay: () => null,
  Content: ({ children, id }: { children?: ReactNode; id?: string }) => (
    <div role="dialog" id={id}>
      {children}
    </div>
  ),
  Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Description: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Close: ({ children, 'aria-label': label }: { children: ReactNode; 'aria-label'?: string }) => (
    <button type="button" aria-label={label}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/shared/PokemonSprite', () => ({
  default: ({ name, size }: { name: string; size?: number }) => <span data-sprite={name} data-size={size} />,
}));

const noop = () => {};
const catalog = buildFixtureCatalog();
const ix = prepareIndex(buildFixtureIndex(), testNames);
const vm = toDraftViewModel(snapshot(), catalog);
const entryOf = (lineId: string) => {
  const entry = catalog.lines.find((l) => l.lineId === lineId);
  if (!entry) throw new Error(`fixture line ${lineId} missing`);
  return entry;
};

function view(over: Partial<FinderViewState> = {}, filters: Partial<FinderFilters> = {}): FinderViewState {
  return { ...initialFinderState(), ...over, filters: { ...EMPTY_FILTERS, ...filters } };
}

function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('RosterCard', () => {
  it('shows a drafted line in red with the owner name (EN and DE)', () => {
    const card = (
      <RosterCard
        entry={entryOf('gastly--gengar')}
        state="drafted"
        ownerName="Misty"
        isPinned={false}
        isFavorite={false}
        inCompare={false}
        reasonText={null}
        names={testNames}
        dl="en"
      />
    );
    const html = renderWithI18n(card);
    expect(html).toContain('data-state="drafted"');
    expect(html).toContain('drafted by Misty');
    expect(html).toContain('--draft-taken-border');
    expect(html).toContain('aria-label="Gastly → Gengar, 29 points, drafted by Misty"');
    expect(renderWithI18n(card, { locale: 'de' })).toContain('gedraftet von Misty');
  });

  it('marks a branched line with its final stage and keeps the price badge', () => {
    const html = renderWithI18n(
      <RosterCard
        entry={entryOf('oshawott--samurotthisui')}
        state="available"
        ownerName={null}
        isPinned
        isFavorite
        inCompare
        reasonText={null}
        names={testNames}
        dl="de"
      />,
      { locale: 'de' },
    );
    // The footer: the final stage's name (no arrow glyph in the text, the arrow is an icon), the full text in the title.
    expect(html).toContain('title="→ Hisui-Admurai"');
    expect(html).toContain('>Hisui-Admurai</span>');
    expect(html).toContain('data-sprite="Samurott-Hisui"');
    expect(html).toContain('25 P');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('lucide-git-compare-arrows');
    // The favourite star is a pointer-only shortcut: no focusable control nested inside role="option".
    expect(html).toContain('data-favorite="true"');
    expect(html).toContain('data-filled="true"');
    expect(html).not.toContain('<button');
    expect(html).toContain('aus den Favoriten entfernen');
  });

  it('keeps the footer slot empty for a line whose base starts no other line', () => {
    const html = renderWithI18n(
      <RosterCard
        entry={entryOf('gastly--gengar')}
        state="available"
        ownerName={null}
        isPinned={false}
        isFavorite={false}
        inCompare={false}
        reasonText={null}
        names={testNames}
        dl="en"
      />,
    );
    expect(entryOf('gastly--gengar').branch.count).toBe(1);
    expect(html).toContain('data-card-row="footer" data-branch="false"');
    expect(html).not.toContain('lucide-arrow-right');
    expect(html).not.toContain('title="→');
  });

  it('dims a blocked line and puts the reason into its label', () => {
    const html = renderWithI18n(
      <RosterCard
        entry={entryOf('mona--x')}
        state="blocked"
        ownerName={null}
        isPinned={false}
        isFavorite={false}
        inCompare={false}
        reasonText="Not enough points."
        names={testNames}
        dl="en"
      />,
    );
    expect(html).toContain('grayscale');
    expect(html).toContain('not draftable: Not enough points.');
    expect(html).toContain('title="Not enough points."');
  });

  it('renders English without a provider', () => {
    const html = renderToStaticMarkup(
      <RosterCard
        entry={entryOf('mona--x')}
        state="mine"
        ownerName="Dawn"
        isPinned={false}
        isFavorite={false}
        inCompare={false}
        reasonText={null}
        names={testNames}
        dl="en"
      />,
    );
    expect(html).toContain('yours');
  });
});

describe('RosterWall', () => {
  const base = {
    catalog,
    vm,
    favorites: new Set<string>(),
    compareIds: [] as string[],
    onPin: noop,
    onToggleFavorite: noop,
    onToggleCompare: noop,
    onHover: noop,
    names: testNames,
  };

  it('renders the catalog as a listbox with the snapshot card states (FR-10)', () => {
    const html = renderWithI18n(<RosterWall {...base} rows={null} pinnedLineId={null} />);
    expect(html).toContain('role="listbox"');
    expect(countOf(html, 'role="option"')).toBe(catalog.lines.length);
    expect(html).toMatch(/data-line-id="teddiursa--ursalunabloodmoon" data-state="mine"/);
    expect(html).toMatch(/data-line-id="gastly--gengar" data-state="drafted"/);
    expect(html).toContain('drafted by Misty');
    expect(html).toMatch(/data-line-id="mona--x" data-state="blocked"/);
    // A viewer-level reason (not your turn) never greys a card.
    expect(html).toMatch(/data-line-id="cosmog--solgaleo" data-state="available"/);
    expect(html).toContain('Arrow keys move');
  });

  it('keeps the tab stop on the pinned card, or the first card when the pinned one is hidden', () => {
    const rows = [{ lineId: 'monb--y' }, { lineId: 'mona--x' }].map((r) => ({
      ...r,
      evaluation: { lineId: r.lineId, matches: true, results: [], simultaneousFromStage: null },
    }));
    const pinned = renderWithI18n(<RosterWall {...base} rows={rows} pinnedLineId="mona--x" />);
    expect(pinned).toMatch(/aria-selected="true"[^>]*tabindex="0"[^>]*data-line-id="mona--x"/);
    const hidden = renderWithI18n(<RosterWall {...base} rows={rows} pinnedLineId="gastly--gengar" />);
    expect(hidden).toMatch(/tabindex="0"[^>]*data-line-id="monb--y"/);
    expect(countOf(hidden, 'tabindex="0"')).toBe(1);
  });

  it('shows the empty state when nothing matches', () => {
    expect(renderWithI18n(<RosterWall {...base} rows={[]} pinnedLineId={null} />)).toContain('No line matches your filters.');
    expect(
      renderWithI18n(<RosterWall {...base} rows={[]} pinnedLineId={null} empty={<b>custom</b>} />, { locale: 'de' }),
    ).toContain('<b>custom</b>');
  });
});

// The public suite runs on the example pack: price tabs 25-20 / 19-15 / 14-10 / 9-1, utility categories
// Hazards / Hazard control / Recovery / Pivoting / Priority.
describe('PriceTabs', () => {
  const finder = runFinder({
    ix,
    catalog,
    view: view({}, { maxPrice: 20 }),
    taken: {},
    favorites: new Set(),
    dataLocale: 'en',
    names: testNames,
    banned: BANNED,
  });

  it('labels each range with an en dash and shows matching/total while filters are active', () => {
    const html = renderWithI18n(<PriceTabs active="all" counts={finder.tabCounts} filtersActive onSelect={noop} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('25–20');
    expect(html).toContain('9–1');
    expect(html).toContain('All');
    expect(html).toContain(`${finder.tabCounts['19-15'].matching}/${finder.tabCounts['19-15'].total}`);
    // Fill tokens follow the tab position, not the key.
    expect(html).toContain('--draft-tab-1,');
    expect(html).toContain('--draft-tab-4,');
    expect(html).toContain('--draft-tab-all,');
    expect(countOf(html, 'role="tab"')).toBe(5);
    expect(countOf(html, 'aria-selected="true"')).toBe(1);
  });

  it('shows plain totals without filters and German labels', () => {
    const html = renderWithI18n(<PriceTabs active="25-20" counts={finder.tabCounts} filtersActive={false} onSelect={noop} />, {
      locale: 'de',
    });
    expect(html).toContain('Alle');
    expect(html).toContain('Preisbereich');
    expect(html).toContain(`>${finder.tabCounts.all.total}<`);
  });
});

describe('ActiveFilterChips', () => {
  const chips = buildChips({ ...EMPTY_FILTERS, types: { ids: ['Ground'], match: 'any' }, maxPrice: 15 });

  it('renders the chips, "Clear all" and the plural count', () => {
    const html = renderWithI18n(<ActiveFilterChips chips={chips} count={1} onRemove={noop} onClearAll={noop} names={testNames} />);
    expect(html).toContain('Ground');
    expect(html).toContain('≤15 P');
    expect(html).toContain('aria-label="Remove filter: Ground"');
    expect(html).toContain('Clear all filters');
    expect(html).toContain('1 line');
    expect(html).not.toContain('No filters');
    const de = renderWithI18n(<ActiveFilterChips chips={chips} count={7} onRemove={noop} onClearAll={noop} names={testNames} />, {
      locale: 'de',
    });
    expect(de).toContain('Boden');
    expect(de).toContain('Alle Filter löschen');
    expect(de).toContain('7 Linien');
  });

  it('wraps instead of scrolling: no horizontal scroller, "Clear all" and the count in the same flow', () => {
    const html = renderWithI18n(<ActiveFilterChips chips={chips} count={3} onRemove={noop} onClearAll={noop} names={testNames} />);
    const group = html.slice(html.indexOf('role="group"'), html.indexOf('>', html.indexOf('role="group"')));
    expect(group).toContain('flex-wrap');
    expect(html).not.toContain('overflow-x-auto');
    expect(html).not.toContain('w-max');
    expect(html).not.toContain('<ul');
    // Chips, then "Clear all", then the count, all direct children of the one wrapping group.
    expect(html.indexOf('Remove filter: Ground')).toBeLessThan(html.indexOf('Clear all filters'));
    expect(html.indexOf('Clear all filters')).toBeLessThan(html.indexOf('3 lines'));
    expect(html).toMatch(/<span class="[^"]*ml-auto[^"]*">3 lines<\/span>/);
  });

  it('draws compact pills with an aria-hidden icon inside a 44 px phone target', () => {
    const html = renderWithI18n(<ActiveFilterChips chips={chips} count={3} onRemove={noop} onClearAll={noop} names={testNames} />);
    // Every chip button and "Clear all" has the phone touch target; the pill inside it is the small drawing.
    const buttons = [...html.matchAll(/<button[^>]*class="([^"]*)"/g)].map((m) => m[1]);
    expect(buttons).toHaveLength(3);
    for (const cls of buttons) expect(cls).toContain('min-h-[44px]');
    expect(html).toMatch(/<span class="truncate">Ground<\/span><svg[^>]*aria-hidden="true"/);
    expect(html).not.toContain('border-r');
  });

  it('shows a utility member as its bare name and keeps the category in title and remove label', () => {
    const memberChips = buildChips(
      { ...EMPTY_FILTERS, utility: [{ key: 'hazards', members: ['spikes', 'stealthrock'] }] },
      { moveName: (id) => ix.raw.moveNames[ix.moveIdToIdx.get(id) ?? -1], abilityName: () => undefined },
    );
    const html = renderWithI18n(<ActiveFilterChips chips={memberChips} count={2} onRemove={noop} onClearAll={noop} names={testNames} />);
    expect(html).toContain('aria-label="Remove filter: Hazards: Spikes"');
    expect(html).toContain('title="Hazards: Spikes"');
    expect(html).toMatch(/<span class="truncate">Spikes<\/span>/);
    expect(html).not.toMatch(/<span class="truncate">Hazards/);
    const de = renderWithI18n(<ActiveFilterChips chips={memberChips} count={2} onRemove={noop} onClearAll={noop} names={testNames} />, {
      locale: 'de',
    });
    expect(de).toContain('aria-label="Filter entfernen: Hazards: Stachler"');
  });

  it('shows a category without members as one chip', () => {
    const categoryChips = buildChips({ ...EMPTY_FILTERS, utility: [{ key: 'hazards', members: [] }] });
    const html = renderWithI18n(<ActiveFilterChips chips={categoryChips} count={2} onRemove={noop} onClearAll={noop} names={testNames} />);
    expect(html.match(/Remove filter:/g)).toHaveLength(1);
    expect(html).toMatch(/<span class="truncate">Hazards<\/span>/);
  });

  it('always renders: a "No filters" placeholder and the count, no "Clear all"', () => {
    const html = renderWithI18n(<ActiveFilterChips chips={[]} count={48} onRemove={noop} onClearAll={noop} />);
    expect(html).toContain('role="group"');
    expect(html).toContain('No filters');
    expect(html).toContain('48 lines');
    expect(html).not.toContain('Clear all filters');
    const de = renderWithI18n(<ActiveFilterChips chips={[]} count={48} onRemove={noop} onClearAll={noop} />, { locale: 'de' });
    expect(de).toContain('Keine Filter');
  });
});

describe('FinderBar', () => {
  it('renders search, stage mode, filters, sort and "show drafted" in English', () => {
    const html = renderWithI18n(<FinderBar view={view()} dispatch={noop} indexReady names={testNames} />);
    expect(html).toContain('placeholder="Search any stage (EN/DE)"');
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/aria-checked="true"[^>]*>On the same Pokémon</);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('id="draft-filter-panel-trigger"');
    expect(html).toMatch(/>Filters<\/button>/);
    expect(html).toContain('>Speed</option>');
    expect(html).toContain('>BST</option>');
    expect(html).not.toContain('final stage');
    expect(html).toContain('Show drafted');
  });

  describe('sort stage switch', () => {
    const groups = (html: string) => html.match(/<div role="radiogroup"[^>]*>/g) ?? [];

    it('follows the stage mode in DOM order, after the sort select, and names itself', () => {
      const html = renderWithI18n(<FinderBar view={view({ sort: 'spe' })} dispatch={noop} indexReady names={testNames} />);
      expect(groups(html)).toHaveLength(2);
      expect(groups(html)[0]).toContain('aria-label="Where the filters must match"');
      expect(groups(html)[1]).toContain('aria-label="Stats of"');
      expect(html.indexOf('<select')).toBeLessThan(html.indexOf('aria-label="Stats of"'));
      expect(html).toMatch(/aria-checked="true"[^>]*>Final</);
      expect(html).toMatch(/aria-checked="false"[^>]*>Base</);
    });

    it('shows the stored stage and is operable for the stat sorts and BST', () => {
      for (const sort of ['spe', 'atk', 'def', 'spa', 'spd', 'bst'] as const) {
        const html = renderWithI18n(<FinderBar view={view({ sort, sortStage: 'base' })} dispatch={noop} indexReady names={testNames} />);
        expect(html).toMatch(/aria-checked="true"[^>]*>Base</);
        expect(groups(html)[1]).not.toContain('aria-disabled');
      }
    });

    it('stays in place but is disabled and muted for the sorts without a stat', () => {
      for (const sort of ['default', 'alpha', 'favorites'] as const) {
        const html = renderWithI18n(<FinderBar view={view({ sort })} dispatch={noop} indexReady names={testNames} />);
        expect(groups(html)[1]).toContain('aria-disabled="true"');
        expect(html.match(/<button[^>]*role="radio"[^>]*disabled=""/g)).toHaveLength(2);
      }
    });

    it('speaks German', () => {
      const html = renderWithI18n(<FinderBar view={view({ sort: 'spe' })} dispatch={noop} indexReady names={testNames} />, {
        locale: 'de',
      });
      expect(html).toContain('aria-label="Werte der"');
      expect(html).toMatch(/aria-checked="false"[^>]*>Basis</);
      expect(html).toMatch(/aria-checked="true"[^>]*>Endstufe</);
    });
  });

  it('renders German and the loading state of the Filters button', () => {
    const html = renderWithI18n(<FinderBar view={view()} dispatch={noop} indexReady={false} names={testNames} />, {
      locale: 'de',
    });
    expect(html).toContain('Am selben Pokémon');
    expect(html).toContain('Irgendwo in der Linie');
    expect(html).toContain('>Init.</option>');
    expect(html).not.toContain('(Endstufe)');
    expect(html).toContain('Gedraftete anzeigen');
    expect(html).toContain('Filter werden geladen');
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it('shows the active filter count on the Filters button and never the match count', () => {
    const html = renderWithI18n(
      <FinderBar
        view={view({}, { maxPrice: 20, types: { ids: ['Water'], match: 'any' }, text: 'gen' })}
        dispatch={noop}
        indexReady
        names={testNames}
      />,
    );
    // The search text is no chip: 2 filters.
    expect(html).toContain('Filters (2)');
    expect(html).not.toMatch(/\d+ lines?</);
  });

  it('points aria-controls at the sheet only while it is open; the loading pulse is motion-gated; 44 px search on phones', () => {
    const closed = renderWithI18n(<FinderBar view={view()} dispatch={noop} indexReady={false} names={testNames} />);
    expect(closed).not.toContain('aria-controls="draft-filter-panel"');
    expect(closed).toContain('motion-safe:animate-pulse');
    expect(closed).not.toMatch(/[" ]animate-pulse/);
    expect(closed).toMatch(/<input type="search"[^>]*class="min-h-\[44px\][^"]*md:min-h-0/);
    const open = renderWithI18n(<FinderBar view={view({ filterPanelOpen: true })} dispatch={noop} indexReady names={testNames} />);
    expect(open).toContain('aria-controls="draft-filter-panel"');
  });
});

describe('FilterPanel', () => {
  const open = (filters: Partial<FinderFilters> = {}, sheet: Partial<FilterSheetState> = {}): FinderViewState => ({
    ...view({ filterPanelOpen: true }, filters),
    filterSheet: { ...INITIAL_FILTER_SHEET, ...sheet },
  });
  const allOpen: Partial<FilterSheetState> = { openGroups: [...FILTER_GROUP_KEYS] };
  const panel = (v: FinderViewState, banned: ReadonlySet<string> = BANNED, dl: 'en' | 'de' = 'en') => (
    <FilterPanel view={v} dispatch={noop} ix={ix} names={testNames} dl={dl} banned={banned} count={12} />
  );
  const groupHeader = (title: string) => new RegExp(`aria-expanded="(true|false)"[^>]*>(?:(?!</button>).)*<span class="text-sm font-semibold">${title}</span>`);

  it('renders nothing while closed', () => {
    expect(renderWithI18n(panel(view()))).toBe('');
  });

  it('is a dialog with a title, close button, five groups and a sticky footer', () => {
    const html = renderWithI18n(panel(open()));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('id="draft-filter-panel"');
    expect(html).toContain('<h2>Filter Pokémon lines</h2>');
    expect(html).toContain('aria-label="Close filters"');
    for (const title of ['Pokémon', 'Moves and abilities', 'Base stats', 'Utility', 'Defensive matchups']) {
      expect(html).toMatch(groupHeader(title));
    }
    expect(html).not.toContain('Advanced');
    expect(html).toContain('Show 12 lines');
    // Nothing active: no "Clear all", no group reset.
    expect(html).not.toContain('Clear all filters');
    expect(html).not.toContain('aria-label="Reset ');
  });

  it('untouched: only the Pokémon group is open without filters (type + labelled maximum price)', () => {
    const html = renderWithI18n(panel(open()));
    expect(countOf(html, 'aria-expanded="true"')).toBe(1);
    expect(html).toContain('>Type</h4>');
    expect(html).toContain('>Maximum price (points)</h4>');
    expect(html).toContain('The price tabs above the lines pick a price range.');
    expect(html).toContain('Any price');
    expect(html).not.toContain('>Moves</h4>');
    // Type "Any / Require all" only.
    expect(countOf(html, 'role="radio"')).toBe(2);
  });

  it('opens the groups with active filters, with counts, resets and the stat summary', () => {
    const html = renderWithI18n(
      panel(
        open({
          stats: { spe: 80, bst: 500 },
          defense: [{ relation: 'immune', type: 'Ground' }],
          moves: { ids: ['uturn'], match: 'any' },
        }),
      ),
    );
    expect(countOf(html, 'aria-expanded="true"')).toBe(4);
    expect(html).toContain('Spe ≥ 80 · BST ≥ 500');
    expect(html).toContain(', 2 active');
    expect(html).toContain('aria-label="Reset Base stats"');
    expect(html).toContain('aria-label="Reset Defensive matchups"');
    expect(html).toContain('aria-label="Reset Moves and abilities"');
    expect(html).not.toContain('aria-label="Reset Pokémon"');
    expect(html).toContain('Clear all filters');
    // Type 2 + move 2 + relations 3.
    expect(countOf(html, 'role="radio"')).toBe(7);
    // The relation switch shows how many types are picked per relation; the match switches name their section.
    expect(html).toMatch(/aria-checked="false"[^>]*>Immune \(1\)</);
    expect(html).toContain('aria-label="Moves – Match"');
  });

  it('takes the defensive relation from the view state', () => {
    const html = renderWithI18n(panel(open({}, { openGroups: ['defense'], defenseRelation: 'weak' })));
    expect(html).toMatch(/aria-checked="true"[^>]*>Weak</);
    expect(html).toContain('aria-label="Defensive relation"');
    expect(html).toContain('Weaknesses count the typing only.');
  });

  it('a touched group list wins and the picker query is controlled by the view state', () => {
    const html = renderWithI18n(
      panel(open({ stats: { spe: 80 } }, { openGroups: ['movesAbilities'], pickerQuery: { move: 'u-t', ability: '' } })),
    );
    expect(countOf(html, 'aria-expanded="true"')).toBe(1);
    expect(html).toContain('>Moves</h4>');
    expect(html).toContain('value="u-t"');
    expect(html).not.toContain('>Type</h4>');
  });

  it('renders every utility category of the pack and the defensive "count abilities" switch', () => {
    const html = renderWithI18n(panel(open({}, allOpen)));
    for (const category of ['Hazards', 'Hazard control', 'Recovery', 'Pivoting', 'Priority']) {
      expect(html).toContain(`<span>${category}</span>`);
    }
    expect(html).toContain('Count abilities');
    // 18 type toggles + 18 defensive type toggles.
    expect(countOf(html, 'aria-pressed=')).toBe(36);
  });

  it('lists banned members with a pill and a disabled checkbox, and notes Rest', () => {
    const html = renderWithI18n(
      panel(
        open({
          utility: [
            { key: 'pivot', members: ['uturn'] },
            { key: 'recovery', members: ['regenerator'] },
          ],
          maxPrice: 20,
        }),
        new Set([...BANNED, 'partingshot']),
      ),
    );
    expect(html).toMatch(/disabled=""[^>]*\/><span class="line-through">Parting Shot<\/span><span[^>]*>banned<\/span>/);
    expect(html).toContain('Rest counts only when picked on its own.');
    expect(html).toContain('Up to 20 P');
  });

  it('keeps a utility category collapsed when the view state says so', () => {
    const html = renderWithI18n(
      panel(open({ utility: [{ key: 'pivot', members: ['uturn'] }] }, { utilityExpanded: [] }), new Set([...BANNED, 'partingshot'])),
    );
    expect(html).not.toContain('Parting Shot');
    expect(html).toContain('aria-label="Show the moves and abilities of Pivoting"');
  });

  it('renders German labels', () => {
    const html = renderWithI18n(
      panel(open({ utility: [{ key: 'pivot', members: ['uturn'] }] }, allOpen), new Set([...BANNED, 'partingshot']), 'de'),
      { locale: 'de' },
    );
    expect(html).toContain('Pokémon-Linien filtern');
    expect(html).toContain('Attacken und Fähigkeiten');
    expect(html).toContain('Defensive Matchups');
    expect(html).toContain('Maximaler Preis (Punkte)');
    expect(html).toContain('12 Linien anzeigen');
    expect(html).toContain('aria-label="Utility zurücksetzen"');
    expect(html).toContain('Hazard-Kontrolle');
    expect(html).toContain('gebannt');
    expect(html).toContain('Kehrtwende');
    expect(html).toContain('Fähigkeiten einbeziehen');
  });
});

describe('HoverDetailsContent', () => {
  const healingMomentum: Partial<FinderFilters> = {
    utility: [
      { key: 'recovery', members: [] },
      { key: 'pivot', members: [] },
    ],
  };
  const evaluate = (lineId: string, mode: 'same_stage' | 'anywhere') => {
    const line = ix.byLineId.get(lineId);
    if (!line) throw new Error(`fixture line ${lineId} missing`);
    return evaluateLine(line, compileCriteria({ ...EMPTY_FILTERS, ...healingMomentum }, ix, { banned: BANNED }), mode);
  };

  it('explains each criterion and that they never hold together (V7, anywhere)', () => {
    const evaluation = evaluate('mona--x', 'anywhere');
    const html = renderWithI18n(
      <HoverDetailsContent
        evaluation={evaluation}
        entry={entryOf('mona--x')}
        filters={{ ...EMPTY_FILTERS, ...healingMomentum }}
        ix={ix}
        stageMode="anywhere"
        names={testNames}
      />,
    );
    expect(html).toContain('Recovery ✓');
    expect(html).toContain('Regenerator, from Monx');
    expect(html).toContain('U-turn, from Monamid');
    expect(html).toContain('Not all on the same Pokémon');
    expect(html).not.toContain('Stage');
  });

  it('lists a utility result once: no second "Utility matches" section', () => {
    const html = renderWithI18n(
      <HoverDetailsContent
        evaluation={evaluate('mona--x', 'anywhere')}
        entry={entryOf('mona--x')}
        filters={{ ...EMPTY_FILTERS, ...healingMomentum }}
        ix={ix}
        stageMode="anywhere"
        names={testNames}
      />,
    );
    expect(html).not.toContain('Utility matches');
    expect(html.match(/Regenerator/g)).toHaveLength(1);
    expect(html.match(/U-turn/g)).toHaveLength(1);
  });

  it('names the Pokémon of the first stage in the data locale (a branch form too)', () => {
    const filters = { ...EMPTY_FILTERS, utility: [{ key: 'hazards' as const, members: [] }] };
    const line = ix.byLineId.get('oshawott--samurotthisui');
    if (!line) throw new Error('fixture line missing');
    const evaluation = evaluateLine(line, compileCriteria(filters, ix, { banned: BANNED }), 'anywhere');
    const content = (
      <HoverDetailsContent
        evaluation={evaluation}
        entry={entryOf('oshawott--samurotthisui')}
        filters={filters}
        ix={ix}
        stageMode="anywhere"
        names={testNames}
      />
    );
    expect(renderWithI18n(content)).toContain('Spikes, from Samurott-Hisui');
    expect(renderWithI18n(content, { locale: 'de' })).toContain('Stachler, ab Hisui-Admurai');
  });

  it('says from which stage everything holds at once (V6, same stage) in German', () => {
    const html = renderWithI18n(
      <HoverDetailsContent
        evaluation={evaluate('monb--y', 'same_stage')}
        entry={entryOf('monb--y')}
        filters={{ ...EMPTY_FILTERS, ...healingMomentum }}
        ix={ix}
        stageMode="same_stage"
        names={testNames}
      />,
      { locale: 'de' },
    );
    expect(html).toContain('Heilung ✓');
    expect(html).toContain('Alles gleichzeitig – ab Mony');
  });

  it('shows the special rule with its language and nothing core', () => {
    const entry = { ...entryOf('cosmog--solgaleo'), specialRules: { text: 'Beispielregel: startet mit 5 KOs.', lang: 'de' as const } };
    const html = renderWithI18n(
      <HoverDetailsContent evaluation={null} entry={entry} filters={EMPTY_FILTERS} ix={ix} stageMode="same_stage" names={testNames} />,
    );
    expect(html).toContain('Special rule');
    expect(html).toContain('<p lang="de"');
    expect(html).not.toContain('27 P');
    expect(hasHoverDetails(null, entry)).toBe(true);
    expect(hasHoverDetails(null, entryOf('mona--x'))).toBe(false);
  });
});
