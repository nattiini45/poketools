/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';
import AdminMatchActions from '../AdminMatchActions';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const fetchMock = vi.fn();

function ui() {
  return (
    <AdminMatchActions
      matchId="m1"
      currentStatus="scheduled"
      player1={{ id: 'p1', name: 'Ash' }}
      player2={{ id: 'p2', name: 'Gary' }}
      currentWinnerId={null}
      games={[]}
      tournamentId="t1"
      bestOf={3}
      isSiteAdmin={false}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  refresh.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('settling a scheduled match from the admin page', () => {
  it('asks for a winner before opening the dialog', async () => {
    const user = userEvent.setup();
    render(withI18n(ui()));
    await user.click(screen.getByRole('button', { name: 'Record result' }));
    expect(screen.getByText('Select a winner to record the result')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the winner and the typed reason to the result route', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: true, data: {} }) });
    const user = userEvent.setup();
    render(withI18n(ui()));

    await user.click(screen.getByRole('button', { name: 'Gary' }));
    await user.click(screen.getByRole('button', { name: 'Record result' }));
    await user.type(screen.getByRole('textbox'), 'Players reported it');
    const confirm = screen.getAllByRole('button', { name: 'Record result' }).at(-1)!;
    await user.click(confirm);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/matches/m1/result');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ winner_id: 'p2', reason: 'Players reported it' });
    await screen.findByText('Result recorded. The match is completed.');
  });

  it.each([
    ['en' as const, 'Result recorded, but some follow-up steps failed. They will be retried. The match is completed.'],
    ['de' as const, 'Ergebnis eingetragen, aber einige Folgeschritte sind fehlgeschlagen. Sie werden erneut versucht. Das Spiel ist abgeschlossen.'],
  ])(
    'shows a distinct notice and refreshes when the completion is saved but follow-up steps failed (%s)',
    async (locale, notice) => {
      fetchMock.mockResolvedValue({
        json: async () => ({
          success: false,
          error: 'The result was recorded, but 2 follow-up steps failed.',
          code: 'match_finalize_incomplete',
          params: { count: 2 },
        }),
      });
      const user = userEvent.setup();
      render(withI18n(ui(), { locale }));
      const [pick, record] = locale === 'de' ? ['Gary', 'Ergebnis eintragen'] : ['Gary', 'Record result'];
      await user.click(screen.getByRole('button', { name: pick }));
      await user.click(screen.getByRole('button', { name: record }));
      await user.type(screen.getByRole('textbox'), 'because');
      await user.click(screen.getAllByRole('button', { name: record }).at(-1)!);

      await screen.findByText(notice);
      expect(refresh).toHaveBeenCalled();
      expect(screen.queryByText('Result recorded. The match is completed.')).toBeNull();
      expect(screen.queryByText(/could not record|Das Ergebnis konnte nicht/i)).toBeNull();
    },
  );

  it('keeps the confirm button off until a reason is typed', async () => {
    const user = userEvent.setup();
    render(withI18n(ui()));
    await user.click(screen.getByRole('button', { name: 'Ash' }));
    await user.click(screen.getByRole('button', { name: 'Record result' }));
    const confirm = screen.getAllByRole('button', { name: 'Record result' }).at(-1)! as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('shows the catalogued refusal when the match moved on', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        success: false,
        error: 'Match status changed since you opened it. Reload and try again.',
        code: 'match_state_changed',
      }),
    });
    const user = userEvent.setup();
    render(withI18n(ui()));
    await user.click(screen.getByRole('button', { name: 'Ash' }));
    await user.click(screen.getByRole('button', { name: 'Record result' }));
    await user.type(screen.getByRole('textbox'), 'because');
    await user.click(screen.getAllByRole('button', { name: 'Record result' }).at(-1)!);

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByText('Result recorded. The match is completed.')).toBeNull();
  });
});
