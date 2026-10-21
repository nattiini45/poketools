import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { runFinder } from '@/lib/draft-finder/engine';
import { EMPTY_FILTERS, initialFinderState, type FinderViewState } from '@/lib/draft-finder/filter-types';
import { prepareIndex } from '@/lib/draft-finder/prepare';
import { PRICE_TAB_KEYS } from '@/lib/draft-finder/tabs';
import { BANNED, buildFixtureCatalog, buildFixtureIndex, stubNames } from '@/lib/draft-finder/__tests__/fixture-index';
import { computeClock } from '@/lib/draft-ui/clock';
import { toDraftViewModel, type CardState } from '@/lib/draft-ui/snapshot-adapter';
import { snapshot } from '@/lib/draft-ui/__tests__/fixtures';
import DraftToolScreen, { type DraftToolScreenProps } from '../DraftToolScreen';
import { applyStickyOffsets, observeStickyOffsets } from '../hooks/use-sticky-offsets';
import { NOTIFY_UNSUPPORTED } from '../hooks/use-turn-watch';
import FilterPanel from '../right/FilterPanel';
import FinderBar from '../right/FinderBar';
import RosterCard from '../right/RosterCard';
import styles from '../draft-tool.module.css';

/**
 * The line wall's layout contract (owner feedback 2026-10-18): the grid scrolls inside the wall pane from
 * 1024 px, the price tabs are pinned on top of the wall at every breakpoint, every card has one size and one
 * inner grid with or without a branch, the search field keeps a real width, and the sticky offsets are
 * measured instead of a silent 64 px fallback.
 */

vi.mock('@/components/shared/PokemonSprite', () => ({
  default: ({ name, size }: { name: string; size?: number }) => <span data-sprite={name} data-size={size} />,
}));

