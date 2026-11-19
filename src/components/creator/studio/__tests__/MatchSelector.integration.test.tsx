/** @vitest-environment jsdom */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CastSession } from '@/types/cast-session';
import type { CastChannelMessage } from '@/lib/broadcast/channel';
import { withI18n } from '@/test/i18n';
import { CastStudioProvider, useCastStudio } from '../CastStudioContext';
import MatchSelector from '../MatchSelector';

const channel = vi.hoisted(() => ({ send: vi.fn(), onMessage: vi.fn(), close: vi.fn() }));
vi.mock('@/lib/broadcast/channel', () => ({ createCastChannel: () => channel }));

const ID = '10000000-0000-4000-8000-000000000001';
const session: CastSession = {
  id: ID, owner_id: 'fixture-caster', realtime_key: 'fixture-channel-key', name: 'Fixture studio',
  match_id: null, tournament_id: null, season_id: null, mode: 'cast', status: 'draft',
  player1_id: null, player1_name: null, player1_avatar_url: null,
  player2_id: null, player2_name: null, player2_avatar_url: null,
  player1_team: [], player2_team: [], tracker_state: null, overlay_config: {}, caster_notes: {},
  format: 'gen9ou', generation: 9, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z',
};
const postPath = `/api/cast-sessions/${ID}/populate`;
const leagueA = { id: 'league-a', name: 'Fixture League A' };
const leagueB = { id: 'league-b', name: 'Fixture League B' };
const phaseA = { id: 'phase-a', season_id: leagueA.id, name: 'Fixture Phase A' };
const phaseB = { id: 'phase-b', season_id: leagueB.id, name: 'Fixture Phase B' };
const phaseA2 = { id: 'phase-a2', season_id: leagueA.id, name: 'Fixture Phase A2' };
const roundA = { id: 'round-a', phase_id: phaseA.id, name: 'Fixture Round A', best_of: 3 };
const roundB = { id: 'round-b', phase_id: phaseB.id, name: 'Fixture Round B', best_of: 3 };
const matchA = { id: 'match-a', phase_id: phaseA.id, round_id: roundA.id, player_1_name: 'Aster', player_2_name: 'Birch', status: 'scheduled' };
const matchB = { id: 'match-b', phase_id: phaseB.id, round_id: roundB.id, player_1_name: 'Clover', player_2_name: 'Dune', status: 'scheduled' };
const roundPath = (phase: typeof phaseA) => `/api/seasons/${phase.season_id}/phases/${phase.id}/rounds`;
const detailA = `${roundPath(phaseA)}/${roundA.id}`;
const detailB = `${roundPath(phaseB)}/${roundB.id}`;

const mockFetch = vi.fn<typeof fetch>();
const reads = new Map<string, unknown>();
const delays = new Map<string, Promise<Response>>();

function json(data: unknown) {
  return Response.json({ success: true, data });
}

function hold(url: string) {
  let complete!: (response: Response) => void;
  delays.set(url, new Promise((resolve) => { complete = resolve; }));
  return async (data: unknown) => {
    await act(async () => { complete(json(data)); });
  };
}

function populated(match: { id: string; season_id: string | null; phase_id?: string; tournament_id?: string }) {
  return {
    match: { ...match, round_name: null, best_of: 3, status: 'scheduled' },
    player1: { id: 'p1', name: 'Fixture One', avatar_url: null },
    player2: { id: 'p2', name: 'Fixture Two', avatar_url: null },
    player1_team: [], player2_team: [], games: [], games_played: 0, format: 'gen9ou', generation: 9,
  };
}

function SelectionSummary() {
  const { state } = useCastStudio();
  return <output>{state.matchId ?? 'No fixture match'}</output>;
}

