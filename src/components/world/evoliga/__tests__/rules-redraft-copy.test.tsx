/**
 * EvoLiga rules copy after the trade retirement: the rulebook's redraft
 * paragraph describes only the secret-drop redraft, in English and German, and still shows the
 * redraft phase state. No trade consent or pending-request wording is left.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FormatRules } from '@/types/format-rules';
import type { RulesCopyContext } from '@/components/world/sections/types';

vi.mock('next/link', async () => {
  const { createElement: h } = await import('react');
  function Link({ href, children }: { href: string; children?: ReactNode }) {
    return h('a', { href }, children);
  }
  return { default: Link };
});

vi.mock('@/lib/supabase/client', () => ({
  get supabase(): never {
    throw new Error('section render must not reach Supabase');
  },
}));

import RulesSection from '../RulesSection';

const EPB: RulesCopyContext = { format: 'evolution_point_buy', bestOf: 3 };

function render(locale: 'en' | 'de', redraftOpen: boolean | null): string {
  const rules = redraftOpen === null ? null : ({ redraft_phase_open: redraftOpen } as unknown as FormatRules);
  return renderToStaticMarkup(
    <RulesSection formatRules={rules} rulesetName={null} context={EPB} leagueId="l1" locale={locale} />,
  );
}

describe('EvoLiga rules: redraft paragraph (trades retired)', () => {
  it.each([
    ['en', /Lines change hands only in the redraft between the two halves/, /There are no trades between trainers/],
    ['de', /Linien wechseln nur im Redraft zwischen Hin- und Rückrunde den Besitzer/, /Trades zwischen Trainern gibt es nicht/],
  ] as const)('%s: describes the secret-drop redraft and says trades are gone', (locale, body, noTrades) => {
    const html = render(locale, true);
    expect(html).toMatch(body);
    expect(html).toMatch(noTrades);
  });

  it.each(['en', 'de'] as const)('%s: no consent or pending-request wording remains', (locale) => {
    const html = render(locale, true);
    expect(html).not.toMatch(/consent|Zustimmung|open requests|Offene Anfragen|Trades &amp;/i);
  });

  it('shows the redraft phase state (open, closed, no row = closed)', () => {
    expect(render('en', true)).toMatch(/The redraft phase is currently <strong[^>]*>open<\/strong>/);
    expect(render('en', false)).toMatch(/The redraft phase is currently <strong[^>]*>closed<\/strong>/);
    expect(render('de', null)).toMatch(/Die Redraft-Phase ist derzeit <strong[^>]*>geschlossen<\/strong>/);
  });
});
