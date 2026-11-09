/** @vitest-environment jsdom */
/**
 * The roster of a started phase of the league's format is refused by the server (409 `format_phase_owned`). The screen
 * keeps its controls usable for such a phase, shows the reason dialog after that refusal and repeats the request with
 * `force` and the reason only once the admin confirmed it. Nothing is retried silently, and cancelling sends nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ParticipantManager from '../ParticipantManager';
import { withI18n } from '@/test/i18n';

const TID = 't-1';
const SEASON = 's-1';

const roster = [
  { id: 'p1', name: 'Alice', avatar_url: null, seed: 1, starting_bracket: 'winners', is_guest: false },
  { id: 'p2', name: 'Bob', avatar_url: null, seed: 2, starting_bracket: 'winners', is_guest: false },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const owned = () => json({ success: false, error: 'This phase belongs to the format of this league', code: 'format_phase_owned' }, 409);

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

function stubApi(tournament: Record<string, unknown>, answer: (call: Call) => Response | null) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? 'GET',
        url,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      };
      calls.push(call);
      const custom = answer(call);
      if (custom) return custom;
      if (url === `/api/tournaments/${TID}`) return json({ success: true, data: tournament });
      if (url === `/api/tournaments/${TID}/participants` && call.method === 'GET') return json({ success: true, data: roster });
      if (url === '/api/ratings') return json({ success: true, data: [] });
      // The silent standings sync that opens a league phase: the started format phase refuses it, as it does in production.
      if (url.endsWith('/sync-standings')) return owned();
      return json({ success: true, data: null });
    }),
  );
  return calls;
}

const startedFormatPhase = {
  id: TID,
  season_id: SEASON,
  status: 'active',
  season_format_type: 'custom',
  bracket_type: 'swiss',
  current_round: 1,
  enrollment_source: null,
};

const writes = (calls: Call[]) => calls.filter((call) => call.method !== 'GET' && !call.url.endsWith('/sync-standings'));

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ParticipantManager on a started phase of the league format', () => {
  it('asks for a reason after the refusal and repeats the removal with force and the reason', async () => {
    const calls = stubApi(startedFormatPhase, (call) => (call.method === 'DELETE' && call.body?.force === undefined ? owned() : null));
    const user = userEvent.setup();
    render(withI18n(<ParticipantManager tournamentId={TID} />));

    await user.click((await screen.findAllByRole('button', { name: 'Remove' }))[1]);

    // The first request was the plain one; the dialog is open and nothing else has been sent.
    expect(await screen.findByRole('dialog', { name: 'Change the roster of a started phase' })).toBeTruthy();
    expect(writes(calls)).toEqual([{ method: 'DELETE', url: `/api/tournaments/${TID}/participants`, body: { player_id: 'p2' } }]);

    const confirm = screen.getByRole('button', { name: 'Change roster anyway' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: /Reason/ }), '  Wrong player  ');
    await user.click(confirm);

    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1]).toEqual({
      method: 'DELETE',
      url: `/api/tournaments/${TID}/participants`,
      body: { player_id: 'p2', force: true, reason: 'Wrong player' },
    });
    await waitFor(() => expect(screen.queryByText('Bob')).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends nothing more when the admin cancels the dialog', async () => {
    const calls = stubApi(startedFormatPhase, (call) => (call.method === 'DELETE' ? owned() : null));
    const user = userEvent.setup();
    render(withI18n(<ParticipantManager tournamentId={TID} />));

    await user.click((await screen.findAllByRole('button', { name: 'Remove' }))[0]);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes(calls)).toHaveLength(1);
    expect(screen.getByText('Alice')).toBeTruthy();
  });

  it('shows another refusal as an error and offers no force for it', async () => {
    stubApi(startedFormatPhase, (call) =>
      call.method === 'DELETE' ? json({ success: false, error: 'Bracket seat count is fixed after generation', code: 'BRACKET_LOCKED_USE_SUBSTITUTE' }, 400) : null,
    );
    const user = userEvent.setup();
    render(withI18n(<ParticipantManager tournamentId={TID} />));

    await user.click((await screen.findAllByRole('button', { name: 'Remove' }))[0]);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says it in German', async () => {
    stubApi(startedFormatPhase, (call) => (call.method === 'DELETE' ? owned() : null));
    const user = userEvent.setup();
    render(withI18n(<ParticipantManager tournamentId={TID} />, { locale: 'de' }));

    await user.click((await screen.findAllByRole('button', { name: 'Entfernen' }))[0]);

    expect(await screen.findByRole('dialog', { name: 'Teilnehmerliste einer gestarteten Phase ändern' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Trotzdem ändern' })).toBeTruthy();
  });

  it('keeps the controls locked for a started phase that is not the format\'s (no custom league)', async () => {
    stubApi({ ...startedFormatPhase, season_format_type: 'round_robin' }, () => null);
    render(withI18n(<ParticipantManager tournamentId={TID} />));

    const removes = await screen.findAllByRole('button', { name: 'Remove' });
    expect((removes[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
