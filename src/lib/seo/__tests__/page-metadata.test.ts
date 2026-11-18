import { beforeEach, describe, expect, it, vi } from 'vitest';

const reads = vi.hoisted(() => ({
  season: vi.fn(),
  tournament: vi.fn(),
  playerProfile: vi.fn(),
  phase: vi.fn(),
  mode: vi.fn(),
}));

vi.mock('@/lib/cache/public-reads', () => ({ publicReads: reads }));
vi.mock('@/lib/cache/phase-public-reads', () => ({ phasePublicReads: { detail: reads.phase } }));
vi.mock('@/lib/league-phase/route-mode', () => ({ requireOpenPhaseRouteMode: reads.mode }));

import { leagueMetadata, phaseMetadata, playerMetadata, tournamentMetadata } from '../page-metadata';
import { readLeague, readLeaguePhase, readPlayerProfile, readTournament } from '../page-reads';
import { NOINDEX } from '../robots';

const ID = '11111111-1111-4111-8111-111111111111';
const PHASE_ID = '22222222-2222-4222-8222-2222222222ab';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('league metadata', () => {
  it('titles the page with the league name and adds no description of its own', async () => {
    reads.season.mockResolvedValue({ id: ID, name: 'Spring League', description: 'Roster: Ash, Misty', status: 'draft' });
    const meta = await leagueMetadata(ID);
    expect(meta).toEqual({ title: 'Spring League' });
    expect(JSON.stringify(meta)).not.toContain('Ash');
  });

  it('returns nothing for a missing league so the 404 carries no title', async () => {
    reads.season.mockResolvedValue(null);
    expect(await leagueMetadata(ID)).toEqual({});
  });
});

describe('tournament metadata', () => {
  it('titles the page with the tournament name', async () => {
    reads.tournament.mockResolvedValue({ id: ID, name: 'Open Cup' });
    expect(await tournamentMetadata(ID)).toEqual({ title: 'Open Cup' });
  });

  it('returns nothing for a missing tournament', async () => {
    reads.tournament.mockResolvedValue(null);
    expect(await tournamentMetadata(ID)).toEqual({});
  });
});

describe('phase metadata', () => {
  it('publishes only the canonical URL and title for a native phase', async () => {
    reads.mode.mockResolvedValue('phase');
    reads.phase.mockResolvedValue({ id: PHASE_ID, season_id: ID, name: 'Finals', description: 'Not metadata' });
    expect(await phaseMetadata(ID, PHASE_ID.toUpperCase())).toEqual({
      title: 'Finals',
      alternates: { canonical: `/leagues/${ID}/phases/${PHASE_ID}` },
    });
    expect(reads.phase).toHaveBeenCalledExactlyOnceWith(ID, PHASE_ID);
    expect(reads.tournament).not.toHaveBeenCalled();
  });

  it('carries the original legacy record, with ownership checked before metadata is emitted', async () => {
    reads.mode.mockResolvedValue('legacy');
    const linked = { id: PHASE_ID, season_id: ID, name: 'Finals' };
    reads.tournament.mockResolvedValueOnce(linked).mockResolvedValueOnce({ ...linked, season_id: null });
    expect(await readLeaguePhase(ID, PHASE_ID)).toEqual({ kind: 'legacy-phase', tournament: linked });
    expect(await phaseMetadata(ID, PHASE_ID)).toEqual({});
    expect(reads.phase).not.toHaveBeenCalled();
  });

  it('does not fall back when native ownership is missing', async () => {
    reads.mode.mockResolvedValue('phase');
    reads.phase.mockResolvedValue(null);
    expect(await phaseMetadata(ID, PHASE_ID)).toEqual({});
    expect(reads.tournament).not.toHaveBeenCalled();
  });

  it('rejects malformed addresses without reading the mode', async () => {
    expect(await phaseMetadata(ID, 'bad')).toEqual({});
    expect(reads.mode).not.toHaveBeenCalled();
  });

  it('propagates failure to determine readiness without reading either store', async () => {
    const failure = new Error('Unavailable');
    reads.mode.mockRejectedValue(failure);
    await expect(phaseMetadata(ID, PHASE_ID)).rejects.toBe(failure);
    expect(reads.phase).not.toHaveBeenCalled();
    expect(reads.tournament).not.toHaveBeenCalled();
  });
});

describe('player metadata', () => {
  it('titles the page with the name only and keeps profiles out of the index', async () => {
    reads.playerProfile.mockResolvedValue({ player: { id: ID, name: 'Ash' } });
    expect(await playerMetadata(ID)).toEqual({ title: 'Ash', robots: NOINDEX });
  });

  it('keeps a missing profile out of the index too', async () => {
    reads.playerProfile.mockResolvedValue(null);
    expect(await playerMetadata(ID)).toEqual({ robots: NOINDEX });
  });
});

describe('page reads', () => {
  it('hand the page and its metadata the same cached read', async () => {
    reads.season.mockResolvedValue({ id: ID, name: 'Spring League' });
    reads.tournament.mockResolvedValue({ id: ID, name: 'Open Cup' });
    reads.playerProfile.mockResolvedValue({ player: { id: ID, name: 'Ash' } });
    await expect(readLeague(ID)).resolves.toMatchObject({ name: 'Spring League' });
    await expect(readTournament(ID)).resolves.toMatchObject({ name: 'Open Cup' });
    await expect(readPlayerProfile(ID)).resolves.toMatchObject({ player: { name: 'Ash' } });
    expect(reads.season).toHaveBeenCalledWith(ID);
    expect(reads.tournament).toHaveBeenCalledWith(ID);
    expect(reads.playerProfile).toHaveBeenCalledWith(ID);
  });
});
