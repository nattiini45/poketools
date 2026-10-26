import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { runFinder } from '@/lib/draft-finder/engine';
import { EMPTY_FILTERS, initialFinderState, SORT_KEYS, type FinderViewState } from '@/lib/draft-finder/filter-types';
import { prepareIndex } from '@/lib/draft-finder/prepare';
import { PRICE_TAB_KEYS } from '@/lib/draft-finder/tabs';
import { BANNED, buildFixtureCatalog, buildFixtureIndex, stubNames } from '@/lib/draft-finder/__tests__/fixture-index';
import { computeClock } from '@/lib/draft-ui/clock';
import { toDraftViewModel, type CardState } from '@/lib/draft-ui/snapshot-adapter';
import { snapshot } from '@/lib/draft-ui/__tests__/fixtures';
import DraftToolClient from '../DraftToolClient';
import DraftToolScreen, { type DraftToolScreenProps } from '../DraftToolScreen';
import { applyStickyOffsets, observeStickyOffsets, type StickyBars } from '../hooks/use-sticky-offsets';
import { NOTIFY_UNSUPPORTED } from '../hooks/use-turn-watch';
import FilterPanel from '../right/FilterPanel';
import FinderBar from '../right/FinderBar';
import RosterCard, { CARD_SPRITE_PX, FOOTER_SPRITE_PX } from '../right/RosterCard';
import styles from '../draft-tool.module.css';

/**
 * The line wall's layout contract (owner feedback 2026-10-18): the grid scrolls inside the wall pane from
 * 1024 px (and, beside it, the left column in its own scroller; the page header is the screen's first row, so
 * the document never scrolls there), the price tabs are pinned on top of the wall at every breakpoint, every card has one size and one
 * row skeleton with or without a branch footer, the card's slant lives in ONE frame layer (no counter-skewed
 * content, so the wall never scrolls sideways), the search field keeps a real width, and the sticky offsets
 * are measured instead of a silent 64 px fallback.
 */

vi.mock('@/components/shared/PokemonSprite', () => ({
  default: ({ name, size }: { name: string; size?: number }) => <span data-sprite={name} data-size={size} />,
}));