function studio(phaseMode: boolean, startingSession = session) {
  const user = userEvent.setup();
  render(withI18n(
    <CastStudioProvider session={startingSession} phaseMode={phaseMode}>
      <MatchSelector />
      <SelectionSummary />
    </CastStudioProvider>,
  ));
  return async (name: string, value: string) => {
    const select = screen.getByRole('combobox', { name });
    await user.selectOptions(select, await within(select).findByRole('option', {
      name: new RegExp(value),
    }));
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  reads.clear();
  delays.clear();
  reads.set('/api/seasons', [leagueA, leagueB]);
  reads.set(`/api/seasons/${leagueA.id}/phases`, [phaseA, phaseA2]);
  reads.set(`/api/seasons/${leagueB.id}/phases`, [phaseB]);
  reads.set(roundPath(phaseA), [roundA]);
  reads.set(roundPath(phaseB), [roundB]);
  reads.set(detailA, { ...roundA, matches: [matchA] });
  reads.set(detailB, { ...roundB, matches: [matchB] });
  mockFetch.mockImplementation(async (input) => {
    const url = String(input);
    const delayed = delays.get(url);
    if (delayed) return delayed;
    if (reads.has(url)) return json(reads.get(url));
    throw new Error(`Unmocked fixture request: ${url}`);
  });
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => vi.unstubAllGlobals());

it('uses the unchanged legacy routes and populate body when the flag is off', async () => {
  reads.set('/api/tournaments?season_id=league-a', [{ id: 'tournament-a', name: 'Fixture Tournament' }]);
  reads.set('/api/tournaments/tournament-a/rounds', [roundA]);
  reads.set('/api/tournaments/tournament-a/rounds/round-a', { ...roundA, matches: [matchA] });
  reads.set(postPath, populated({ id: matchA.id, tournament_id: 'tournament-a', season_id: leagueA.id }));
  const choose = studio(false);
  await choose('League / Season', 'Fixture League A');
  await choose('Tournament', 'Fixture Tournament');
  await choose('Round', 'Fixture Round A');
  await choose('Match', 'Aster vs Birch');
  expect(await screen.findByText(matchA.id)).toBeTruthy();
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
    '/api/seasons', '/api/tournaments?season_id=league-a', '/api/tournaments/tournament-a/rounds',
    '/api/tournaments/tournament-a/rounds/round-a', postPath,
  ]);
  expect(JSON.parse(String(mockFetch.mock.calls.at(-1)?.[1]?.body))).toEqual({ match_id: matchA.id });
  expect(channel.send).toHaveBeenCalledWith({
    type: 'studio_action',
    action: { type: 'populate_match', data: reads.get(postPath) },
  });
});

it('uses a scoped phase populate and saves the ref from an initially unbound independent session', async () => {
  const ref = { season_id: leagueA.id, phase_id: phaseA.id, match_id: matchA.id };
  reads.set(postPath, populated({ id: ref.match_id, phase_id: ref.phase_id, season_id: ref.season_id }));
  const choose = studio(true);
  await choose('League / Season', 'Fixture League A');
  await choose('Phase', 'Fixture Phase A$');
  await choose('Round', 'Fixture Round A');
  await choose('Match', 'Aster vs Birch');
  expect(await screen.findByText(matchA.id)).toBeTruthy();
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
    '/api/seasons', '/api/seasons/league-a/phases', roundPath(phaseA), detailA, postPath,
  ]);
  expect(JSON.parse(String(mockFetch.mock.calls.at(-1)?.[1]?.body))).toEqual({ phase_ref: ref });
  expect(channel.send).toHaveBeenCalledWith({
    type: 'studio_action',
    action: expect.objectContaining({
      type: 'populate_match', phaseRef: ref,
      data: expect.objectContaining({ match: expect.objectContaining({ tournament_id: null }) }),
    }),
  });
  act(() => window.dispatchEvent(new Event('pagehide')));
  const [url, init] = mockFetch.mock.calls.at(-1) ?? [];
  expect(url).toBe(`/api/cast-sessions/${ID}`);
  expect(init).toMatchObject({ method: 'PATCH', keepalive: true });
  const update = JSON.parse(String(init?.body));
  expect(update).toMatchObject({ phase_ref: ref });
  for (const key of ['match_id', 'tournament_id', 'season_id']) expect(update).not.toHaveProperty(key);
});

it('discards a late phase list from the previous league', async () => {
  const finish = hold('/api/seasons/league-a/phases');
  const choose = studio(true);
  await choose('League / Season', 'Fixture League A');
  await choose('League / Season', 'Fixture League B');
  await screen.findByRole('option', { name: phaseB.name });
  await finish([phaseA]);
  expect(screen.queryByRole('option', { name: phaseA.name })).toBeNull();
  expect(screen.getByRole('option', { name: phaseB.name })).toBeTruthy();
});

