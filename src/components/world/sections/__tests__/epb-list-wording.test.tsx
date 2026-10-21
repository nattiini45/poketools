/**
 * Point-buy list wording on the themed (isle) worlds:
 * - #roster is headed 'Point-Buy list' only when it shows a list; the trainer fallback (no list
 *   bound) gets the plain roster heading, so it never names a list the league does not have;
 * - the EPB rulebook (#rules section and the gate overlay) carries the pack's note on passing
 *   moves (`worldEvoliga.rules.passRule`), as the plaza rulebook does; other formats do not.
 *
 * Rendered through react-dom/server (vitest 'node' env) from the route-preview fixtures.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  function Link({ href, children }: { href: string; children?: ReactNode }) {
    return createElement('a', { href }, children);
  }
  return { default: Link };
});

vi.mock('@/lib/supabase/client', () => ({
  get supabase(): never {
    throw new Error('section render must not reach Supabase');
  },
}));

import { buildPreviewSakuraWorld } from '@/app/(public)/route-preview/fixtures';
import { createTranslator } from '@/i18n/core';
import { worldEvoligaMessages } from '@/i18n/messages/world/evoliga';
import RosterSection from '../RosterSection';
import RulesSection from '../RulesSection';
import RulesPanel from '../overlays/RulesPanel';
import { rulesCopyContext } from '../rules-context';
import type { ThemeRouteData } from '../types';
import { plaqueCopy as sakuraPlaqueCopy } from '../../themes/sakura/content/paint';
import { sakuraSectionCopyFor } from '../../themes/sakura/sections/copy';
import { toSakuraRouteData } from '../../themes/sakura/types';

type Locale = 'en' | 'de';

function sakura(variant: 'epb' | 'open'): ThemeRouteData {
  const data = toSakuraRouteData(buildPreviewSakuraWorld(variant, 'populated').data);
  if (!data) throw new Error('the sakura preview always carries a league row');
  return data;
}

/** Visible text, entities decoded, whitespace squashed. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function heading(html: string): string {
  const match = /<h2\b[^>]*>([\s\S]*?)<\/h2>/.exec(html);
  if (!match) throw new Error(`no section heading in ${html.slice(0, 200)}`);
  return text(match[1]);
}

const roster = (data: ThemeRouteData, locale: Locale) =>
  renderToStaticMarkup(<RosterSection data={data} copy={sakuraSectionCopyFor(locale)} locale={locale} />);
const rulesSection = (data: ThemeRouteData, locale: Locale) =>
  renderToStaticMarkup(<RulesSection data={data} copy={sakuraSectionCopyFor(locale)} locale={locale} />);
const rulesPanel = (data: ThemeRouteData, locale: Locale) =>
  renderToStaticMarkup(
    <RulesPanel
      formatRules={data.formatRules}
      rulesetName={data.rulesetName}
      rulesCopy={sakuraPlaqueCopy}
      context={rulesCopyContext(data)}
      leagueId={data.league.id}
      locale={locale}
    />,
  );

describe('#roster heading on the themed worlds', () => {
  it.each([
    ['en', 'Point-Buy list'],
    ['de', 'Point-Buy-Liste'],
  ] as const)('%s: a league with a list is headed by the list name', (locale, expected) => {
    const data = sakura('epb');
    expect(data.entries.length).toBeGreaterThan(0);
    expect(heading(roster(data, locale))).toBe(expected);
  });

  it.each([
    ['en', 'Roster', 'Point-Buy list'],
    ['de', 'Kader', 'Point-Buy-Liste'],
  ] as const)('%s: the trainer fallback (no list) gets the plain roster heading', (locale, expected, listName) => {
    const data = { ...sakura('epb'), entries: [] };
    const html = roster(data, locale);
    expect(heading(html)).toBe(expected);
    expect(heading(html)).not.toBe(listName);
  });
});

describe('the pass-move rule note on the themed EPB rulebook', () => {
  it.each(['en', 'de'] as const)('%s: the #rules section and the gate overlay both carry it', (locale) => {
    const note = createTranslator(worldEvoligaMessages, locale)('rules.passRule');
    expect(note).toMatch(/Baton Pass/);
    const data = sakura('epb');
    for (const html of [rulesSection(data, locale), rulesPanel(data, locale)]) {
      expect(text(html)).toContain(text(note));
      expect(html).toContain('data-rule="pass"');
    }
  });

  it('another format shows no pass-move note', () => {
    const data = sakura('open');
    expect(rulesCopyContext(data).format).not.toBe('evolution_point_buy');
    for (const html of [rulesSection(data, 'en'), rulesPanel(data, 'en')]) {
      expect(html).not.toContain('data-rule="pass"');
    }
  });
});
