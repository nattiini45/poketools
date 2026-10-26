/**
 * The Schedule tab (static markup): inputs, table headings, the 8-player default with pinned numbers for the
 * classic example, the cadence, and the message for a document with errors.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import ScheduleTab from '../../editor/preview/ScheduleTab';
import { esc, expectLabelledControls, expectNoLeftovers, expectUniqueIds, presetDoc, stripMarkup } from './test-helpers';

function render(props: { initialPlayers?: number; initialRoundDays?: number; doc?: ReturnType<typeof presetDoc> } = {}, locale: Locale = 'en') {
  return renderWithI18n(
    <ScheduleTab doc={props.doc ?? presetDoc()} rulesetIds={new Set()} onShowIssues={() => undefined} initialPlayers={props.initialPlayers} initialRoundDays={props.initialRoundDays} />,
    { locale },
  );
}

/** The cells of the row whose header is `name`. */
function rowOf(html: string, name: string): string[] {
  const row = new RegExp(`<tr[^>]*><th[^>]*scope="row"[^>]*>${esc(name)}[\\s\\S]*?</tr>`).exec(html)?.[0] ?? '';
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripMarkup(m[1]).trim());
}

describe('ScheduleTab', () => {
  it('starts with 8 players and a weekly cadence, with a labelled input and select', () => {
    const html = render();
    expect(html).toContain('Number of players');
    expect(html).toContain('value="8"');
    expect(html).toContain('<option value="7" selected="">Weekly</option>');
    expect(html).toContain('Estimated schedule for 8 players');
    expectLabelledControls(html);
    expectNoLeftovers(html);
    expectUniqueIds(html);
  });

  it('writes a table with a caption and column headers', () => {
    const html = render();
    expect(html).toContain('<caption');
    for (const heading of ['Stage', 'Players', 'Rounds', 'Matches', 'Matches per player', 'Byes', 'Weeks']) {
      expect(html).toMatch(new RegExp(`<th[^>]*scope="col"[^>]*>${heading}</th>`));
    }
    expect(html).toContain('role="region"');
    expect(html).toContain('overflow-x-auto');
  });

  it('pins the classic example at 8 players: a double round robin, then a top-4 knockout', () => {
    const doc = presetDoc('classic-league');
    const html = render({ doc });
    // 8 players, 2 legs: 14 rounds, 56 matches, 14 matches each. 4 advance: 2 rounds, 3 matches.
    const league = rowOf(html, 'League phase');
    expect(league.slice(0, 3)).toEqual(['8', '14', '56']);
    const playoffs = rowOf(html, 'Playoffs');
    expect(playoffs.slice(0, 3)).toEqual(['4', '2', '3']);
    const total = /<tfoot>[\s\S]*<\/tfoot>/.exec(html)?.[0] ?? '';
    expect([...total.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripMarkup(m[1]).trim())).toEqual(['', '16', '59', '', '', '16']);
  });

  it('twelve players change the numbers', () => {
    const league = rowOf(render({ initialPlayers: 12 }), 'League phase');
    expect(league.slice(0, 3)).toEqual(['12', '22', '132']);
  });

  it('a slower cadence stretches the weeks, not the rounds', () => {
    const weekly = /<tfoot>[\s\S]*<\/tfoot>/.exec(render())?.[0] ?? '';
    const fortnightly = /<tfoot>[\s\S]*<\/tfoot>/.exec(render({ initialRoundDays: 14 }))?.[0] ?? '';
    const cells = (foot: string) => [...foot.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripMarkup(m[1]).trim());
    expect(cells(weekly)[1]).toBe(cells(fortnightly)[1]);
    expect(cells(weekly)[5]).toBe('16');
    expect(cells(fortnightly)[5]).toBe('32');
    expect(render({ initialRoundDays: 14 })).toContain('<option value="14" selected="">Every 2 weeks</option>');
  });

  it('lists the notes under the table', () => {
    const html = render();
    expect(html).toContain('Stages are counted one after the other.');
    expect(html).toContain('A best-of series counts as one match.');
    expect(html).toContain('bounds');
  });

  it('a document with errors shows the message and a way to the Issues tab instead of a table', () => {
    const broken = { ...presetDoc(), stages: [] } as ReturnType<typeof presetDoc>;
    const html = render({ doc: broken });
    expect(html).toContain('Fix the errors first. The Issues tab says what is wrong.');
    expect(html).toContain('Show the issues');
    expect(html).not.toContain('<table');
    expect(render({ doc: broken }, 'de')).toContain('Behebe zuerst die Fehler.');
  });
});