const SCREEN_SRC = readFileSync(path.resolve(__dirname, '../DraftToolScreen.tsx'), 'utf8');
const CSS = readFileSync(path.resolve(__dirname, '../draft-tool.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule `selector { … }` inside `scope` (the whole file or one @media block). */
function rule(selector: string, scope: string = CSS): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[\\s}])${esc}\\s*\\{([^}]*)\\}`).exec(scope);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

/** The body of the first `@media <query> { … }` block that contains `selector`. */
function media(query: string, selector: string): string {
  let from = 0;
  for (;;) {
    const at = CSS.indexOf(`@media ${query}`, from);
    if (at === -1) throw new Error(`no ${query} block with ${selector}`);
    let depth = 0;
    let i = CSS.indexOf('{', at);
    const start = i + 1;
    for (; i < CSS.length; i++) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}' && --depth === 0) break;
    }
    const body = CSS.slice(start, i);
    if (body.includes(`${selector} {`) || body.includes(`${selector}\n`)) return body;
    from = i;
  }
}

describe('wall layout CSS', () => {
  it('makes the grid wrapper the scroll container from 1024 px and keeps it positioned', () => {
    expect(rule('.wallScroll')).toMatch(/position: relative;/);
    const desktop = rule('.wallScroll', media('(min-width: 1024px)', '.wallScroll'));
    expect(desktop).toMatch(/overflow-y: auto;/);
    expect(desktop).toMatch(/min-height: 0;/);
    expect(desktop).toMatch(/flex: 1 1 auto;/);
    // The screen has a bounded height there (the grid's scroll range), minus the public layout's main padding,
    // so the page itself does not scroll past it.
    expect(rule('.screen', media('(min-width: 1024px)', '.screen'))).toMatch(
      /height: calc\(100dvh - var\(--nav-h\) - var\(--draft-page-pad-y\)\);/,
    );
    expect(CSS).toMatch(/--draft-page-pad-y: 3rem;/);
  });

  it('clips the wall pane without making it a scroller, so sticky tabs reach the viewport below 1024 px', () => {
    // The pane's own rule (not the shared `.stagePane, .wallPane` one): `hidden` first as the fallback, then `clip`.
    expect(CSS).toMatch(/\n\.wallPane \{[^}]*overflow: hidden;\s*overflow: clip;/);
    expect(rule('.wallPane > *')).toMatch(/flex-shrink: 0;/);
  });

  it('pins the price tabs: sticky under the nav (and the phone clock row), a fixed row from 1024 px', () => {
    const tabs = rule('.wallTabs');
    expect(tabs).toMatch(/position: sticky;/);
    expect(tabs).toMatch(/top: var\(--nav-h\);/);
    expect(tabs).toMatch(/background: var\(--draft-glass\);/);
    expect(rule('.wallTabs', media('(max-width: 767px)', '.wallTabs'))).toMatch(/top: calc\(var\(--nav-h\) \+ var\(--draft-clock-h\)\);/);
    expect(rule('.wallTabs', media('(min-width: 1024px)', '.wallTabs'))).toMatch(/position: static;/);
  });

  it('makes the clock ROW the sticky element on phones (its bar alone has no room to move)', () => {
    const phoneRow = rule('.clockRow', media('(max-width: 767px)', '.clockRow'));
    expect(phoneRow).toMatch(/position: sticky;/);
    expect(phoneRow).toMatch(/top: var\(--nav-h\);/);
    // The bar is not sticky on its own anywhere: its parent is exactly its height.
    expect(CSS).not.toMatch(/\.clockBar \{[^}]*position: sticky;/);
    // The row is a direct child of the screen (the tall containing block it sticks within).
    expect(SCREEN_SRC).toMatch(/className=\{`\$\{styles\.root\} \$\{styles\.screen\}`\}>\s*<div ref=\{clockRowRef\} className=\{styles\.clockRow\}>/);
  });

  it('defines --nav-h once on the root instead of a silent 64 px fallback', () => {
    expect(CSS).not.toMatch(/var\(--nav-h,/);
    expect(rule('.tokens,\n.root')).toMatch(/--nav-h: calc\(4rem \+ 1px\);/);
  });

  it('gives every card one height token and one fixed inner grid, rows included', () => {
    const tokens = rule('.tokens,\n.root');
    for (const token of ['--draft-card-h', '--draft-card-sprite', '--draft-card-name', '--draft-card-meta', '--draft-card-branch']) {
      expect(tokens).toContain(`${token}:`);
    }
    expect(rule('.card')).toMatch(/height: var\(--draft-card-h\);/);
    expect(rule('.wallGrid')).toMatch(/grid-auto-rows: var\(--draft-card-h\);/);
    const body = rule('.cardBody');
    expect(body).toMatch(/display: grid;/);
    expect(body.replace(/\s+/g, ' ')).toContain(
      'grid-template-rows: var(--draft-card-sprite) var(--draft-card-name) var(--draft-card-meta) var(--draft-card-branch);',
    );
    expect(rule('.cardBranch')).toMatch(/height: var\(--draft-card-branch\);/);
    const ellipsis = rule('.cardName,\n.cardMeta,\n.cardBranchLabel');
    expect(ellipsis).toMatch(/text-overflow: ellipsis;/);
    expect(ellipsis).toMatch(/white-space: nowrap;/);
  });
});

// ── render ───────────────────────────────────────────────────────────────

const catalog = buildFixtureCatalog();
const ix = prepareIndex(buildFixtureIndex(), stubNames);
const entryOf = (lineId: string) => {
  const entry = catalog.lines.find((l) => l.lineId === lineId);
  if (!entry) throw new Error(`fixture line ${lineId} missing`);
  return entry;
};

function card(lineId: string, state: CardState = 'available', ownerName: string | null = null, isPinned = false): string {
  return renderWithI18n(
    <RosterCard
      entry={entryOf(lineId)}
      state={state}
      ownerName={ownerName}
      isPinned={isPinned}
      isFavorite={false}
      inCompare={false}
      reasonText={null}
      names={stubNames}
      dl="en"
    />,
  );
}

/**
 * The card's row skeleton: each `data-card-row` with its full class list in order, minus the colour tokens
 * (the arbitrary-value `text-`/`bg-`/`border-` var classes), which legitimately follow the card state
 * (drafted ink, mine, blocked). Do not write a literal arbitrary-value class with a placeholder here:
 * Tailwind scans test files too and would emit invalid CSS for it.
 */
function rows(html: string): string[] {
  return [...html.matchAll(/<span class="([^"]*)" data-card-row="(\w+)"/g)].map(
    (m) => `${m[2]}:${m[1].split(/\s+/).filter((t) => !/^(?:text|bg|border)-\[var\(/.test(t)).join(' ')}`,
  );
}

/** The class tokens of the card's outer frame (`styles.card ...`). */
function frameClasses(html: string): string[] {
  const cls = new RegExp(`class="(${styles.card} [^"]*)"`).exec(html)?.[1] ?? '';
  return cls.split(/\s+/).filter(Boolean);
}

