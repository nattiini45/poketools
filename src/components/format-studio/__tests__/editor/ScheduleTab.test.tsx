/** @vitest-environment jsdom */
/**
 * The Schedule tab in a DOM: inputs (typed into and picked from, as a viewer does), table headings, the 8-player default
 * with pinned numbers for the classic example, the cadence, and the message for a document with errors.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import ScheduleTab from '../../editor/preview/ScheduleTab';
import { expectLabelledControls, expectNoLeftovers, expectUniqueIds, presetDoc } from './test-helpers';

function open(doc: ReturnType<typeof presetDoc> = presetDoc(), locale: Locale = 'en') {
  const view = render(withI18n(<ScheduleTab doc={doc} rulesetIds={new Set()} onShowIssues={() => undefined} />, { locale }));
  return { ...view, user: userEvent.setup() };
}

const textOf = (cells: HTMLElement[]) => cells.map((cell) => cell.textContent?.trim());

/** The cells of the row whose header is `name`. */
function rowOf(name: string): (string | undefined)[] {
  return textOf(within(screen.getByRole('row', { name: new RegExp(`^${name}`) })).getAllByRole('cell'));
}

/** The cells of the total row. */
function totals(): (string | undefined)[] {
  return textOf(within(screen.getByRole('row', { name: /^Total/ })).getAllByRole('cell'));
}

describe('ScheduleTab', () => {
  it('starts with 8 players and a weekly cadence, with a labelled input and select', () => {
    const { container } = open();
    expect((screen.getByLabelText('Number of players') as HTMLInputElement).value).toBe('8');
    const cadence = screen.getByLabelText('Cadence') as HTMLSelectElement;
    expect(cadence.value).toBe('7');
    expect(cadence.selectedOptions[0].text).toBe('Weekly');
    expect(screen.getByRole('table').querySelector('caption')?.textContent).toBe('Estimated schedule for 8 players');
    expectLabelledControls(container.innerHTML);
    expectNoLeftovers(container.innerHTML);
    expectUniqueIds(container.innerHTML);
  });

  it('writes a table with a caption and column headers', () => {
    open();
    expect(screen.getByRole('table').querySelector('caption')).not.toBeNull();
    const headings = screen.getAllByRole('columnheader').map((heading) => heading.textContent);
    expect(headings).toEqual(['Stage', 'Players', 'Rounds', 'Matches', 'Matches per player', 'Byes', 'Weeks']);
    for (const heading of screen.getAllByRole('columnheader')) expect(heading.getAttribute('scope')).toBe('col');
    const region = screen.getByRole('region');
    expect(region.className).toContain('overflow-x-auto');
    expect(region.contains(screen.getByRole('table'))).toBe(true);
  });

  it('pins the classic example at 8 players: a double round robin, then a top-4 knockout', () => {
    open(presetDoc('classic-league'));
    // 8 players, 2 legs: 14 rounds, 56 matches, 14 matches each. 4 advance: 2 rounds, 3 matches.
    expect(rowOf('League phase').slice(0, 3)).toEqual(['8', '14', '56']);
    expect(rowOf('Playoffs').slice(0, 3)).toEqual(['4', '2', '3']);
    expect(totals()).toEqual(['', '16', '59', '', '', '16']);
  });

  it('twelve players change the numbers', async () => {
    const { user } = open();
    const players = screen.getByLabelText('Number of players');
    await user.clear(players);
    await user.type(players, '12');
    expect(rowOf('League phase').slice(0, 3)).toEqual(['12', '22', '132']);
    expect(screen.getByRole('table').querySelector('caption')?.textContent).toBe('Estimated schedule for 12 players');
  });

  it('a slower cadence stretches the weeks, not the rounds', async () => {
    const { user } = open();
    const weekly = totals();
    expect(weekly[1]).toBe('16');
    expect(weekly[5]).toBe('16');
    await user.selectOptions(screen.getByLabelText('Cadence'), '14');
    const fortnightly = totals();
    expect(fortnightly[1]).toBe(weekly[1]);
    expect(fortnightly[5]).toBe('32');
    expect((screen.getByLabelText('Cadence') as HTMLSelectElement).selectedOptions[0].text).toBe('Every 2 weeks');
  });

  it('lists the notes under the table', () => {
    const { container } = open();
    const text = container.textContent ?? '';
    expect(text).toContain('Stages are counted one after the other.');
    expect(text).toContain('A best-of series counts as one match.');
    expect(text).toContain('bounds');
  });

  it('a document with errors shows the message and a way to the Issues tab instead of a table', () => {
    const broken = { ...presetDoc(), stages: [] } as ReturnType<typeof presetDoc>;
    open(broken);
    expect(screen.getByText('Fix the errors first. The Issues tab says what is wrong.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show the issues' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('the German message for a document with errors', () => {
    open({ ...presetDoc(), stages: [] } as ReturnType<typeof presetDoc>, 'de');
    expect(screen.getByText(/^Behebe zuerst die Fehler\./)).toBeTruthy();
  });
});
