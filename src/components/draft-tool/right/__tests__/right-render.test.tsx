import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import { buildChips } from '@/lib/draft-finder/chips';
import { compileCriteria, evaluateLine, runFinder } from '@/lib/draft-finder/engine';
import { EMPTY_FILTERS, initialFinderState, type FinderFilters, type FinderViewState } from '@/lib/draft-finder/filter-types';
import { prepareIndex } from '@/lib/draft-finder/prepare';
import { BANNED, buildFixtureCatalog, buildFixtureIndex } from '@/lib/draft-finder/__tests__/fixture-index';
import { toDraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import { snapshot } from '@/lib/draft-ui/__tests__/fixtures';
import ActiveFilterChips from '../ActiveFilterChips';
import FilterPanel from '../FilterPanel';
import FinderBar from '../FinderBar';
import { HoverDetailsContent, hasHoverDetails, utilityResults } from '../HoverDetails';
import PriceTabs from '../PriceTabs';
import RosterCard from '../RosterCard';
import RosterWall from '../RosterWall';
import { testNames } from './label-context';

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
    expect(html).toContain('→ Hisui-Admurai');
    expect(html).toContain('data-sprite="Samurott-Hisui"');
    expect(html).toContain('25 P');
    expect(html).toContain('aria-selected="true"');
    // The favourite star is a pointer-only shortcut: no focusable control nested inside role="option".
    expect(html).toContain('data-favorite="true"');
    expect(html).not.toContain('<button');
    expect(html).toContain('aus den Favoriten entfernen');
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
    const de = renderWithI18n(<ActiveFilterChips chips={chips} count={7} onRemove={noop} onClearAll={noop} names={testNames} />, {
      locale: 'de',
    });
    expect(de).toContain('Boden');
    expect(de).toContain('Alle Filter löschen');
    expect(de).toContain('7 Linien');
  });

  it('renders nothing without chips', () => {
    expect(renderWithI18n(<ActiveFilterChips chips={[]} count={48} onRemove={noop} onClearAll={noop} />)).toBe('');
  });
});

describe('FinderBar', () => {
  it('renders search, stage mode, filters, sort and "show drafted" in English', () => {
    const html = renderWithI18n(<FinderBar view={view()} dispatch={noop} count={48} indexReady names={testNames} />);
    expect(html).toContain('placeholder="Search any stage (EN/DE)"');
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/aria-checked="true"[^>]*>On the same Pokémon</);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Speed (final stage)');
    expect(html).toContain('BST (final stage)');
    expect(html).toContain('Show drafted');
    expect(html).toContain('48 lines');
  });

  it('renders German and the loading state of the Filters button', () => {
    const html = renderWithI18n(<FinderBar view={view()} dispatch={noop} count={48} indexReady={false} names={testNames} />, {
      locale: 'de',
    });
    expect(html).toContain('Am selben Pokémon');
    expect(html).toContain('Irgendwo in der Linie');
    expect(html).toContain('Init. (Endstufe)');
    expect(html).toContain('Gedraftete anzeigen');
    expect(html).toContain('Filter werden geladen');
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it('leaves the count to the chip bar while chip filters are active', () => {
    const html = renderWithI18n(
      <FinderBar view={view({}, { maxPrice: 20 })} dispatch={noop} count={4} indexReady names={testNames} />,
    );
    expect(html).not.toContain('4 lines');
  });
});

describe('FilterPanel', () => {
  const open = (filters: Partial<FinderFilters> = {}) => view({ filterPanelOpen: true }, filters);

  it('renders nothing while closed', () => {
    expect(
      renderWithI18n(<FilterPanel view={view()} dispatch={noop} ix={ix} names={testNames} dl="en" banned={BANNED} />),
    ).toBe('');
  });

  it('renders every section, the pack utility categories and 18 types', () => {
    const html = renderWithI18n(<FilterPanel view={open()} dispatch={noop} ix={ix} names={testNames} dl="en" banned={BANNED} />);
    expect(html).toContain('role="dialog"');
    for (const heading of ['Type', 'Moves', 'Abilities', 'Base stats', 'Maximum price', 'Utility', 'Advanced']) {
      expect(html).toContain(`>${heading}</h3>`);
    }
    for (const category of ['Hazards', 'Hazard control', 'Recovery', 'Pivoting', 'Priority']) {
      expect(html).toContain(`<span>${category}</span>`);
    }
    expect(html).toContain('Count abilities');
    expect(html).toContain('Any price');
    // Type and move "Any / Require all" (2 + 2) and the three defensive relations.
    expect(countOf(html, 'role="radio"')).toBe(7);
  });

  it('lists banned members with a pill and a disabled checkbox, and notes Rest', () => {
    const html = renderWithI18n(
      <FilterPanel
        view={open({
          utility: [
            { key: 'pivot', members: ['uturn'] },
            { key: 'recovery', members: ['regenerator'] },
          ],
          maxPrice: 20,
        })}
        dispatch={noop}
        ix={ix}
        names={testNames}
        dl="en"
        banned={new Set([...BANNED, 'partingshot'])}
      />,
    );
    expect(html).toMatch(/disabled=""[^>]*\/><span class="line-through">Parting Shot<\/span><span[^>]*>banned<\/span>/);
    expect(html).toContain('Rest counts only when picked on its own.');
    expect(html).toContain('Up to 20 P');
  });

  it('renders German labels', () => {
    const html = renderWithI18n(
      <FilterPanel
        view={open({ utility: [{ key: 'pivot', members: ['uturn'] }] })}
        dispatch={noop}
        ix={ix}
        names={testNames}
        dl="de"
        banned={new Set([...BANNED, 'partingshot'])}
      />,
      { locale: 'de' },
    );
    expect(html).toContain('Pokémon-Linien filtern');
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
    expect(html).toContain('Regenerator, from Stage 3');
    expect(html).toContain('U-turn, from Stage 2');
    expect(html).toContain('Not all on the same Pokémon');
    expect(html).toContain('Recovery: Regenerator, from Stage 3');
    expect(utilityResults(evaluation)).toHaveLength(2);
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
    expect(html).toContain('Alles gleichzeitig – ab Stufe 3');
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
