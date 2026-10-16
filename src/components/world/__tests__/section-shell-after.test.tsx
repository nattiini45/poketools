/**
 * SectionShell's `after` slot, and the #pulse sections that put the league
 * hub in it.
 *
 * The reveal group fades its items in once 15% of the group is on screen; a
 * body taller than about 6.7 viewports (the league hub) can never reach that,
 * so the hub would stay at opacity 0. `after` renders outside the group but
 * still inside the <section> (the route-live paint rules key off it).
 *
 * Rendered through react-dom/server (vitest 'node' env, no DOM) and read back
 * with a small parser for React's static markup. `@/components/world/Reveal`
 * is stubbed by default with plain marked wrappers (data-reveal="group" /
 * "item") so the structure is easy to name; one test switches to the real
 * motion primitives to show where the server-rendered opacity 0 lands.
 * `next/link` is a plain anchor. The preview fixtures import the route-data
 * module, whose query modules import the Supabase client: a stub that throws
 * on use, so nothing here reads.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';

const reveal = vi.hoisted(() => ({ actual: false }));

vi.mock('@/components/world/Reveal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/world/Reveal')>();
  const { createElement } = await import('react');
  type Props = { children: ReactNode; className?: string };
  const stub = (role: string, real: (props: Props) => ReactNode) =>
    function RevealStub(props: Props) {
      if (reveal.actual) return createElement(real, props);
      return createElement('div', { 'data-reveal': role, className: props.className }, props.children);
    };
  return {
    ...actual,
    RevealGroup: stub('group', actual.RevealGroup),
    RevealItem: stub('item', actual.RevealItem),
    default: stub('single', actual.default),
  };
});

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  function Link({
    href,
    children,
    scroll: _scroll,
    prefetch: _prefetch,
    ...rest
  }: {
    href: string | { pathname?: string };
    children?: ReactNode;
    scroll?: boolean;
    prefetch?: boolean | null;
    [key: string]: unknown;
  }) {
    return createElement('a', { ...rest, href: typeof href === 'string' ? href : (href.pathname ?? '') }, children);
  }
  return { default: Link };
});

vi.mock('@/lib/supabase/client', () => ({
  get supabase(): never {
    throw new Error('section render must not reach Supabase');
  },
}));

import SectionShell from '../SectionShell';
import SharedPulseSection from '../sections/PulseSection';
import EvoligaPulseSection from '../evoliga/PulseSection';
import SakuraPulseSection from '../themes/sakura/sections/PulseSection';
import MountainPulseSection from '../themes/mountain/sections/PulseSection';
import CloudsPulseSection from '../themes/clouds/sections/PulseSection';
import { sakuraSectionCopyFor } from '../themes/sakura/sections/copy';
import { toSakuraRouteData, type SakuraRouteData } from '../themes/sakura/types';
import { toMountainRouteData } from '../themes/mountain/types';
import { toCloudsRouteData } from '../themes/clouds/types';
import {
  buildPreviewCloudsWorld,
  buildPreviewMountainWorld,
  buildPreviewSakuraWorld,
} from '@/app/(public)/route-preview/fixtures';

const sakuraSectionCopy = sakuraSectionCopyFor('en');

// ─── Markup reader ────────────────────────────────────────────────────────

interface HtmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  parent: HtmlElement | null;
}
type HtmlNode = HtmlElement | string;

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return NAMED_ENTITIES[code] ?? whole;
  });
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)) {
    attrs[match[1]] = decodeEntities(match[2] ?? '');
  }
  return attrs;
}

/** Parses React's static markup into a tree; throws on anything it cannot read. */
function parseMarkup(html: string): HtmlElement {
  const root: HtmlElement = { tag: '#root', attrs: {}, children: [], parent: null };
  const stack: HtmlElement[] = [root];
  const token =
    /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let index = 0;
  for (const match of html.matchAll(token)) {
    if (match.index !== index) throw new Error(`unreadable markup at ${index}: ${html.slice(index, index + 60)}`);
    index += match[0].length;
    const [, closeTag, openTag, rawAttrs, selfClose, text] = match;
    const parent = stack[stack.length - 1];
    if (text !== undefined) {
      parent.children.push(decodeEntities(text));
    } else if (closeTag !== undefined) {
      const open = stack.pop();
      if (!open || open === root || open.tag !== closeTag.toLowerCase()) {
        throw new Error(`unbalanced </${closeTag}> at ${index}`);
      }
    } else if (openTag !== undefined) {
      const element: HtmlElement = {
        tag: openTag.toLowerCase(),
        attrs: parseAttrs(rawAttrs ?? ''),
        children: [],
        parent,
      };
      parent.children.push(element);
      if (!selfClose && !VOID_TAGS.has(element.tag)) stack.push(element);
    }
  }
  if (index !== html.length || stack.length !== 1) throw new Error('markup ended with unclosed elements');
  return root;
}

