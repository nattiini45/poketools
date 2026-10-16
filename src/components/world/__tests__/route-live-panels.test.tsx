/**
 * PR #65 test pass follow-ups on the route tier's page chrome:
 *
 *  - R4: the route-live rules that size every station `<section>` to 100vh
 *    and hide its children also matched the `<section>`s inside the docked
 *    overlays (`?rules=gate`, `?board=pulse|schedule`) — native <dialog>s
 *    under `[data-world-route]` — so the panels opened blank. The rules now
 *    leave dialog subtrees alone.
 *  - R18c: the hidden league hub still laid out a ~92 px box inside #pulse;
 *    it is out of the layout while the world is the page.
 *  - R7: the German plaza world used to mark its subtree `lang="de"`; since
 *    i18n D11 every world follows the viewer and inherits `<html lang>`.
 *
 * No DOM here (vitest 'node'): the CSS contract is read from globals.css, the
 * overlay structure and the shell's root are server-rendered.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactNode } from 'react';

vi.mock('next/link', async () => {
  const { createElement: h } = await import('react');
  function Link({ href, children, ...rest }: { href: string; children?: ReactNode; [key: string]: unknown }) {
    const { scroll: _scroll, prefetch: _prefetch, ...attrs } = rest;
    return h('a', { ...attrs, href }, children);
  }
  return { default: Link };
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/lib/supabase/client', () => ({
  get supabase(): never {
    throw new Error('render must not reach Supabase');
  },
}));

// WorldShell's client children: only the root it renders matters here.
vi.mock('@/components/world/route/WorldStateProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/world/route/WorldStateProvider')>();
  return { ...actual, default: ({ children }: { children: ReactNode }) => children };
});
vi.mock('@/components/world/route/RouteSceneRecovery', () => ({ default: () => null }));
vi.mock('@/components/world/route/BallLoader', () => ({ default: () => null }));
vi.mock('@/components/world/route/StationCard', () => ({ default: () => null }));
vi.mock('@/components/world/route/focus/FocusHoverOverlay', () => ({ default: () => null }));
vi.mock('@/components/world/route/focus/HoloBeam', () => ({ default: () => null }));

import WorldShell from '../WorldShell';
import RulesPanel from '../sections/overlays/RulesPanel';
import BoardPanel from '../sections/overlays/BoardPanel';
import { sakuraSectionCopyFor } from '../themes/sakura/sections/copy';
import { toSakuraRouteData } from '../themes/sakura/types';
import { buildPreviewSakuraWorld } from '@/app/(public)/route-preview/fixtures';
import { resolveViewerWorld } from '@/lib/worlds/registry';

const sakuraSectionCopy = sakuraSectionCopyFor('en');

const ROOT = join(__dirname, '..', '..', '..', '..');

interface CssRule {
  selector: string;
  body: string;
}

/** Top-level rules of globals.css (comments stripped; @media blocks skipped). */
function globalRules(): CssRule[] {
  const css = readFileSync(join(ROOT, 'src', 'app', 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

describe('route-live section rules (R4)', () => {
  const sectionRules = globalRules().filter((rule) => /\[data-world-route\]\s+section/.test(rule.selector));

  it('every rule that sizes or hides route sections skips dialog subtrees', () => {
    const hiding = sectionRules.filter((rule) =>
      /\bheight\s*:\s*100vh|\bvisibility\s*:\s*hidden|\bcontent-visibility\s*:\s*hidden/.test(rule.body),
    );
    expect(hiding.length).toBeGreaterThanOrEqual(2);
    for (const rule of hiding) {
      for (const selector of rule.selector.split(',')) {
        expect(selector, selector).toMatch(/section:not\(dialog \*\)/);
        expect(selector).toContain('html.world-route-live');
      }
    }
  });

  it('the page-header hide skips dialog subtrees too (the docked team panel’s header row shares its classes)', () => {
    const header = globalRules().filter((rule) => rule.selector.includes('.flex.items-start.justify-between'));
    expect(header).toHaveLength(1);
    expect(header[0].selector).toBe('html.world-route-live main .flex.items-start.justify-between:not(dialog *)');
  });

  it('the overlays those rules used to blank really are <section>s (inside the docked <dialog>)', () => {
    const data = toSakuraRouteData(buildPreviewSakuraWorld('open').data);
    if (!data) throw new Error('the sakura preview carries a league row');
    const rules = renderToStaticMarkup(
      createElement(RulesPanel, {
        formatRules: data.formatRules,
        rulesetName: data.rulesetName,
        rulesCopy: sakuraSectionCopy.rulesCopy,
        context: { format: 'singles', bestOf: 3 },
        leagueId: data.league.id,
      }),
    );
    expect(rules).toMatch(/<section>/);
    expect(rules).toContain('Open the Rules tab');
    const board = renderToStaticMarkup(
      createElement(BoardPanel, {
        kind: 'schedule',
        league: data.league,
        stages: data.stages,
        standings: data.standings,
        fixtures: data.fixtures,
      }),
    );
    expect(board).toMatch(/<section aria-label=/);
  });
});

describe('league hub on the route tier (R18c)', () => {
  it('is out of the layout while the world is the page, never before', () => {
    const hub = globalRules().filter((rule) => rule.selector.includes('#league-hub'));
    expect(hub).toHaveLength(1);
    expect(hub[0].selector).toBe('html.world-route-live [data-world-route] #league-hub');
    expect(hub[0].body).toMatch(/display\s*:\s*none/);
  });
});

describe('world language (R7, superseded by i18n D11)', () => {
  const singles = { format_type: 'singles', route_theme: null } as const;

  it('every world, the plaza included, inherits the page language: the shell sets no lang', () => {
    const shell = (world: string) =>
      renderToStaticMarkup(
        createElement(WorldShell, { world: resolveViewerWorld(singles, world), children: createElement('p', null, 'x') }),
      );
    expect(shell('plaza')).toMatch(/^<div data-world="evoliga"/);
    for (const world of ['plaza', 'sakura', 'mountain', 'clouds']) {
      expect(shell(world)).not.toContain('lang=');
    }
  });

  it('the panels follow the viewer: the rules panel renders German for a German viewer', () => {
    const data = toSakuraRouteData(buildPreviewSakuraWorld('open').data);
    if (!data) throw new Error('the sakura preview carries a league row');
    const rules = renderToStaticMarkup(
      createElement(RulesPanel, {
        formatRules: data.formatRules,
        rulesetName: data.rulesetName,
        rulesCopy: sakuraSectionCopy.rulesCopy,
        context: { format: 'singles', bestOf: 3 },
        leagueId: data.league.id,
        locale: 'de',
      }),
    );
    expect(rules).toContain('Zum Regeln-Tab');
    expect(rules).toContain('Geltendes Regelwerk');
    expect(rules).not.toContain('Open the Rules tab');
  });
});
