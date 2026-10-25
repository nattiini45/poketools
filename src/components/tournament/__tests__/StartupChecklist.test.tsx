/**
 * The round manager's start-up checklist: one row per item with its state, the sentence from the
 * `checklist.*` catalog and a link to the control that fixes an unmet item. Rendered through
 * react-dom/server (vitest 'node' env, no DOM).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Section from '@/components/ui/Section';
import {
  StartupChecklistView,
  STARTUP_CHECKLIST_REGION_ID_PREFIX,
  type StartupChecklistLinks,
} from '../StartupChecklist';
import { renderWithI18n } from '@/test/i18n';
import type { StartupItem } from '@/lib/tournament/startup-checklist';

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
}

const LINKS: StartupChecklistLinks = {
  participants: '#tournament-participants',
  overview: '#tournament-overview',
  rounds: '#tournament-rounds',
  leagueGroups: '/admin/leagues/s-1?tab=participants',
};

function view(
  items: StartupItem[],
  o: {
    links?: StartupChecklistLinks;
    status?: 'loading' | 'ready' | 'error';
    locale?: 'en' | 'de';
  } = {},
) {
  return renderWithI18n(
    <StartupChecklistView
      checklist={{ items, blocked: items.some((item) => item.state === 'blocked') }}
      links={o.links ?? LINKS}
      status={o.status ?? 'ready'}
      onRetry={() => {}}
    />,
    { locale: o.locale ?? 'en' },
  );
}

const PARTICIPANTS_BLOCKED: StartupItem = {
  id: 'participants',
  state: 'blocked',
  params: { count: 1, min: 2 },
  link: 'participants',
};

describe('StartupChecklistView', () => {
  it('a blocked participants row shows the count, the minimum and the add-participants link', () => {
    const html = view([PARTICIPANTS_BLOCKED]);
    expect(textOf(html)).toContain('Only 1 participant enrolled. Add at least 2 participants.');
    expect(html).toContain('href="#tournament-participants"');
    expect(textOf(html)).toContain('Add participants');
    expect(textOf(html)).toContain('Generating is disabled until the open items are done.');
  });

  it('is a labelled region with a stable id prefix, so Generate can point aria-describedby at it', () => {
    const html = renderWithI18n(
      <StartupChecklistView
        id={`${STARTUP_CHECKLIST_REGION_ID_PREFIX}t-1`}
        checklist={{ items: [PARTICIPANTS_BLOCKED], blocked: true }}
        links={LINKS}
        status="ready"
        onRetry={() => {}}
      />,
    );
    expect(html).toContain('role="region"');
    expect(html).toContain('id="startup-checklist-t-1"');
    expect(html).toContain('aria-labelledby="startup-checklist-t-1-title"');
    expect(textOf(html)).toContain('Before you generate');
  });

  it('renders no anchor when the link target has no href', () => {
    const html = view([PARTICIPANTS_BLOCKED], { links: {} });
    expect(html).not.toContain('<a ');
    expect(textOf(html)).toContain('Only 1 participant enrolled.');
  });

  it('a done row has no link and no blocked note', () => {
    const html = view([
      { id: 'participants', state: 'done', params: { count: 8, min: 2 }, link: 'participants' },
      { id: 'ruleset', state: 'done', params: { name: 'Standard OU' }, link: 'overview' },
      { id: 'bestOf', state: 'done', params: { count: 3, bestOf: 3 }, link: 'overview' },
    ]);
    const text = textOf(html);
    expect(text).toContain('8 participants enrolled (minimum 2)');
    expect(text).toContain('Ruleset: Standard OU');
    expect(text).toContain('Best of 3 by default');
    expect(html).not.toContain('<a ');
    expect(text).not.toContain('Generating is disabled');
  });

  it('a ruleset without a name falls back to the unnamed sentence', () => {
    const html = view([{ id: 'ruleset', state: 'done', params: {}, link: 'overview' }]);
    expect(textOf(html)).toContain('Ruleset set');
  });

  it('an unseeded roster is an optional attention row with a link, and does not block', () => {
    const html = view([
      { id: 'seeding', state: 'attention', params: { unseeded: 3, count: 8 }, link: 'participants' },
    ]);
    const text = textOf(html);
    expect(text).toContain('3 participants have no seed and are ordered by name.');
    expect(text).toContain('Optional');
    expect(text).toContain('Set seeds');
    expect(html).toContain('data-state="attention"');
    expect(text).not.toContain('Generating is disabled');
  });

  it('a blocked previous round names the round, and a blocked group row counts the unplaced players', () => {
    const html = view([
      { id: 'groups', state: 'blocked', params: { count: 3 }, link: 'leagueGroups' },
      { id: 'previousRound', state: 'blocked', params: { round: 'Round 2' }, link: 'rounds' },
    ]);
    const text = textOf(html);
    expect(text).toContain('3 participants are not in a league group. Place them first.');
    expect(text).toContain('Round 2 is not completed yet.');
    expect(html).toContain('href="/admin/leagues/s-1?tab=participants"');
    expect(html).toContain('href="#tournament-rounds"');
  });

  it('round-robin progress: a gap row names the missing round', () => {
    const html = view([
      { id: 'roundsRemaining', state: 'attention', params: { total: 5, generated: 4, round: 3 } },
    ]);
    expect(textOf(html)).toContain('Round 3 is missing. Generate All Rounds fills the gap.');
    expect(html).not.toContain('<a ');
  });

  it('while the participants load, the unknown row says it is checking', () => {
    const html = view([{ id: 'participants', state: 'unknown', params: { min: 2 }, link: 'participants' }], {
      status: 'loading',
    });
    expect(textOf(html)).toContain('Checking participants');
    expect(html).toContain('data-state="unknown"');
    expect(html).not.toContain('<a ');
  });

  it('a failed participant read says so, with a Retry button, and does not block', () => {
    const html = view([{ id: 'participants', state: 'unknown', params: { min: 2 }, link: 'participants' }], {
      status: 'error',
    });
    const text = textOf(html);
    expect(text).toContain('Could not check the participants. You can still try to generate.');
    expect(html).toContain('<button');
    expect(text).toContain('Retry');
    expect(text).not.toContain('Generating is disabled');
  });

  it('without an unknown row, a failed read gets its own status line with Retry', () => {
    const html = view([{ id: 'previousRound', state: 'done', params: { round: 'Round 1' }, link: 'rounds' }], {
      status: 'error',
    });
    expect(textOf(html)).toContain('Could not check the participants.');
    expect(textOf(html)).toContain('Retry');
  });

  it('renders in German with real umlauts and the glossary words', () => {
    const html = view(
      [
        PARTICIPANTS_BLOCKED,
        { id: 'seeding', state: 'attention', params: { unseeded: 2, count: 8 }, link: 'participants' },
        { id: 'previousRound', state: 'blocked', params: { round: 'Round 2' }, link: 'rounds' },
        { id: 'groups', state: 'blocked', params: { count: 1 }, link: 'leagueGroups' },
      ],
      { locale: 'de' },
    );
    const text = textOf(html);
    expect(text).toContain('Erst 1 Teilnehmer eingetragen. Trage mindestens 2 Teilnehmer ein.');
    expect(text).toContain('2 Teilnehmer haben keinen Setzplatz und werden nach Namen einsortiert.');
    expect(text).toContain('Runde 2 ist noch nicht abgeschlossen. Schließe sie ab');
    expect(text).toContain('1 Teilnehmer ist keiner Ligagruppe zugeordnet. Ordne ihn zuerst zu.');
    expect(text).toContain('Vor dem Erstellen');
    expect(text).toContain('Das Erstellen ist gesperrt');
    expect(text).toContain('Teilnehmer hinzufügen');
    expect(text).not.toMatch(/Ã|Â|�/);
  });
});

describe('Section anchor id (the checklist links jump to it)', () => {
  it('forwards id to the outer section, collapsible or not, and adds nothing without it', () => {
    for (const collapsible of [false, true]) {
      const withId = renderToStaticMarkup(
        <Section id="tournament-participants" title="Participants" collapsible={collapsible}>
          body
        </Section>,
      );
      expect(withId).toMatch(/^<section id="tournament-participants"[^>]*scroll-mt-4/);
      const without = renderToStaticMarkup(
        <Section title="Participants" collapsible={collapsible}>
          body
        </Section>,
      );
      expect(without).not.toContain(' id="tournament-participants"');
      expect(without).not.toContain('scroll-mt-4');
    }
  });
});