function elementChildren(node: HtmlElement): HtmlElement[] {
  return node.children.filter((child): child is HtmlElement => typeof child !== 'string');
}

function descendants(node: HtmlElement): HtmlElement[] {
  return elementChildren(node).flatMap((child) => [child, ...descendants(child)]);
}

function findAll(node: HtmlElement, predicate: (el: HtmlElement) => boolean): HtmlElement[] {
  return descendants(node).filter(predicate);
}

function findOne(node: HtmlElement, predicate: (el: HtmlElement) => boolean, what: string): HtmlElement {
  const hits = findAll(node, predicate);
  if (hits.length !== 1) throw new Error(`expected exactly one ${what}, found ${hits.length}`);
  return hits[0];
}

function ancestors(node: HtmlElement): HtmlElement[] {
  const out: HtmlElement[] = [];
  for (let at = node.parent; at && at.tag !== '#root'; at = at.parent) out.push(at);
  return out;
}

function squash(node: HtmlNode): string {
  const text = (n: HtmlNode): string => (typeof n === 'string' ? n : n.children.map(text).join(''));
  return text(node).replace(/\s+/g, ' ').trim();
}

const withId = (id: string) => (el: HtmlElement) => el.attrs.id === id;
const revealRole = (role: string) => (el: HtmlElement) => el.attrs['data-reveal'] === role;

/** Renders a section and returns its <section> root (the only top-level element). */
function renderSection(node: ReactElement): { html: string; section: HtmlElement } {
  const html = renderToStaticMarkup(node);
  const roots = elementChildren(parseMarkup(html));
  if (roots.length !== 1 || roots[0].tag !== 'section') {
    throw new Error(`expected one <section> root, found ${roots.map((r) => r.tag).join(', ')}`);
  }
  return { html, section: roots[0] };
}

/** Stand-in for the league hub: a marked block with nested content. */
function Hub({ id = 'league-hub' }: { id?: string }) {
  return (
    <div id={id} data-hub="true">
      <h3>League hub</h3>
      <p>Standings, matches, groups.</p>
    </div>
  );
}

const HUB_MARKUP = renderToStaticMarkup(<Hub />);

beforeEach(() => {
  reveal.actual = false;
});

// ─── SectionShell ─────────────────────────────────────────────────────────

