import { beforeEach, describe, expect, it, vi } from 'vitest';

const reads = vi.hoisted(() => ({
  season: vi.fn(),
  tournament: vi.fn(),
  playerProfile: vi.fn(),
}));

vi.mock('@/lib/cache/public-reads', () => ({ publicReads: reads }));

import { leagueMetadata, playerMetadata, tournamentMetadata } from '../page-metadata';
import { readLeague, readPlayerProfile, readTournament } from '../page-reads';
import { NOINDEX } from '../robots';

const ID = '11111111-1111-4111-8111-111111111111';

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