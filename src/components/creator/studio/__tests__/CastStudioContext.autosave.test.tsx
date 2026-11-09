/** @vitest-environment jsdom */
/**
 * Cast Studio autosave (CastStudioContext): an edit marks the session unsaved,
 * a 5 s debounce sends one PATCH /api/cast-sessions/[id] with the whole
 * snapshot, and a pagehide sends the unsaved snapshot with `keepalive`. The
 * save badge in CastToolbar shows the flow. Realtime is stubbed: the channel
 * is not under test here.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CastSession } from '@/types/cast-session';
import { withI18n } from '@/test/i18n';

vi.mock('@/lib/broadcast/channel', () => ({
  createCastChannel: () => ({ send: vi.fn(), onMessage: vi.fn(), close: vi.fn() }),
}));
vi.mock('../MatchSelector', () => ({ default: () => <p>match selector</p> }));

import { CastStudioProvider } from '../CastStudioContext';
import CastToolbar from '../CastToolbar';
import CastStudio from '../CastStudio';

const SESSION: CastSession = {
  id: '9f2cf170-09cd-49c8-81a4-9898aefdcd21',
  owner_id: 'player-1',
  realtime_key: '',
  match_id: null,
  tournament_id: null,
  season_id: null,
  name: 'Test Session',
  mode: 'cast',
  status: 'draft',
  player1_id: null,
  player1_name: null,
  player1_avatar_url: null,
  player2_id: null,
  player2_name: null,
  player2_avatar_url: null,
  player1_team: [],
  player2_team: [],
  tracker_state: null,
  overlay_config: {},
  caster_notes: {},
  format: 'gen9ou',
  generation: 9,
  created_at: '2026-04-07T00:00:00.000Z',
  updated_at: '2026-04-07T00:00:00.000Z',
};

const fetchMock = vi.fn<typeof fetch>();

function okResponse(): Response {
  return new Response(JSON.stringify({ success: true, data: SESSION }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderStudio() {
  return render(
    withI18n(
      <CastStudioProvider session={SESSION}>
        <CastToolbar />
      </CastStudioProvider>,
    ),
  );
}

function rename(name: string) {
  fireEvent.change(screen.getByPlaceholderText('Session name...'), { target: { value: name } });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function patchBodies(): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => url === `/api/cast-sessions/${SESSION.id}` && init?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => okResponse());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Cast Studio autosave', () => {
  it('shows Saved for a freshly loaded session and sends nothing', async () => {
    renderStudio();
    expect(screen.getByText('Saved')).toBeTruthy();
    await advance(10_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an edit shows Unsaved, then one PATCH after 5 s, then Saved', async () => {
    renderStudio();
    rename('Finals');
    expect(screen.getByText('Unsaved')).toBeTruthy();

    await advance(4_999);
    expect(fetchMock).not.toHaveBeenCalled();

    await advance(1);
    expect(patchBodies()).toHaveLength(1);
    expect(patchBodies()[0]).toMatchObject({ name: 'Finals', mode: 'cast', format: 'gen9ou', generation: 9 });
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('edits inside the debounce window are sent together in one PATCH', async () => {
    renderStudio();
    rename('F');
    await advance(3_000);
    rename('Fi');
    await advance(3_000);
    rename('Finals');
    await advance(5_000);
    expect(patchBodies()).toHaveLength(1);
    expect(patchBodies()[0].name).toBe('Finals');
  });

  it('never sends a session status: the studio does not move cast_sessions.status', async () => {
    renderStudio();
    rename('Finals');
    await advance(5_000);
    expect(patchBodies()[0]).not.toHaveProperty('status');
  });

  it('pagehide sends the unsaved snapshot with keepalive', () => {
    renderStudio();
    rename('Finals');
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/cast-sessions/${SESSION.id}`);
    expect(init).toMatchObject({ method: 'PATCH', keepalive: true });
    expect(JSON.parse(String(init?.body)).name).toBe('Finals');
  });

  it('pagehide sends nothing when everything is saved', async () => {
    renderStudio();
    rename('Finals');
    await advance(5_000);
    fetchMock.mockClear();
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Cast Studio autosave behaviour fixes', () => {
  it('an HTTP error shows Save failed, not Saved, and keeps the edit for the next save', async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse(400, { success: false, error: 'match_id: Invalid UUID', code: 'validation_failed' }),
    );
    renderStudio();
    rename('Finals');
    await advance(5_000);
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByText('Save failed').getAttribute('title')).toBe('match_id: Invalid UUID');

    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    rename('Finals 2');
    expect(screen.getByText('Unsaved')).toBeTruthy();
    await advance(5_000);
    expect(patchBodies().at(-1)?.name).toBe('Finals 2');
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('success: false in a 200 answer is a failed save', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse(200, { success: false, error: 'nope' }));
    renderStudio();
    rename('Finals');
    await advance(5_000);
    expect(screen.getByText('Save failed')).toBeTruthy();
  });

  it('a network failure shows Save failed instead of Saving... forever', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    renderStudio();
    rename('Finals');
    await advance(5_000);
    expect(screen.queryByText('Saving...')).toBeNull();
    expect(screen.getByText('Save failed')).toBeTruthy();
  });

  it('an edit made while the save runs stays unsaved and is sent by the next save', async () => {
    let answer: (res: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve; }));
    renderStudio();
    rename('Finals');
    await advance(5_000);
    expect(screen.getByText('Saving...')).toBeTruthy();

    rename('Grand Finals');
    await advance(5_000);
    expect(patchBodies()).toHaveLength(1);

    await act(async () => {
      answer(okResponse());
    });
    expect(screen.getByText('Unsaved')).toBeTruthy();

    await advance(5_000);
    expect(patchBodies()).toHaveLength(2);
    expect(patchBodies()[1].name).toBe('Grand Finals');
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('an edit while saving that leaves the stored session unchanged ends Saved', async () => {
    let answer: (res: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve; }));
    renderStudio();
    rename('Finals');
    await advance(5_000);
    fireEvent.click(screen.getByRole('button', { name: 'Facing' }));
    await act(async () => {
      answer(okResponse());
    });
    expect(screen.getByText('Saved')).toBeTruthy();
    await advance(10_000);
    expect(patchBodies()).toHaveLength(1);
  });

  it('Change Match saves match_id null, which the PATCH schema accepts', async () => {
    render(
      withI18n(
        <CastStudioProvider session={{ ...SESSION, match_id: 'b3a2c4d5-0000-4000-8000-000000000001' }}>
          <CastStudio />
        </CastStudioProvider>,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change Match' }));
    expect(screen.getByText('match selector')).toBeTruthy();
    await advance(5_000);
    expect(patchBodies()[0].match_id).toBeNull();
    expect(screen.getByText('Saved')).toBeTruthy();
  });
});