describe('SectionShell after slot', () => {
  it('renders `after` after the reveal group, inside the same <section>', () => {
    const { section } = renderSection(
      <SectionShell id="pulse" heading="Pulse" after={<Hub />}>
        <p id="body">Masthead</p>
      </SectionShell>,
    );
    expect(section.attrs.id).toBe('pulse');
    expect(section.attrs['aria-labelledby']).toBe('pulse-heading');
    const [group, hub, ...rest] = elementChildren(section);
    expect(rest).toEqual([]);
    expect(group.attrs['data-reveal']).toBe('group');
    expect(hub.attrs.id).toBe('league-hub');
    // The hub is the section's last child and nowhere inside the reveal group.
    expect(section.children.at(-1)).toBe(hub);
    expect(findAll(group, withId('league-hub'))).toHaveLength(0);
    expect(ancestors(hub).some(revealRole('group'))).toBe(false);
    expect(ancestors(hub).some(revealRole('item'))).toBe(false);
    // Heading and body stay in the reveal: heading beat first, body beat second.
    const items = elementChildren(group);
    expect(items.map((item) => item.attrs['data-reveal'])).toEqual(['item', 'item']);
    expect(findAll(items[0], withId('pulse-heading')).map(squash)).toEqual(['Pulse']);
    expect(findAll(items[1], withId('body')).map(squash)).toEqual(['Masthead']);
  });

  it('renders several `after` nodes in order, all outside the group', () => {
    const { section } = renderSection(
      <SectionShell
        id="pulse"
        heading="Pulse"
        after={
          <>
            <Hub id="first" />
            <Hub id="second" />
          </>
        }
      >
        <p>Masthead</p>
      </SectionShell>,
    );
    expect(elementChildren(section).map((el) => el.attrs.id ?? el.attrs['data-reveal'])).toEqual([
      'group',
      'first',
      'second',
    ]);
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['false', false],
  ] as const)('renders nothing for `after` when it is %s', (_label, after) => {
    const bare = renderSection(
      <SectionShell id="roster" heading="Roster">
        <p>Body</p>
      </SectionShell>,
    );
    expect(elementChildren(bare.section).map((el) => el.attrs['data-reveal'])).toEqual(['group']);
    expect(bare.section.children).toHaveLength(1);
    const withAfter = renderSection(
      <SectionShell id="roster" heading="Roster" after={after}>
        <p>Body</p>
      </SectionShell>,
    );
    expect(withAfter.html).toBe(bare.html);
  });

  it('changes nothing but the appended node when `after` is given', () => {
    const bare = renderToStaticMarkup(
      <SectionShell id="pulse" heading="Pulse">
        <p>Masthead</p>
      </SectionShell>,
    );
    const withAfter = renderToStaticMarkup(
      <SectionShell id="pulse" heading="Pulse" after={<Hub />}>
        <p>Masthead</p>
      </SectionShell>,
    );
    expect(withAfter).toBe(bare.replace(/<\/section>$/, `${HUB_MARKUP}</section>`));
  });

  it('with the real reveal primitives, the hidden opacity lands on the body, never on `after`', () => {
    reveal.actual = true;
    const { section } = renderSection(
      <SectionShell id="pulse" heading="Pulse" after={<Hub />}>
        <p id="body">Masthead</p>
      </SectionShell>,
    );
    const hidden = (el: HtmlElement) => /opacity:\s*0(?![.\d])/.test(el.attrs.style ?? '');
    // The server render starts every reveal item hidden …
    const body = findOne(section, withId('body'), 'body');
    expect(ancestors(body).some(hidden)).toBe(true);
    // … and the hub sits outside them, a direct child of the section.
    const hub = findOne(section, withId('league-hub'), 'hub');
    expect(hub.parent).toBe(section);
    expect([hub, ...ancestors(hub), ...descendants(hub)].some(hidden)).toBe(false);
  });
});

// ─── #pulse sections ──────────────────────────────────────────────────────

function sakuraData(): SakuraRouteData {
  const data = toSakuraRouteData(buildPreviewSakuraWorld('open').data);
  if (!data) throw new Error('the sakura preview always carries a league row');
  return data;
}

/** The pulse section's structure: reveal group, then (optionally) the hub as last child. */
function expectHubAfterReveal(section: HtmlElement, heading: string): void {
  expect(section.attrs.id).toBe('pulse');
  const [group, hub, ...rest] = elementChildren(section);
  expect(rest).toEqual([]);
  expect(group.attrs['data-reveal']).toBe('group');
  expect(squash(findOne(group, withId('pulse-heading'), 'heading'))).toBe(heading);
  expect(hub.attrs.id).toBe('league-hub');
  expect(section.children.at(-1)).toBe(hub);
  expect(findAll(group, (el) => el.attrs['data-hub'] === 'true')).toHaveLength(0);
  expect(ancestors(hub).some(revealRole('group'))).toBe(false);
}

function expectNoHub(section: HtmlElement): void {
  expect(elementChildren(section).map((el) => el.attrs['data-reveal'])).toEqual(['group']);
  expect(findAll(section, (el) => el.attrs['data-hub'] === 'true')).toHaveLength(0);
}

