/**
 * `ReadinessCard` (renderToStaticMarkup, no DOM): the "Ready to start?" checklist of a custom league. States read as
 * words, an unmet item links to the tab (and anchor) where it is fixed, a ready league gets one line, and a league that
 * is not custom gets nothing.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { createTranslator } from '@/i18n/core';
import { formatStudioAttachMessages } from '@/i18n/messages/format-studio/attach';
import type { Locale } from '@/i18n/config';
import { PRESETS } from '@/lib/format-kit/client';
import {
  computeReadiness,
  type ReadinessItem,
  type ReadinessResult,
} from '@/lib/format-studio/editor/readiness';

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import ReadinessCard, { readinessHref } from '../../attach/ReadinessCard';

const S1 = '5e150000-0000-4000-8000-000000000001';

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

function expectNoLeftovers(html: string) {
  expect(html).not.toMatch(/undefined|\[object|NaN/);
  expect(html).not.toMatch(/\{[a-z_]+\}/);
  expect(html).not.toMatch(/Ã|Â|�/);
}

function render(result: ReadinessResult, locale: Locale = 'en', props: { labelledBy?: string; id?: string } = {}) {
  return renderWithI18n(<ReadinessCard result={result} seasonId={S1} {...props} />, { locale });
}

const item = (
  id: ReadinessItem['id'],
  state: ReadinessItem['state'],
  params: ReadinessItem['params'] = {},
  action: ReadinessItem['action'] = null,
): ReadinessItem => ({ id, state, params, action });

const FORMAT_ACTION = { tab: 'format', anchor: 'format-attach' } as const;

/** A custom league with nothing attached yet. */
const UNATTACHED: ReadinessResult = {
  applicable: true,
  ready: false,
  blockedReason: 'format_not_attached',
  items: [
    item('format_attached', 'unmet', {}, FORMAT_ACTION),
    item('phases_created', 'waiting'),
    item('roster_size', 'waiting'),
    item('rulesets', 'waiting'),
  ],
};

/** Attached, but every other item is open. */
const OPEN: ReadinessResult = {
  applicable: true,
  ready: false,
  blockedReason: null,
  items: [
    item('format_attached', 'met'),
    item('phases_created', 'unmet', { have: 1, need: 3, manual: 2 }, { tab: 'phases' }),
    item('roster_size', 'unmet', { have: 3, need: 8 }, { tab: 'participants' }),
    item('rulesets', 'unmet', { count: 2 }, FORMAT_ACTION),
  ],
};

const READY: ReadinessResult = {
  applicable: true,
  ready: true,
  blockedReason: null,
  items: [
    item('format_attached', 'met'),
    item('phases_created', 'met', { have: 3, need: 3, manual: 0 }),
    item('roster_size', 'met', { have: 8, need: 8 }),
    item('rulesets', 'met', { count: 0 }),
  ],
};