/** Border-width tokens (`border`, `border-2`, `border-[3px]`, `md:border-x`...), colour tokens excluded. */
function borderWidths(tokens: readonly string[]): string[] {
  return tokens.filter((t) => /(?:^|:)border(?:-[xytrbl])?(?:-\d+|-\[\d+px\])?$/.test(t)).sort();
}

describe('RosterCard structure', () => {
  // The four rows in order, each with the same full class list on every card variant.
  const SKELETON = rows(card('gastly--gengar'));

  it('renders the same rows with and without a branch, the branch row reserved but empty when unused', () => {
    const branched = card('teddiursa--ursalunabloodmoon');
    const plain = card('gastly--gengar');
    expect(SKELETON.map((r) => r.split(':')[0])).toEqual(['sprite', 'name', 'meta', 'branch']);
    expect(SKELETON[0]).toContain(styles.cardSprite);
    expect(SKELETON[3]).toContain(styles.cardBranch);
    expect(rows(branched)).toEqual(SKELETON);
    expect(rows(plain)).toEqual(SKELETON);
    expect(plain).toMatch(/data-card-row="branch" data-branch="false" aria-hidden="true"><\/span>/);
    expect(branched).toContain('data-branch="true"');
    // Both cards carry the fixed-size frame class.
    for (const html of [branched, plain]) expect(html).toMatch(new RegExp(`class="${styles.card} `));
  });

  it('keeps the same rows for drafted, mine, blocked and pinned cards (the owner row is always there)', () => {
    expect(rows(card('gastly--gengar', 'drafted', 'Misty'))).toEqual(SKELETON);
    expect(rows(card('gastly--gengar', 'mine', 'Dawn'))).toEqual(SKELETON);
    expect(rows(card('mona--x', 'blocked'))).toEqual(SKELETON);
    expect(rows(card('mona--x', 'available', null, true))).toEqual(SKELETON);
    expect(card('mona--x')).toMatch(/data-card-row="meta" aria-hidden="true"><\/span>/);
  });

  it('truncates a long branch label and names it in a title', () => {
    const html = card('teddiursa--ursalunabloodmoon');
    const branch = /data-card-row="branch" data-branch="true" title="([^"]+)"/.exec(html);
    expect(branch?.[1]).toMatch(/^→ /);
    expect(html).toContain(`class="${styles.cardBranchLabel}">${branch?.[1]}</span>`);
  });

  it('draws the pinned ring as a shadow, not a thicker border (same inner size)', () => {
    const pinned = frameClasses(card('mona--x', 'available', null, true));
    const plain = frameClasses(card('mona--x'));
    expect(pinned.length).toBeGreaterThan(0);
    // Same border widths as an unpinned card: only colour and the box-shadow ring differ.
    expect(borderWidths(pinned)).toEqual(borderWidths(plain));
    expect(pinned.some((t) => t.startsWith('shadow-[0_0_0_1px_var(--draft-accent'))).toBe(true);
    expect(plain.some((t) => t.startsWith('shadow-[0_0_0_1px'))).toBe(false);
  });
});