const SCREEN_SRC = readFileSync(path.resolve(__dirname, '../DraftToolScreen.tsx'), 'utf8');
const TIMER_SRC = readFileSync(path.resolve(__dirname, '../layout/TimerBar.tsx'), 'utf8');
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
    // The screen has a bounded height there (the grid's scroll range): the viewport minus the nav and the public
    // layout's main padding. The page header is the screen's own first row, so nothing else is subtracted and the
    // page itself does not scroll past it.
    const screen = rule('.screen', media('(min-width: 1024px)', '.screen'));
    expect(screen).toMatch(/height: calc\(100dvh - var\(--nav-h\) - var\(--draft-page-pad-y\)\);/);
    expect(CSS).toMatch(/--draft-page-pad-y: 3rem;/);
    // The floor: in a very short window the page scrolls instead of crushing the panes.
    expect(screen).toMatch(/min-height: 600px;/);
  });

  it('gives the page header its own grid row, ahead of the clock row, so it sits inside the fixed height', () => {
    // Phones and tablets: sorted first, full width; no fixed height there.
    expect(rule('.screenHeader')).toMatch(/order: 0;/);
    expect(CSS).toMatch(/\.screenHeader,\s*\.clockRow,\s*\.orderRow \{\s*grid-column: 1 \/ -1;/);
    // Tablet rows (header, clock, panes; the order strip is hidden) and the desktop's extra row for the strip.
    expect(rule('.screen', media('(min-width: 768px)', '.screen'))).toMatch(/grid-template-rows: auto auto minmax\(0, 1fr\);/);
    expect(rule('.screenWithHeader', media('(min-width: 1024px)', '.screenWithHeader'))).toMatch(
      /grid-template-rows: auto auto auto minmax\(0, 1fr\);/,
    );
    // The root takes the extra track only when it has a header; the header row precedes the clock row.
    expect(SCREEN_SRC).toMatch(/header \? `\$\{styles\.root\} \$\{styles\.screen\} \$\{styles\.screenWithHeader\}`/);
  });

  it('scrolls the left column in an inner scroller, so its scrollbar stays clear of the diagonal clip', () => {
    // The clipped frame is not a scroller; the scroller ends 3.75rem short of its right edge (the diagonal takes 48px).
    const frame = rule('.stagePane', media('(min-width: 1024px)', '.stagePane'));
    expect(frame).toMatch(/clip-path: polygon\(/);
    expect(frame).toMatch(/padding-right: 3\.75rem;/);
    expect(frame).not.toMatch(/overflow/);
    const scroller = rule('.stageScroll', media('(min-width: 1024px)', '.stageScroll'));
    expect(scroller).toMatch(/overflow-y: auto;/);
    expect(scroller).toMatch(/min-height: 0;/);
    expect(scroller).toMatch(/flex: 1 1 auto;/);
    expect(scroller).toMatch(/padding-right: 0;/);
    // Phones dissolve both, so the card, the dock and the extras still order around the wall.
    expect(CSS).toMatch(/\.stagePane,\s*\.stageScroll \{\s*display: contents;/);
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
    // The row is a direct child of the screen (the tall containing block it sticks within), right after the header.
    expect(SCREEN_SRC).toMatch(
      /<div ref=\{rootRef\} className=\{screenClass\}>\s*\{header \? <div className=\{styles\.screenHeader\}>\{header\}<\/div> : null\}\s*<div ref=\{clockRowRef\} className=\{styles\.clockRow\}>/,
    );
  });

  it('keeps the line picture above the sticky bars: capped on phones, the stage card capped above the dock from 1024 px', () => {
    const phone = media('(max-width: 767px)', '.previewArea');
    expect(rule('.previewArea', phone)).toMatch(
      /max-height: calc\(100svh - var\(--nav-h\) - var\(--draft-clock-h\) - var\(--draft-bottom-bar-h\) - 1\.5rem\);/,
    );
    // From 1024 px the card ends where the dock begins: the scroller's height less the measured dock and the gap.
    const desktop = rule('.stageCard', media('(min-width: 1024px)', '.stageCard'));
    expect(desktop).toMatch(/max-height: calc\(100% - var\(--draft-dock-h\) - 0\.75rem\);/);
    expect(desktop).toMatch(/flex: 0 0 auto;/);
    // Too short a window: the card keeps its content height (the column scrolls) rather than overflowing its box.
    expect(desktop).toMatch(/min-height: min-content;/);
    // The dock's height is measured (a verdict can wrap), not assumed: the screen hands the dock to the offsets hook.
    expect(SCREEN_SRC).toMatch(/useStickyOffsets\(rootRef, clockRowRef, dockRef\);/);
    expect(SCREEN_SRC).toMatch(/<div ref=\{dockRef\} className=\{`\$\{styles\.ctaDock\}/);
    expect(rule('.tokens,\n.root')).toMatch(/--draft-dock-h: [\d.]+rem;/);
  });

  it('never lets the timer bar push past a narrow clock row (375 px phones)', () => {
    // The track's floor is capped by the line it is on, and its row's flex basis lets bar and digits wrap whole.
    expect(rule('.timerTrack')).toMatch(/min-width: min\(6rem, 100%\);/);
    expect(TIMER_SRC).toMatch(/className="flex min-w-0 flex-\[1_1_10rem\] flex-wrap/);
  });

  it('defines --nav-h once on the root instead of a silent 64 px fallback', () => {
    expect(CSS).not.toMatch(/var\(--nav-h,/);
    expect(rule('.tokens,\n.root')).toMatch(/--nav-h: calc\(4rem \+ 1px\);/);
  });

  it('gives every card one height token and one fixed row skeleton, rows included', () => {
    const tokens = rule('.tokens,\n.root');
    for (const token of [
      '--draft-card-h',
      '--draft-card-head',
      '--draft-card-sprite',
      '--draft-card-name',
      '--draft-card-meta',
      '--draft-card-footer',
    ]) {
      expect(tokens).toContain(`${token}:`);
    }
    // The card is the sum of its rows plus the frame's two borders.
    const height = tokens.replace(/\s+/g, ' ');
    for (const part of ['--draft-card-head', '--draft-card-sprite', '--draft-card-name', '--draft-card-meta', '--draft-card-footer']) {
      expect(height).toMatch(new RegExp(`--draft-card-h: calc\\([^;]*var\\(${part}\\)`));
    }
    expect(height).toMatch(/--draft-card-h: calc\([^;]*2 \* var\(--draft-card-border\)/);
    expect(rule('.card')).toMatch(/height: var\(--draft-card-h\);/);
    expect(rule('.wallGrid')).toMatch(/grid-auto-rows: var\(--draft-card-h\);/);
    const card = rule('.card');
    expect(card).toMatch(/display: grid;/);
    expect(card.replace(/\s+/g, ' ')).toContain(
      'grid-template-rows: var(--draft-card-head) var(--draft-card-sprite) var(--draft-card-name) var(--draft-card-meta) var(--draft-card-footer);',
    );
    const ellipsis = rule('.cardName,\n.cardMeta');
    expect(ellipsis).toMatch(/text-overflow: ellipsis;/);
    expect(ellipsis).toMatch(/white-space: nowrap;/);
    // The footer name wraps to two lines (a clamp), it is not an ellipsised single line.
    expect(rule('.cardFooterName')).toMatch(/-webkit-line-clamp: 2;/);
  });

  it('keeps the sprite constants of the card in step with the CSS boxes they fill', () => {
    const tokens = rule('.tokens,\n.root');
    const rem = (name: string) => Number(new RegExp(`${name}: ([\\d.]+)rem;`).exec(tokens)?.[1]) * 16;
    expect(rem('--draft-card-sprite')).toBe(CARD_SPRITE_PX);
    expect(rem('--draft-card-footer-sprite')).toBe(FOOTER_SPRITE_PX);
    // The Pokémon dominates its card: the sprite row is the tallest, well above the old 64px.
    expect(CARD_SPRITE_PX).toBeGreaterThanOrEqual(80);
  });

  it('defines the card skew once (−6deg, −8deg from 1024 px) and derives every slant length from it', () => {
    expect(CSS.match(/--draft-card-skew:/g)).toHaveLength(2);
    expect(rule('.tokens,\n.root')).toMatch(/--draft-card-skew: -6deg;/);
    expect(rule('.tokens,\n  .root', media('(min-width: 1024px)', '.tokens,\n  .root'))).toMatch(/--draft-card-skew: -8deg;/);
    // No hand-written angle anywhere else: the frame, the dock tiles (and their lean-back) all read the token.
    const angles = [...CSS.matchAll(/skewX\(([^;]*)\);/g)].map((m) => m[1]);
    expect(angles).toHaveLength(4);
    for (const angle of angles) expect(angle).toContain('var(--draft-card-skew)');
    // The grid pads its sides by the corner overhang plus the ring; no overflow-x rule hides a scrollbar.
    const tokens = rule('.tokens,\n.root').replace(/\s+/g, ' ');
    expect(tokens).toMatch(/--draft-card-overhang: calc\(var\(--draft-card-h\) \/ 2 \* tan\(var\(--draft-card-skew\)\) \* -1\);/);
    expect(tokens).toMatch(/--draft-card-grid-inset: calc\(var\(--draft-card-overhang\) \+ var\(--draft-card-ring\)\);/);
    expect(rule('.wallGrid')).toMatch(/padding-inline: var\(--draft-card-grid-inset\);/);
    expect(rule('.wallGrid')).toMatch(/minmax\(var\(--draft-card-min\), 1fr\)/);
    // The structural fix is the padding; no sideways overflow rule on the scroller or the grid hides a bar.
    expect(rule('.wallGrid')).not.toMatch(/overflow/);
    expect(media('(min-width: 1024px)', '.wallScroll')).not.toMatch(/overflow-x/);
  });

  it('carries the slant in the frame layer only: no transformed element inside the card', () => {
    expect(rule('.cardFrame')).toMatch(/transform: skewX\(var\(--draft-card-skew\)\);/);
    // Every other `.card*` rule (content rows, the footer plate inside the frame) is free of transforms.
    const cardRules = [...CSS.matchAll(/(?:^|\n)(\.card\w*)(?:[^{}]*)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1], body: m[2] }));
    expect(cardRules.length).toBeGreaterThan(8);
    expect(cardRules.filter((r) => /transform:/.test(r.body)).map((r) => r.selector)).toEqual(['.cardFrame']);
    // The frame sits behind the content without leaving the card, and keeps the state colour classes' hands off.
    expect(rule('.card')).toMatch(/isolation: isolate;/);
    expect(rule('.cardFrame')).toMatch(/z-index: -1;/);
    expect(rule('.cardFrame')).not.toMatch(/\bborder:|border-color:/);
  });

  it('puts the head row on one centre line, shifted by the slant at its own height', () => {
    const head = rule('.cardHead');
    expect(head).toMatch(/align-items: center;/);
    expect(head).toMatch(/justify-content: space-between;/);
    expect(head).toMatch(/left: var\(--draft-card-head-shift\);/);
    expect(rule('.cardFooter')).toMatch(/right: var\(--draft-card-footer-shift\);/);
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

/** The class tokens of the card's frame layer (`styles.cardFrame ...`). */
function frameClasses(html: string): string[] {
  const cls = new RegExp(`class="(${styles.cardFrame} [^"]*)"`).exec(html)?.[1] ?? '';
  return cls.split(/\s+/).filter(Boolean);
}

/** Border-width tokens (`border`, `border-2`, `border-[3px]`, `md:border-x`...), colour tokens excluded. */
function borderWidths(tokens: readonly string[]): string[] {
  return tokens.filter((t) => /(?:^|:)border(?:-[xytrbl])?(?:-\d+|-\[\d+px\])?$/.test(t)).sort();
}

describe('RosterCard structure', () => {
  // The five rows in order, each with the same full class list on every card variant.
  const SKELETON = rows(card('gastly--gengar'));

  it('renders the same rows with and without a branch, the footer reserved but empty when unused', () => {
    const branched = card('teddiursa--ursalunabloodmoon');
    const plain = card('gastly--gengar');
    expect(SKELETON.map((r) => r.split(':')[0])).toEqual(['head', 'sprite', 'name', 'meta', 'footer']);
    expect(SKELETON[0]).toContain(styles.cardHead);
    expect(SKELETON[1]).toContain(styles.cardSprite);
    expect(SKELETON[4]).toContain(styles.cardFooter);
    expect(rows(branched)).toEqual(SKELETON);
    expect(rows(plain)).toEqual(SKELETON);
    expect(plain).toMatch(/data-card-row="footer" data-branch="false" aria-hidden="true"><\/span>/);
    expect(branched).toContain('data-card-row="footer" data-branch="true"');
    // The option is the unskewed grid cell; the frame is its first child.
    for (const html of [branched, plain]) {
      expect(html).toMatch(new RegExp(`class="${styles.card} [^"]*"[^>]*><span aria-hidden="true" class="${styles.cardFrame} `));
    }
  });

  it('keeps the same rows for drafted, mine, blocked and pinned cards (the owner row is always there)', () => {
    expect(rows(card('gastly--gengar', 'drafted', 'Misty'))).toEqual(SKELETON);
    expect(rows(card('gastly--gengar', 'mine', 'Dawn'))).toEqual(SKELETON);
    expect(rows(card('mona--x', 'blocked'))).toEqual(SKELETON);
    expect(rows(card('mona--x', 'available', null, true))).toEqual(SKELETON);
    expect(card('mona--x')).toMatch(/data-card-row="meta" aria-hidden="true"><\/span>/);
  });

  it('slants only the frame layer: no skew utility, no counter-skew, and the dimming sits on the whole card', () => {
    for (const html of [card('teddiursa--ursalunabloodmoon'), card('mona--x', 'blocked', null, true)]) {
      expect(html).not.toMatch(/skew-x|skewX/);
      expect(html.match(new RegExp(`class="${styles.cardFrame} `, 'g'))).toHaveLength(1);
    }
    const blocked = card('mona--x', 'blocked');
    expect(new RegExp(`class="${styles.card} [^"]*grayscale`).test(blocked)).toBe(true);
    expect(frameClasses(blocked).includes('grayscale')).toBe(false);
  });

  it('shows the final stage in the footer of a branched line: blob sprite, arrow icon, full name in the title', () => {
    const html = card('teddiursa--ursalunabloodmoon');
    const footer = /data-card-row="footer" data-branch="true" title="([^"]+)"/.exec(html);
    expect(footer?.[1]).toMatch(/^→ /);
    const finalName = footer?.[1].slice(2) ?? '';
    expect(finalName.length).toBeGreaterThan(0);
    expect(html).toContain(`class="${styles.cardFooterName}">${finalName}</span>`);
    expect(html).toContain(`data-sprite="${finalName}"`);
    expect(html).toContain(`data-size="${FOOTER_SPRITE_PX}"`);
    // The arrow is a decorative icon, not a glyph in the text.
    expect(html).toMatch(new RegExp(`<svg[^>]*class="[^"]*lucide-arrow-right ${styles.cardFooterArrow}[^"]*" aria-hidden="true"`));
    // The slanted plate is a layer inside the frame, only when there is a footer.
    expect(html.match(new RegExp(styles.cardFooterPlate, 'g'))).toHaveLength(1);
    expect(card('gastly--gengar')).not.toContain(styles.cardFooterPlate);
  });

  it('puts the star cluster first and the price pill last in the head row, the lock next to the pill', () => {
    const plain = card('mona--x');
    const star = plain.indexOf('data-favorite');
    const pill = plain.indexOf(' P</span>');
    expect(plain.indexOf('data-card-row="head"')).toBeLessThan(star);
    expect(star).toBeLessThan(pill);
    const blocked = card('mona--x', 'blocked');
    const lock = blocked.indexOf('<svg aria-hidden="true" width="12"');
    expect(lock).toBeGreaterThan(blocked.indexOf('data-favorite'));
    expect(lock).toBeLessThan(blocked.indexOf(' P</span>'));
  });

  it('draws the favourite star as a gold SVG: outline when not a favourite, filled when it is', () => {
    const star = (isFavorite: boolean) =>
      renderWithI18n(
        <RosterCard
          entry={entryOf('mona--x')}
          state="available"
          ownerName={null}
          isPinned={false}
          isFavorite={isFavorite}
          inCompare={false}
          reasonText={null}
          names={stubNames}
          dl="en"
        />,
      );
    const off = star(false);
    const on = star(true);
    expect(off).toContain('data-favorite="false"');
    expect(off).toContain('data-filled="false"');
    expect(off).toContain('fill-transparent');
    expect(on).toContain('data-favorite="true"');
    expect(on).toContain('data-filled="true"');
    expect(on).toContain('fill-[color:var(--draft-star)]');
    // The gold is the token in both states, not a text glyph and not the world accent.
    for (const html of [off, on]) {
      expect(html).toContain('stroke-[color:var(--draft-star)]');
      expect(html).not.toMatch(/[★☆]/);
    }
  });

  it('draws the pinned ring as a shadow, not a thicker border (same inner size)', () => {
    const pinned = frameClasses(card('mona--x', 'available', null, true));
    const plain = frameClasses(card('mona--x'));
    expect(pinned.length).toBeGreaterThan(0);
    // The border width is the frame rule's token for every state; no width utility on the frame.
    expect(borderWidths(pinned)).toEqual([]);
    expect(borderWidths(plain)).toEqual([]);
    expect(rule('.cardFrame')).toMatch(/border-width: var\(--draft-card-border\);/);
    expect(pinned.some((t) => t.startsWith('shadow-[0_0_0_1px_var(--draft-accent'))).toBe(true);
    expect(plain.some((t) => t.startsWith('shadow-[0_0_0_1px'))).toBe(false);
  });

  it('shows the keyboard focus ring on the slanted frame, not on the unskewed option', () => {
    const html = card('mona--x');
    expect(rule('.card:focus-visible > .cardFrame')).toMatch(/outline: 2px solid var\(--poke-focus\);/);
    expect(new RegExp(`class="${styles.card} [^"]*outline-none`).test(html)).toBe(true);
    expect(html).not.toContain('focus-visible:outline');
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
    weaknessStage: 'final',
    onWeaknessStage: noop,
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

describe('DraftToolScreen page header', () => {
  const view = initialFinderState();

  it('renders the host header as the first row of the screen, before the clock row', () => {
    const html = renderWithI18n(<DraftToolScreen {...screenProps(view)} header={<h1>Room title</h1>} />);
    const root = html.indexOf(`<div class="${styles.root} ${styles.screen} ${styles.screenWithHeader}">`);
    const header = html.indexOf(`<div class="${styles.screenHeader}"><h1>Room title</h1></div>`);
    const clock = html.indexOf(`class="${styles.clockRow}"`);
    expect(root).toBe(0);
    expect(header).toBeGreaterThan(root);
    expect(clock).toBeGreaterThan(header);
  });

  it('adds no header row or track without one (the dev preview keeps its picker outside)', () => {
    const html = renderWithI18n(<DraftToolScreen {...screenProps(view)} />);
    expect(html.startsWith(`<div class="${styles.root} ${styles.screen}">`)).toBe(true);
    expect(html).not.toContain(`class="${styles.screenHeader}"`);
    expect(html).not.toContain(styles.screenWithHeader);
  });

  it('keeps the header above the loading placeholder while there is no snapshot yet', () => {
    const html = renderWithI18n(
      <DraftToolClient
        header={<h1>Room title</h1>}
        poolId="pool"
        seasonId="season"
        leagueName="League"
        catalog={catalog}
        initialSnapshot={null}
        indexUrl="/index"
        viewer={{ playerId: null, isSiteAdmin: false }}
        links={screenProps(view).links}
      />,
    );
    expect(html).toContain(`<div class="${styles.screenHeader}"><h1>Room title</h1></div>`);
    expect(html.indexOf('role="status"')).toBeGreaterThan(html.indexOf('Room title'));
  });

  it('wraps the whole left column in one scroller inside the frame, before the wall', () => {
    const html = renderWithI18n(<DraftToolScreen {...screenProps(initialFinderState({ pinnedLineId: 'gastly--gengar' }))} />);
    const open = `<div class="${styles.stagePane}"><div class="${styles.stageScroll}">`;
    expect(html).toContain(open);
    // The frame holds nothing but the scroller: the dock and the extras are inside it.
    const scroller = html.indexOf(open);
    const wall = html.indexOf(`class="${styles.wallPane}"`);
    expect(html.indexOf(`class="${styles.extras}"`)).toBeGreaterThan(scroller);
    expect(html.indexOf(`class="${styles.extras}"`)).toBeLessThan(wall);
    expect(html.indexOf(styles.ctaDock)).toBeGreaterThan(scroller);
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

  it('offers every sort key of the stored preference in the sort select, in order', () => {
    const html = renderWithI18n(
      <FinderBar view={initialFinderState()} dispatch={() => {}} indexReady filterPanelId="fp" names={stubNames} />,
    );
    const select = /<select[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? '';
    const values = [...select.matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => m[1]);
    expect(values).toEqual([...SORT_KEYS]);
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
  /** A stand-in bar: the node test environment has no DOM, and only the measured height matters. */
  const box = (height: number) => ({ getBoundingClientRect: () => ({ height }) as DOMRect }) as unknown as HTMLElement;
  const rootOf = (set: Map<string, string>) => ({ style: { setProperty: (k: string, v: string | null) => void set.set(k, v ?? '') } });
  const bars = (patch: Partial<StickyBars> = {}): StickyBars => ({ nav: null, clock: null, dock: null, ...patch });

  it('writes the measured nav, clock and dock heights, rounded up', () => {
    const set = new Map<string, string>();
    applyStickyOffsets(rootOf(set), bars({ nav: box(64.4), clock: box(52), dock: box(118.2) }));
    expect(set.get('--nav-h')).toBe('65px');
    expect(set.get('--draft-clock-h')).toBe('52px');
    expect(set.get('--draft-dock-h')).toBe('119px');
  });

  it('observes the nav, the clock row and the dock, re-applies on resize and disconnects on clean-up', () => {
    const set = new Map<string, string>();
    const root = rootOf(set) as unknown as HTMLElement;
    let navH = 64;
    let dockH = 100;
    const nav = { getBoundingClientRect: () => ({ height: navH }) as DOMRect } as HTMLElement;
    const clock = box(48) as HTMLElement;
    const dock = { getBoundingClientRect: () => ({ height: dockH }) as DOMRect } as HTMLElement;
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
    const cleanup = observeStickyOffsets(root, { nav, clock, dock }, StubObserver);
    expect(set.get('--nav-h')).toBe('64px');
    expect(set.get('--draft-dock-h')).toBe('100px');
    expect(observed).toEqual([nav, clock, dock]);
    navH = 120;
    dockH = 140;
    fire();
    expect(set.get('--nav-h')).toBe('120px');
    expect(set.get('--draft-dock-h')).toBe('140px');
    cleanup();
    expect(disconnected).toBe(1);
  });

  it('observes only the bars the page has, and measures once without ResizeObserver', () => {
    const set = new Map<string, string>();
    const root = rootOf(set) as unknown as HTMLElement;
    const clock = box(40) as HTMLElement;
    const observed: unknown[] = [];
    class StubObserver {
      observe(target: Element) {
        observed.push(target);
      }
      disconnect() {}
    }
    observeStickyOffsets(root, bars({ clock }), StubObserver)();
    expect(observed).toEqual([clock]);
    expect(set.get('--nav-h')).toBe('0px');
    set.clear();
    const cleanup = observeStickyOffsets(root, bars({ clock }), undefined);
    expect(set.get('--draft-clock-h')).toBe('40px');
    expect(() => cleanup()).not.toThrow();
  });

  it('treats a missing nav as 0 px and leaves the CSS defaults without a clock row or a dock', () => {
    const set = new Map<string, string>();
    applyStickyOffsets(rootOf(set), bars());
    expect(set.get('--nav-h')).toBe('0px');
    expect(set.has('--draft-clock-h')).toBe(false);
    expect(set.has('--draft-dock-h')).toBe(false);
  });
});