it('never offers stale rounds or matches across a changed phase or league', async () => {
  const finishRounds = hold(roundPath(phaseA));
  const choose = studio(true);
  await choose('League / Season', 'Fixture League A');
  await choose('Phase', 'Fixture Phase A$');
  await choose('Phase', 'Fixture Phase A2');
  await finishRounds([roundA]);
  expect(screen.queryByRole('option', { name: /Fixture Round A/ })).toBeNull();

  delays.delete(roundPath(phaseA));
  const finishMatches = hold(detailA);
  await choose('Phase', 'Fixture Phase A$');
  await choose('Round', 'Fixture Round A');
  await choose('League / Season', 'Fixture League B');
  await choose('Phase', 'Fixture Phase B');
  await choose('Round', 'Fixture Round B');
  await screen.findByRole('option', { name: /Clover vs Dune/ });
  await finishMatches({ ...roundA, matches: [matchA] });
  expect(screen.queryByRole('option', { name: /Aster vs Birch/ })).toBeNull();
  expect(screen.getByRole('option', { name: /Clover vs Dune/ })).toBeTruthy();
  expect(mockFetch.mock.calls.some(([url]) => url === postPath)).toBe(false);
});

it('ignores a late populate after the league changes and rejects a mismatched native response', async () => {
  const finish = hold(postPath);
  const choose = studio(true);
  await choose('League / Season', 'Fixture League A');
  await choose('Phase', 'Fixture Phase A$');
  await choose('Round', 'Fixture Round A');
  await choose('Match', 'Aster vs Birch');
  await choose('League / Season', 'Fixture League B');
  await finish(populated({ id: matchA.id, phase_id: phaseA.id, season_id: leagueA.id }));
  expect(screen.getByText('No fixture match')).toBeTruthy();

  delays.delete(postPath);
  reads.set(postPath, populated({ id: matchB.id, phase_id: phaseB.id, season_id: leagueA.id }));
  await choose('Phase', 'Fixture Phase B');
  await choose('Round', 'Fixture Round B');
  await choose('Match', 'Clover vs Dune');
  expect((await screen.findByRole('alert')).textContent).toContain('Could not fill this session');
  expect(screen.getByText('No fixture match')).toBeTruthy();
  expect(channel.send).not.toHaveBeenCalledWith(expect.objectContaining({
    action: expect.objectContaining({ type: 'populate_match' }),
  }));
});

it('keeps the standalone tournament round endpoint in phase mode', async () => {
  reads.set('/api/tournaments/standalone/rounds', [roundA]);
  reads.set('/api/tournaments/standalone/rounds/round-a', { ...roundA, matches: [matchA] });
  reads.set(postPath, populated({ id: matchA.id, tournament_id: 'standalone', season_id: null }));
  const choose = studio(true, { ...session, tournament_id: 'standalone' });
  await choose('Round', 'Fixture Round A');
  await choose('Match', 'Aster vs Birch');
  expect(await screen.findByText(matchA.id)).toBeTruthy();
  expect(JSON.parse(String(mockFetch.mock.calls.at(-1)?.[1]?.body))).toEqual({ match_id: matchA.id });
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
    '/api/seasons', '/api/tournaments/standalone/rounds', '/api/tournaments/standalone/rounds/round-a', postPath,
  ]);
});

it('uses the optional phase ref from another studio tab, while still accepting the old legacy action wire', () => {
  studio(true);
  const receive: (message: CastChannelMessage) => void = channel.onMessage.mock.calls[0][0];
  act(() => receive({
    type: 'studio_action',
    action: { type: 'set_match', matchId: 'legacy-match', tournamentId: 'legacy-tournament', seasonId: null },
  }));
  expect(screen.getByText('legacy-match')).toBeTruthy();
  const ref = { season_id: leagueA.id, phase_id: phaseA.id, match_id: matchA.id };
  act(() => receive({
    type: 'studio_action',
    action: { type: 'set_match', matchId: matchA.id, tournamentId: null, seasonId: leagueA.id, phaseRef: ref },
  }));
  expect(screen.getByText(matchA.id)).toBeTruthy();
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(JSON.parse(String(mockFetch.mock.calls.at(-1)?.[1]?.body))).toMatchObject({ phase_ref: ref });
});
