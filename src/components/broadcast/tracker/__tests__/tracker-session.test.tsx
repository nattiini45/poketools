/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CasterData } from '@/types/caster';
import BattleTracker from '../BattleTracker';

vi.mock('../TrackerToolsPanel', () => ({
  default: ({ sessionId }: { sessionId?: string }) => <output>{sessionId ?? 'No cast session'}</output>,
}));
vi.mock('../TrackerTeamColumn', () => ({ default: () => null }));
vi.mock('../TrackerScorebar', () => ({ default: () => null }));
vi.mock('../TrackerControls', () => ({ default: () => null }));
vi.mock('../MomentumIndicator', () => ({ default: () => null }));

const p1 = { id: 'p1', name: 'Fixture Aster', avatar_url: null };
const p2 = { id: 'p2', name: 'Fixture Birch', avatar_url: null };
const details = {
  avatarUrl: null, rating: null, rd: null, record: { wins: 0, losses: 0, draws: 0 }, signaturePokemon: null,
  streak: { type: null, count: 0 }, team: [], pokemon: [], archetype: null, nextMatch: null,
};
const caster: CasterData = {
  matchId: 'match-a', tournamentId: null, seasonId: 'league-a', roundName: null, bestOf: 3,
  format: 'gen9ou', generation: 9,
  player1: { ...details, id: p1.id, name: p1.name }, player2: { ...details, id: p2.id, name: p2.name },
  h2h: { player1Wins: 0, player2Wins: 0, draws: 0, pastMatches: [] }, standings: null,
};

afterEach(() => vi.unstubAllGlobals());

it('passes the reused native session ID to the existing tools, not the ID for a navigated-away match', async () => {
  const pending = new Map<string, (result: Response) => void>();
  const requests = vi.fn((url: string) => new Promise<Response>((resolve) => pending.set(url, resolve)));
  vi.stubGlobal('fetch', requests);
  const view = render(<BattleTracker matchId="match-a" player1={p1} player2={p2} casterData={caster} openPhaseSession />);
  expect(screen.getByText('No cast session')).toBeTruthy();
  expect(requests).toHaveBeenCalledWith('/api/cast-sessions/phase-match/match-a', expect.objectContaining({ method: 'POST' }));
  view.rerender(<BattleTracker matchId="match-b" player1={p1} player2={p2} casterData={caster} openPhaseSession />);
  await act(async () => {
    pending.get('/api/cast-sessions/phase-match/match-a')?.(Response.json({ success: true, data: { id: 'stale-session' } }));
    pending.get('/api/cast-sessions/phase-match/match-b')?.(Response.json({ success: true, data: { id: 'active-session' } }));
  });
  expect(screen.queryByText('stale-session')).toBeNull();
  expect(screen.getByText('active-session')).toBeTruthy();
});

it('does not POST when supplied a legacy session or when used without creator session access', () => {
  const requests = vi.fn();
  vi.stubGlobal('fetch', requests);
  const view = render(<BattleTracker matchId="legacy-match" player1={p1} player2={p2} casterData={caster} sessionId="legacy-session" />);
  expect(screen.getByText('legacy-session')).toBeTruthy();
  view.rerender(<BattleTracker matchId="phase-match" player1={p1} player2={p2} />);
  expect(requests).not.toHaveBeenCalled();
});
