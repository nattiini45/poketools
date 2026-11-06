/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import type { SubmittableAdjustKind } from '@/lib/format-engine/runtime/view-types';
import AdjustmentsPanel from '../AdjustmentsPanel';
import { MARA, MISTY, SEASON, TARGETS, failResponse, okResponse, sent } from './helpers';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const fetchMock = vi.fn();
const ALL: SubmittableAdjustKind[] = ['points', 'resource', 'relation', 'action', 'rank', 'domain'];

function mount(allowed: SubmittableAdjustKind[] = ALL, locale: Locale = 'en') {
  return render(withI18n(<AdjustmentsPanel seasonId={SEASON} allowed={allowed} targets={TARGETS} />, { locale }));
}

const form = (container: HTMLElement): HTMLFormElement => container.querySelector('form') as HTMLFormElement;

async function fillPoints(user: ReturnType<typeof userEvent.setup>, points: string, reason = 'Late team') {
  await user.selectOptions(screen.getByLabelText('Stage'), 'cup');
  await user.selectOptions(screen.getByLabelText('Player'), MARA);
  await user.type(screen.getByLabelText('Points'), points);
  if (reason !== '') await user.type(screen.getByRole('textbox', { name: 'Reason' }), reason);
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  mocks.refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('AdjustmentsPanel: which forms exist', () => {
  it('lists only the allowed kinds that have a form, and names the others as API only', () => {
    mount(['points', 'rank', 'domain', 'action']);
    const options = within(screen.getByLabelText('What to adjust')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Points']);
    expect(screen.getByText(/Also allowed by this format, but not built here: Ranking and List entries\./)).toBeTruthy();
  });

  it('offers points, items and relation, and says relation links are API only', () => {
    mount();
    const options = within(screen.getByLabelText('What to adjust')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Points', 'Items', 'Relation']);
    expect(screen.getByText(/Ranking, List entries and Relation links/)).toBeTruthy();
  });

  it('a format that allows nothing buildable shows no form', () => {
    mount(['action']);
    expect(screen.queryByRole('button', { name: 'Record adjustment' })).toBeNull();
    expect(screen.getByText('This format does not allow any adjustment that can be made here.')).toBeTruthy();
  });
});

describe('AdjustmentsPanel: points', () => {
  it('sends points with decimals and a comma, trims the reason, then clears the form and reads the page again', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ adjustment_id: 'a1' }, 201));
    const { container } = mount();
    await fillPoints(user, '-1,5', '  Late team  ');
    expect(form(container).getAttribute('data-unsaved')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(sent(fetchMock)).toEqual({
      url: `/api/seasons/${SEASON}/format/adjustments`,
      method: 'POST',
      body: { reason: 'Late team', adjustment: { kind: 'points', stage: 'cup', player_id: MARA, points: -1.5 } },
    });
    expect(screen.getByText('Adjustment recorded.')).toBeTruthy();
    expect((screen.getByLabelText('Points') as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('textbox', { name: 'Reason' }) as HTMLTextAreaElement).value).toBe('');
    expect(form(container).hasAttribute('data-unsaved')).toBe(false);
  });

  it('the players follow the stage', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByLabelText('Player').hasAttribute('disabled')).toBe(true);
    await user.selectOptions(screen.getByLabelText('Stage'), 'cup');
    expect(within(screen.getByLabelText('Player')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose…', 'Mara', 'Misty']);
    await user.selectOptions(screen.getByLabelText('Stage'), 'side');
    expect(within(screen.getByLabelText('Player')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose…', 'Brock']);
  });

  it.each([
    ['1000.01', 'The points are too large.'],
    ['0.001', 'The points must be a number with at most 2 decimals.'],
    ['abc', 'The points must be a number with at most 2 decimals.'],
    ['0', 'Zero points change nothing.'],
  ])('refuses %s before it leaves the page: %s', async (points, message) => {
    const user = userEvent.setup();
    mount();
    await fillPoints(user, points);
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
    expect(screen.getByText(message)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts the bounds, 1000 and -1000, and half points', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ adjustment_id: 'a1' }, 201));
    mount();
    await fillPoints(user, '-1000');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((sent(fetchMock).body as { adjustment: { points: number } }).adjustment.points).toBe(-1000);
  });

  it('needs a reason, counted in characters', async () => {
    const user = userEvent.setup();
    mount();
    await fillPoints(user, '2', '');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
    expect(screen.getByText('Write a reason for the adjustment.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.type(screen.getByRole('textbox', { name: 'Reason' }), '😀😀');
    expect(screen.getByText('2 of 500 characters')).toBeTruthy();
  });

  it('a reason over 500 characters cannot be sent', async () => {
    const user = userEvent.setup();
    mount();
    await fillPoints(user, '2', '');
    const box = screen.getByRole('textbox', { name: 'Reason' });
    await user.click(box);
    await user.paste('x'.repeat(501));
    expect(screen.getByText('501 of 500 characters')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record adjustment' }).hasAttribute('disabled')).toBe(true);
    await user.clear(box);
    await user.paste('😀'.repeat(500));
    expect(screen.getByRole('button', { name: 'Record adjustment' }).hasAttribute('disabled')).toBe(false);
  });

  it('shows the words of a refusal and keeps what was typed', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(failResponse(422, 'format_adjust_not_allowed', 'This format does not allow this kind of adjustment.'));
    mount();
    await fillPoints(user, '2');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This format does not allow this kind of adjustment.');
    expect((screen.getByLabelText('Points') as HTMLInputElement).value).toBe('2');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe('AdjustmentsPanel: items', () => {
  async function pickResource(user: ReturnType<typeof userEvent.setup>, resource: string) {
    await user.selectOptions(screen.getByLabelText('Item type'), resource);
    await user.selectOptions(screen.getByLabelText('Player'), MISTY);
  }

  it('an item type that holds a list asks for an entry of that list', async () => {
    const user = userEvent.setup();
    mount();
    await user.selectOptions(screen.getByLabelText('What to adjust'), 'resource');
    await pickResource(user, 'gifts');
    expect(within(screen.getByLabelText('Entry')).getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(['', 'pikachu', 'eevee']);

    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Gift was lost');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
    expect(screen.getByText('Choose an entry.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives an entry', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ adjustment_id: 'a2' }, 201));
    mount();
    await user.selectOptions(screen.getByLabelText('What to adjust'), 'resource');
    await pickResource(user, 'gifts');
    await user.selectOptions(screen.getByLabelText('Entry'), 'eevee');
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Gift was lost');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sent(fetchMock).body).toEqual({
      reason: 'Gift was lost',
      adjustment: { kind: 'resource', resource: 'gifts', player_id: MISTY, item_id: 'eevee', amount: 1 },
    });
  });

  it('taking away sends a negative amount; a refusal for a holding the player lacks is shown and the page read again', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(failResponse(409, 'format_adjust_insufficient_holding', 'The player does not hold that many of this item, so they cannot be taken away.'));
    mount();
    await user.selectOptions(screen.getByLabelText('What to adjust'), 'resource');
    await pickResource(user, 'gifts');
    await user.selectOptions(screen.getByLabelText('Entry'), 'pikachu');
    await user.selectOptions(screen.getByLabelText('Change'), 'revoke');
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '2');
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Wrong gift');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
    expect((await screen.findByRole('alert')).textContent).toContain('cannot be taken away');
    expect((sent(fetchMock).body as { adjustment: { amount: number } }).adjustment.amount).toBe(-2);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('a counter item type needs no entry and sends none', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ adjustment_id: 'a3' }, 201));
    mount();
    await user.selectOptions(screen.getByLabelText('What to adjust'), 'resource');
    await pickResource(user, 'coins');
    expect(screen.queryByLabelText('Entry')).toBeNull();
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '5');
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Bonus');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sent(fetchMock).body).toEqual({ reason: 'Bonus', adjustment: { kind: 'resource', resource: 'coins', player_id: MISTY, amount: 5 } });
  });

  it.each([['0', 'The amount must be between 1 and 64.'], ['65', 'The amount must be between 1 and 64.'], ['1.5', 'The amount must be a whole number.']])(
    'refuses the amount %s',
    async (amount, message) => {
      const user = userEvent.setup();
      mount();
      await user.selectOptions(screen.getByLabelText('What to adjust'), 'resource');
      await pickResource(user, 'coins');
      await user.clear(screen.getByLabelText('Amount'));
      await user.type(screen.getByLabelText('Amount'), amount);
      await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Bonus');
      await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
      expect(screen.getByText(message)).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe('AdjustmentsPanel: reveal a relation', () => {
  it('sends a reveal, and nothing else can be set', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ adjustment_id: 'a4' }, 201));
    mount();
    await user.selectOptions(screen.getByLabelText('What to adjust'), 'relation');
    await user.selectOptions(screen.getByLabelText('Relation'), 'santa');
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Week 4 started');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
    expect(screen.getByText('Tick Reveal; nothing else can be set here.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox', { name: 'Reveal both sides of every link' }));
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sent(fetchMock).body).toEqual({ reason: 'Week 4 started', adjustment: { kind: 'relation', relation: 'santa', reveal: true } });
  });
});

describe('AdjustmentsPanel: language and state', () => {
  it('a clean form is not marked unsaved', () => {
    const { container } = mount();
    expect(form(container).hasAttribute('data-unsaved')).toBe(false);
  });

  it('changing only the kind or the direction without typing counts as clean for a fresh form', async () => {
    const user = userEvent.setup();
    const { container } = mount();
    await user.selectOptions(screen.getByLabelText('What to adjust'), 'relation');
    expect(form(container).hasAttribute('data-unsaved')).toBe(false);
  });

  it('renders in German', () => {
    mount(ALL, 'de');
    expect(screen.getByLabelText('Was soll korrigiert werden')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Korrektur speichern' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Grund' })).toBeTruthy();
  });
});