describe('shared PulseSection', () => {
  it('renders its children (the hub) as the section’s last child, outside the reveal wrapper', () => {
    const data = sakuraData();
    const { section } = renderSection(
      <SharedPulseSection data={data} copy={sakuraSectionCopy}>
        <Hub />
      </SharedPulseSection>,
    );
    expectHubAfterReveal(section, 'Pulse');
    // The masthead stays in the reveal's body beat.
    const [group] = elementChildren(section);
    const [, body] = elementChildren(group);
    expect(squash(body)).toContain(`${sakuraSectionCopy.place} · League Pulse`);
    expect(squash(body)).toContain(data.league.name);
  });

  it('renders no hub slot without children (the dev preview), and the same masthead either way', () => {
    const data = sakuraData();
    const bare = renderSection(<SharedPulseSection data={data} copy={sakuraSectionCopy} />);
    expectNoHub(bare.section);
    const withHub = renderToStaticMarkup(
      <SharedPulseSection data={data} copy={sakuraSectionCopy}>
        <Hub />
      </SharedPulseSection>,
    );
    expect(withHub).toBe(bare.html.replace(/<\/section>$/, `${HUB_MARKUP}</section>`));
  });

  it('keeps the hub out of the real reveal’s hidden opacity', () => {
    reveal.actual = true;
    const { section } = renderSection(
      <SharedPulseSection data={sakuraData()} copy={sakuraSectionCopy}>
        <Hub />
      </SharedPulseSection>,
    );
    const hidden = (el: HtmlElement) => /opacity:\s*0(?![.\d])/.test(el.attrs.style ?? '');
    const hub = findOne(section, withId('league-hub'), 'hub');
    expect(hub.parent).toBe(section);
    expect([hub, ...ancestors(hub)].some(hidden)).toBe(false);
    const heading = findOne(section, withId('pulse-heading'), 'heading');
    expect(ancestors(heading).some(hidden)).toBe(true);
  });
});

describe('theme PulseSection bindings pass the hub through', () => {
  it.each([
    ['sakura', () => <SakuraPulseSection data={sakuraData()}><Hub /></SakuraPulseSection>],
    [
      'mountain',
      () => {
        const data = toMountainRouteData(buildPreviewMountainWorld('open').data);
        if (!data) throw new Error('the mountain preview always carries a league row');
        return (
          <MountainPulseSection data={data}>
            <Hub />
          </MountainPulseSection>
        );
      },
    ],
    [
      'clouds',
      () => {
        const data = toCloudsRouteData(buildPreviewCloudsWorld('open').data);
        if (!data) throw new Error('the clouds preview always carries a league row');
        return (
          <CloudsPulseSection data={data}>
            <Hub />
          </CloudsPulseSection>
        );
      },
    ],
  ] as const)('%s', (_theme, build) => {
    expectHubAfterReveal(renderSection(build()).section, 'Pulse');
  });
});

describe('EvoLiga PulseSection', () => {
  function evoligaProps() {
    const data = sakuraData();
    return {
      league: data.league,
      stages: data.stages,
      standings: data.standings,
      fixtures: data.fixtures,
      hasDraftPool: data.hasDraftPool,
      locale: 'de' as const,
    };
  }

  it('renders its children (the hub) after the reveal group, inside #pulse', () => {
    const { section } = renderSection(
      <EvoligaPulseSection {...evoligaProps()}>
        <Hub />
      </EvoligaPulseSection>,
    );
    expectHubAfterReveal(section, 'Saison-Puls');
  });

  it('follows the viewer: an English viewer gets the English heading (i18n D11)', () => {
    const { section } = renderSection(
      <EvoligaPulseSection {...evoligaProps()} locale="en">
        <Hub />
      </EvoligaPulseSection>,
    );
    expectHubAfterReveal(section, 'Season pulse');
  });

  it('renders no hub slot without children', () => {
    expectNoHub(renderSection(<EvoligaPulseSection {...evoligaProps()} />).section);
  });
});
