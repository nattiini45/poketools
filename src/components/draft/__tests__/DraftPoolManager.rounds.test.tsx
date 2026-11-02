/** @vitest-environment jsdom */
/**
 * The legacy create form has a Rounds field (default 11, 1 to 50, English and German): what is typed is the `rounds`
 * of the `POST /api/drafts` body, an untouched form sends none, and an invalid value blocks Create.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DraftPoolManager from '../DraftPoolManager';
import { withI18n } from '@/test/i18n';
import { draftPoolCreateSchema } from '@/lib/validation';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const SEASON = '00000000-0000-4000-a000-000000000001';
const fetchMock = vi.fn();

const mount = (locale: 'en' | 'de' = 'en', props: { pointBuy?: boolean } = {}) =>
  render(withI18n(<DraftPoolManager seasonId={SEASON} seasonName="Season 3" {...props} />, { locale }));

const sentBody = () => JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as Record<string, unknown>;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { id: 'pool-1' } }) });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DraftPoolManager rounds field', () => {
  it('is labelled, starts at 11 and is bounded 1 to 50', () => {
    mount();
    const input = screen.getByLabelText('Rounds') as HTMLInputElement;

    expect(input.value).toBe('11');
    expect(input.min).toBe('1');
    expect(input.max).toBe('50');
    expect(input.getAttribute('inputmode')).toBe('numeric');
  });

  it('is labelled in German', () => {
    mount('de');

    expect((screen.getByLabelText('Runden') as HTMLInputElement).value).toBe('11');
  });

  it('an untouched form sends no rounds', async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole('button', { name: 'Create Draft Pool' }));

    expect(sentBody()).toEqual({ season_id: SEASON, draft_type: 'snake', pick_order: 'snake' });
  });

  it('sends the typed rounds, and the body passes the route schema', async () => {
    const user = userEvent.setup();
    mount();
    const input = screen.getByLabelText('Rounds');

    await user.clear(input);
    await user.type(input, '6');
    await user.click(screen.getByRole('button', { name: 'Create Draft Pool' }));

    expect(sentBody()).toEqual({ season_id: SEASON, draft_type: 'snake', pick_order: 'snake', rounds: 6 });
    expect(draftPoolCreateSchema.safeParse(sentBody()).success).toBe(true);
  });

  it.each([
    ['0', 'en', 'Enter a whole number from 1 to 50.'],
    ['51', 'en', 'Enter a whole number from 1 to 50.'],
    ['0', 'de', 'Gib eine ganze Zahl von 1 bis 50 ein.'],
  ] as const)('refuses %s with a visible message in %s and disables Create', async (value, locale, message) => {
    mount(locale);
    const input = screen.getByLabelText(locale === 'en' ? 'Rounds' : 'Runden');

    fireEvent.change(input, { target: { value } });

    expect(screen.getByText(message)).toBeTruthy();
    expect((screen.getByRole('button', { name: locale === 'en' ? 'Create Draft Pool' : 'Draft-Pool erstellen' }) as HTMLButtonElement).disabled).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('is not shown for a point-buy season', () => {
    mount('en', { pointBuy: true });

    expect(screen.queryByLabelText('Rounds')).toBeNull();
  });
});