describe('ReadinessCard', () => {
  it('a league that is not custom gets nothing', () => {
    const html = render({ applicable: false, ready: false, blockedReason: null, items: [] });
    expect(html).toBe('');
  });

  describe('a league with nothing attached', () => {
    const html = render(UNATTACHED);

    it('says To do for the format and Waiting for the rest, in words', () => {
      const t = createTranslator(formatStudioAttachMessages, 'en');
      expect(html).toContain(esc(t('readiness.title')));
      expect(html).toContain(esc(t('readiness.state.unmet')));
      expect(html.match(/Waiting for the step above/g)).toHaveLength(3);
      expect(html).toContain(esc(t('readiness.format_attached.unmet')));
      expect(html).toContain(esc(t('readiness.phases_created.waiting')));
      expect(html).toContain(esc(t('readiness.roster_size.waiting')));
      expect(html).toContain(esc(t('readiness.rulesets.waiting')));
      expectNoLeftovers(html);
    });

    it('links the format item to the Format tab at the picker, and nothing else', () => {
      expect(html.match(/<a /g)).toHaveLength(1);
      expect(html).toContain(`href="/admin/leagues/${S1}?tab=format#format-attach"`);
      expect(html).toContain('Attach a format');
    });

    it('the icons are decoration', () => {
      const icons = html.match(/<svg[^>]*>/g) ?? [];
      expect(icons.length).toBe(4);
      for (const icon of icons) expect(icon).toContain('aria-hidden="true"');
    });
  });

  describe('an attached league with open items', () => {
    const html = render(OPEN);

    it('marks the first item Done and the others To do, with their numbers', () => {
      expect(html).toContain('Done: ');
      expect(html.match(/To do: /g)).toHaveLength(3);
      expect(html).toContain('A format is attached.');
      expect(html).toContain('Phases created from the format: 1 of 3. The league also has 2 hand-made phases');
      expect(html).toContain('Players registered: 3. The format needs at least 8.');
      expect(html).toContain('2 stages use the league’s default ruleset, but this league has none.');
      expectNoLeftovers(html);
    });

    it('links each open item to the tab where it is fixed', () => {
      expect(html).toContain(`href="/admin/leagues/${S1}?tab=phases"`);
      expect(html).toContain(`href="/admin/leagues/${S1}?tab=participants"`);
      expect(html).toContain(`href="/admin/leagues/${S1}?tab=format#format-attach"`);
      expect(html.match(/<a /g)).toHaveLength(3);
      expect(html).toContain('Open phases');
      expect(html).toContain('Open participants');
      expect(html).toContain('Choose another format');
    });

    it('a done item has no link and no ready line', () => {
      expect(html).not.toContain('All set');
    });
  });

  it('without hand-made phases the phases item says only how many are created and links to the format', () => {
    const html = render({
      ...OPEN,
      items: [
        item('format_attached', 'met'),
        item('phases_created', 'unmet', { have: 1, need: 3, manual: 0 }, { tab: 'format' }),
        item('roster_size', 'met', { have: 8, need: 8 }),
        item('rulesets', 'met', { count: 0 }),
      ],
    });
    expect(html).toContain('Phases created from the format: 1 of 3.');
    expect(html).not.toContain('hand-made');
    expect(html).toContain(`href="/admin/leagues/${S1}?tab=format"`);
    expect(html).toContain('Open the format');
  });

  it('a single hand-made phase is worded in the singular', () => {
    const html = render({
      ...OPEN,
      items: [item('phases_created', 'unmet', { have: 0, need: 3, manual: 1 }, { tab: 'phases' })],
    });
    expect(html).toContain('1 hand-made phase, which');
  });

  describe('a ready league', () => {
    it('shows one line instead of the list', () => {
      const html = render(READY);
      expect(html).toContain('All set. You can start the league.');
      expect(html).not.toContain('<ol');
      expect(html).not.toContain('<a ');
      expect(html).toContain('data-readiness="ready"');
      expectNoLeftovers(html);
    });
  });

  it('is a labelled section whose heading carries the given id', () => {
    const html = render(OPEN, 'en', { labelledBy: 'ready-heading', id: 'format-readiness' });
    expect(html).toContain('id="format-readiness"');
    expect(html).toContain('aria-labelledby="ready-heading"');
    expect(html).toContain('id="ready-heading"');
    expect(html).toContain('<h2');
  });

  it('generates a matching heading id when none is given', () => {
    const html = render(OPEN);
    const labelled = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelled).toBeTruthy();
    expect(html).toContain(`id="${labelled}"`);
  });

  it('German: states, sentences and links are translated, with umlauts intact', () => {
    const html = render(OPEN, 'de');
    const t = createTranslator(formatStudioAttachMessages, 'de');
    expect(html).toContain(esc(t('readiness.title')));
    expect(html).toContain('Bereit zum Start?');
    expect(html).toContain('Erledigt: ');
    expect(html.match(/Offen: /g)).toHaveLength(3);
    expect(html).toContain('Angemeldete Spieler: 3. Das Format braucht mindestens 8.');
    expect(html).toContain('Phasen öffnen');
    expect(html).toContain('Teilnehmer öffnen');
    expect(html).toContain('Anderes Format wählen');
    expectNoLeftovers(html);

    const waiting = render(UNATTACHED, 'de');
    expect(waiting).toContain('Wartet auf den Schritt davor');
    expect(render(READY, 'de')).toContain('Alles bereit. Du kannst die Liga starten.');
  });
});

describe('readinessHref', () => {
  it('builds the tab link and appends the anchor when there is one', () => {
    expect(readinessHref(S1, { tab: 'phases' })).toBe(`/admin/leagues/${S1}?tab=phases`);
    expect(readinessHref(S1, { tab: 'format', anchor: 'format-attach' })).toBe(`/admin/leagues/${S1}?tab=format#format-attach`);
    expect(readinessHref(S1, { tab: 'overview' })).toBe(`/admin/leagues/${S1}`);
  });
});

describe('ReadinessCard with the real checklist computation', () => {
  const spec = PRESETS.find((p) => p.id === 'classic-league')!.definition;
  const base = {
    formatType: 'custom' as const,
    started: false,
    participantCount: 2,
    seasonRulesetId: null,
    phaseCount: 0,
    manualPhaseCount: 0,
  };

  it('an unattached league renders the format item as the only open step', () => {
    const html = render(computeReadiness({ ...base, attached: null }));
    expect(html).toContain('Attach a published format.');
    expect(html.match(/<a /g)).toHaveLength(1);
    expectNoLeftovers(html);
  });

  it('an attached league that lacks phases, players and a ruleset renders every open step with a link', () => {
    const html = render(computeReadiness({ ...base, attached: { version_no: 1, spec } }), 'de');
    expect(html).toContain('Erledigt: ');
    expect(html).toContain('Aus dem Format erstellte Phasen: 0 von');
    expect(html).toContain('Angemeldete Spieler: 2.');
    expect(html).toContain('keins');
    expectNoLeftovers(html);
  });

  it('a league that is ready shows the ready line', () => {
    const readiness = computeReadiness({
      ...base,
      participantCount: 64,
      seasonRulesetId: 'ruleset-1',
      phaseCount: spec.stages.length,
      attached: { version_no: 1, spec },
    });
    expect(readiness.ready).toBe(true);
    expect(render(readiness)).toContain('All set. You can start the league.');
  });
});
