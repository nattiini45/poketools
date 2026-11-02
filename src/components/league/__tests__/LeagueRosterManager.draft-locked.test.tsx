/** @vitest-environment jsdom */
/**
 * While a legacy draft is in progress the participants route answers 409 SEASON_DRAFT_LOCKED. The roster manager
 * shows the localized message (it tells the admin to end the draft or move it back to pending) and keeps the list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LeagueRosterManager from '../LeagueRosterManager';
import { withI18n } from '@/test/i18n';
import { errorsDraft } from '@/i18n/messages/errors/draft';

const SEASON_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const PARTICIPANTS = [
  { id: 'p-1', name: 'Ash', gym_type: null, avatar_url: null, core_types: null, is_guest: false, is_test_account: false },
  { id: 'p-2', name: 'Misty', gym_type: null, avatar_url: null, core_types: null, is_guest: false, is_test_account: false },
];

function stubApi(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      return json(
        { success: false, error: errorsDraft.en.SEASON_DRAFT_LOCKED, code: 'SEASON_DRAFT_LOCKED' },
        409,
      );
    }
    if (url === `/api/seasons/${SEASON_ID}/participants`) return json({ success: true, data: PARTICIPANTS });
    return json({ success: true, data: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const mount = (locale: 'en' | 'de') =>
  render(
    withI18n(<LeagueRosterManager seasonId={SEASON_ID} showTypeSelector={false} leagueState={{ status: 'active', archived: false }} />, {
      locale,
    }),
  );

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LeagueRosterManager with a legacy draft in progress', () => {
  it('shows the English refusal and keeps the trainer in the list', async () => {
    stubApi();
    const user = userEvent.setup();
    mount('en');

    await user.click((await screen.findAllByRole('button', { name: 'Remove' }))[0]);

    expect(await screen.findByText(errorsDraft.en.SEASON_DRAFT_LOCKED)).toBeTruthy();
    expect(errorsDraft.en.SEASON_DRAFT_LOCKED).toMatch(/End the draft/);
    expect(screen.getByText('Ash')).toBeTruthy();
    expect(screen.getByText('Misty')).toBeTruthy();
  });

  it('shows the German refusal', async () => {
    stubApi();
    const user = userEvent.setup();
    mount('de');

    await user.click((await screen.findAllByRole('button', { name: 'Entfernen' }))[0]);

    expect(await screen.findByText(errorsDraft.de.SEASON_DRAFT_LOCKED)).toBeTruthy();
    expect(errorsDraft.de.SEASON_DRAFT_LOCKED).toMatch(/Beende den Draft/);
    expect(screen.getByText('Ash')).toBeTruthy();
  });
});