function screenProps(view: FinderViewState): DraftToolScreenProps {
  const dto = snapshot();
  const vm = toDraftViewModel(dto, catalog);
  const noop = () => {};
  return {
    vm,
    catalog,
    finder: runFinder({ ix, catalog, view, taken: dto.taken, favorites: new Set(), dataLocale: 'en', names: stubNames, banned: BANNED }),
    view,
    dispatch: noop,
    favorites: new Set(),
    clock: computeClock(vm.activeSlot, vm.serverNow),
    notify: NOTIFY_UNSUPPORTED,
    onNotifyToggle: noop,
    onDraft: noop,
    onExtension: noop,
    onToggleFavorite: noop,
    adminOverride: false,
    links: { redraft: '/r', tokens: '/t', admin: null, adminAudit: null, trainerCreator: '/c' },
    ix,
  };
}

describe('DraftToolScreen wall order', () => {
  it('puts the price tabs above the grid, outside the scroll container, with matching/total counts', () => {
    const view = { ...initialFinderState({ pinnedLineId: 'gastly--gengar' }), filters: { ...EMPTY_FILTERS, maxPrice: 26 } };
    const html = renderWithI18n(<DraftToolScreen {...screenProps(view)} />);
    const tablist = html.indexOf('role="tablist"');
    const scroll = html.indexOf(`class="relative ${styles.wallScroll}"`);
    const listbox = html.indexOf('role="listbox"');
    expect(tablist).toBeGreaterThan(-1);
    expect(scroll).toBeGreaterThan(tablist);
    expect(listbox).toBeGreaterThan(scroll);
    expect(html).toMatch(new RegExp(`role="tablist"[^>]*class="[^"]*${styles.wallTabs}`));
    // The search field and the chip row come first.
    expect(html.indexOf('type="search"')).toBeLessThan(tablist);
    expect(html).toMatch(/>\d+\/\d+</);
    expect(html).toContain(`class="${styles.wallGrid} grid`);
  });

  it.each([
    ['before the index loads', false],
    ['after the index failed', true],
  ])('keeps the price tabs above the grid %s, with catalog totals', (_label, indexFailed) => {
    const view = { ...initialFinderState(), filters: { ...EMPTY_FILTERS, maxPrice: 26 } };
    const props = { ...screenProps(view), finder: null, ix: null, indexFailed };
    const html = renderWithI18n(<DraftToolScreen {...props} />);
    const tablist = html.indexOf('role="tablist"');
    expect(tablist).toBeGreaterThan(-1);
    expect(html.indexOf('role="listbox"')).toBeGreaterThan(tablist);
    expect(html.indexOf(`class="relative ${styles.wallScroll}"`)).toBeGreaterThan(tablist);
    // No matching/total without a finder; the All tab carries the catalog total.
    expect(html).not.toMatch(/>\d+\/\d+</);
    const tabs = [...html.matchAll(/role="tab"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(tabs).toHaveLength(PRICE_TAB_KEYS.length);
    expect(tabs[tabs.length - 1]).toContain(String(catalog.lines.length));
    if (indexFailed) expect(html.indexOf('role="status"')).toBeLessThan(tablist);
  });

  it('wraps the price tabs from 768 px (all tabs visible on tablets) and scrolls them sideways on phones', () => {
    const view = { ...initialFinderState(), filters: { ...EMPTY_FILTERS, maxPrice: 26 } };
    const html = renderWithI18n(<DraftToolScreen {...screenProps(view)} />);
    const cls = /role="tablist"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(cls.split(' ')).toEqual(expect.arrayContaining(['overflow-x-auto', 'md:flex-wrap', 'md:overflow-x-visible']));
  });
});

describe('finder bar and filter sheet', () => {
  it('gives the search field a 16rem basis from 768 px instead of a 0 basis', () => {
    const html = renderWithI18n(
      <FinderBar view={initialFinderState()} dispatch={() => {}} indexReady filterPanelId="fp" names={stubNames} />,
    );
    const search = /<input type="search"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(search).toContain('md:flex-[1_1_16rem]');
    expect(search).not.toContain('md:flex-1');
  });

  it('renders the filters as a portalled sheet outside the wall pane (no anchored panel to clip)', () => {
    // Radix portals only after mount: nothing of the sheet lands in the server markup of the wall.
    const html = renderWithI18n(
      <FilterPanel
        id="fp"
        view={{ ...initialFinderState(), filterPanelOpen: true }}
        dispatch={() => {}}
        ix={ix}
        names={stubNames}
        dl="en"
        banned={new Set(BANNED)}
        count={3}
      />,
    );
    expect(html).toBe('');
    const wallEnd = SCREEN_SRC.indexOf('</section>', SCREEN_SRC.indexOf('className={styles.wallPane}'));
    expect(SCREEN_SRC.indexOf('<FilterPanel')).toBeGreaterThan(wallEnd);
    const sheet = readFileSync(path.resolve(__dirname, '../right/FilterPanel.tsx'), 'utf8');
    expect(sheet).toContain('fixed inset-0');
    expect(sheet).toContain('md:max-w-md');
    expect(sheet).not.toContain('md:absolute');
  });
});

describe('applyStickyOffsets', () => {
  const box = (height: number) => ({ getBoundingClientRect: () => ({ height }) as DOMRect });

  it('writes the measured nav and clock heights, rounded up', () => {
    const set = new Map<string, string>();
    applyStickyOffsets({ style: { setProperty: (k: string, v: string | null) => void set.set(k, v ?? '') } }, box(64.4), box(52));
    expect(set.get('--nav-h')).toBe('65px');
    expect(set.get('--draft-clock-h')).toBe('52px');
  });

  it('observes the nav and the clock row, re-applies on resize and disconnects on clean-up', () => {
    const set = new Map<string, string>();
    const root = { style: { setProperty: (k: string, v: string | null) => void set.set(k, v ?? '') } } as unknown as HTMLElement;
    let navH = 64;
    const nav = { getBoundingClientRect: () => ({ height: navH }) as DOMRect } as HTMLElement;
    const clock = box(48) as HTMLElement;
    const observed: unknown[] = [];
    let fire = () => {};
    let disconnected = 0;
    class StubObserver {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe(target: Element) {
        observed.push(target);
      }
      disconnect() {
        disconnected++;
      }
    }
    const cleanup = observeStickyOffsets(root, nav, clock, StubObserver);
    expect(set.get('--nav-h')).toBe('64px');
    expect(observed).toEqual([nav, clock]);
    navH = 120;
    fire();
    expect(set.get('--nav-h')).toBe('120px');
    cleanup();
    expect(disconnected).toBe(1);
  });

  it('observes only the clock row when the page has no nav, and measures once without ResizeObserver', () => {
    const set = new Map<string, string>();
    const root = { style: { setProperty: (k: string, v: string | null) => void set.set(k, v ?? '') } } as unknown as HTMLElement;
    const clock = box(40) as HTMLElement;
    const observed: unknown[] = [];
    class StubObserver {
      observe(target: Element) {
        observed.push(target);
      }
      disconnect() {}
    }
    observeStickyOffsets(root, null, clock, StubObserver)();
    expect(observed).toEqual([clock]);
    expect(set.get('--nav-h')).toBe('0px');
    set.clear();
    const cleanup = observeStickyOffsets(root, null, clock, undefined);
    expect(set.get('--draft-clock-h')).toBe('40px');
    expect(() => cleanup()).not.toThrow();
  });

  it('treats a missing nav as 0 px and leaves the clock default without a clock row', () => {
    const set = new Map<string, string>();
    applyStickyOffsets({ style: { setProperty: (k: string, v: string | null) => void set.set(k, v ?? '') } }, null, null);
    expect(set.get('--nav-h')).toBe('0px');
    expect(set.has('--draft-clock-h')).toBe(false);
  });
});
