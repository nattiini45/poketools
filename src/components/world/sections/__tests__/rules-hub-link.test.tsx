/**
 * The non-EPB "Open the Rules tab" link keeps the viewer's world and, on the
 * route tier, leaves the 3D scene: the hub hides with the other sections
 * while the scene is live, so a link that stayed on the route tier would land
 * on nothing.
 *
 * Rendered through react-dom/server (vitest 'node' env); `next/link` is a
 * marked anchor so the soft link and the plain Lite anchor tell apart.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

const navigation = vi.hoisted(() => ({ search: '' }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  function Link({ href, children, ...rest }: { href: string; children?: ReactNode; [key: string]: unknown }) {
    return createElement('a', { ...rest, href, 'data-soft': '' }, children);
  }
  return { default: Link };
});

import RulesHubLink from '../RulesHubLink';
import { rulesHubHref } from '../rules-context';
import { WorldStateContext, type WorldStateValue } from '@/components/world/route/WorldStateProvider';

const PANEL_PARAMS = ['team', 'mon', 'board', 'rules'] as const;

function worldState(tier: 'route' | 'lite'): WorldStateValue {
  return { tier, theme: { focusVocabulary: { kinds: [], panelParams: PANEL_PARAMS } } } as unknown as WorldStateValue;
}

function render(state: WorldStateValue | null): { href: string; soft: boolean } {
  const html = renderToStaticMarkup(
    <WorldStateContext.Provider value={state}>
      <RulesHubLink leagueId="L">Open the Rules tab</RulesHubLink>
    </WorldStateContext.Provider>,
  );
  const href = /href="([^"]*)"/.exec(html)?.[1].replaceAll('&amp;', '&');
  if (href === undefined) throw new Error(`no link in ${html}`);
  return { href, soft: html.includes('data-soft') };
}

describe('rulesHubHref', () => {
  it('opens the Rules tab at the hub with no query to keep', () => {
    expect(rulesHubHref('L')).toBe('/leagues/L?tab=rules#league-hub');
  });

  it('keeps ?world= and other params, drops the overlay and focus params and ?rules always', () => {
    expect(rulesHubHref('L', 'world=mountain&rules=gate&team=t1&mon=m1&focus=x', { panelParams: ['team', 'mon'] })).toBe(
      '/leagues/L?world=mountain&focus=x&tab=rules#league-hub',
    );
  });

  it('replaces the current tab', () => {
    expect(rulesHubHref('L', 'tab=matches&world=clouds')).toBe('/leagues/L?world=clouds&tab=rules#league-hub');
  });

  it('as the Lite exit sets ?tier=lite and drops route forcing', () => {
    expect(rulesHubHref('L', 'world=mountain&tier=route&routeDebug=1&rules=gate', { lite: true })).toBe(
      '/leagues/L?world=mountain&tier=lite&tab=rules#league-hub',
    );
  });
});

describe('RulesHubLink', () => {
  beforeEach(() => {
    navigation.search = 'world=mountain&rules=gate&board=standings';
  });

  it('on the route tier is a plain anchor to the Lite hub, keeping the world', () => {
    expect(render(worldState('route'))).toEqual({
      href: '/leagues/L?world=mountain&tier=lite&tab=rules#league-hub',
      soft: false,
    });
  });

  it('on Lite is a soft link that keeps the world and closes the overlay', () => {
    expect(render(worldState('lite'))).toEqual({
      href: '/leagues/L?world=mountain&tab=rules#league-hub',
      soft: true,
    });
  });

  it('outside a world provider is a soft link', () => {
    navigation.search = 'world=clouds';
    expect(render(null)).toEqual({ href: '/leagues/L?world=clouds&tab=rules#league-hub', soft: true });
  });
});
