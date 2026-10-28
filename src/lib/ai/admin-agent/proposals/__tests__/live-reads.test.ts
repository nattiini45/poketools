/**
 * The reads a start or a bracket is guarded by (`startup_checklist`, `channel_set`) and the two reads of a standalone
 * tournament's roster, answered by `live.ts` over the data layer. The data layer is mocked; the fingerprints are the ones the
 * approve route recomputes, so what matters here is what changes them and what does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/tournament/startup-checklist.server', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/tournament/startup-checklist.server')>()), loadStartupInput: vi.fn() }));
vi.mock('@/lib/admin/outward-recipients', () => ({ previewRecipients: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/queries/tournaments')>()),
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
}));

import { previewRecipients } from '@/lib/admin/outward-recipients';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { loadStartupInput } from '@/lib/tournament/startup-checklist.server';
import { hashJson } from '../../plans/hash';
import { rosterMembersState } from '../after-state';
import { fingerprintOf } from '../fingerprints';
import { liveFingerprints, liveSource } from '../live';

const TID = '00000000-0000-4000-8000-000000007710';
const SEASON = '00000000-0000-4000-8000-000000008001';
const p = (n: number) => `00000000-0000-4000-8000-${String(100 + n).padStart(12, '0')}`;

const input = (count: number, seeded = 0) =>
  ({
    bracketType: 'single_elim',
    tournamentStatus: 'upcoming',
    rulesetSet: true,
    rulesetName: 'Gen 9 OU',
    bestOfDefault: 3,
    participants: { count, seededCount: seeded, playerIds: Array.from({ length: count }, (_, i) => p(i)) },
    rounds: [],
    groupsInUse: false,
    leagueGroupOf: null,
  }) as never;
const reach = (discord: string[], social: string[]) => ({ discord: { ids: discord, names: discord.map((id) => `Discord ${id}`) }, social: { ids: social, names: social.map((id) => `x ${id}`) } }) as never;

beforeEach(() => {
  vi.resetAllMocks();
});

describe('startup_checklist', () => {
  const read = () => fingerprintOf(liveFingerprints, 'startup_checklist', { kind: 'id', id: TID });

  it('is null for a tournament that does not exist (hashed as such)', async () => {
    vi.mocked(loadStartupInput).mockResolvedValue(null);
    expect(await read()).toBe(hashJson(null));
  });

  it('changes when an item changes: a player joins, a seed is set, the roster falls below two', async () => {
    vi.mocked(loadStartupInput).mockResolvedValue(input(8, 0));
    const before = await read();
    expect(await read()).toBe(before);
    vi.mocked(loadStartupInput).mockResolvedValue(input(9, 0));
    expect(await read()).not.toBe(before);
    vi.mocked(loadStartupInput).mockResolvedValue(input(8, 8));
    expect(await read()).not.toBe(before);
    vi.mocked(loadStartupInput).mockResolvedValue(input(1, 0));
    expect(await read()).not.toBe(before);
  });

  it('is the same for the same checklist whoever the players are (ids are not part of it)', async () => {
    vi.mocked(loadStartupInput).mockResolvedValue(input(8, 2));
    const first = await read();
    vi.mocked(loadStartupInput).mockResolvedValue({ ...(input(8, 2) as object), participants: { count: 8, seededCount: 2, playerIds: Array.from({ length: 8 }, (_, i) => p(50 + i)) } } as never);
    expect(await read()).toBe(first);
  });

  it('requires an id target', async () => {
    await expect(liveFingerprints.read('startup_checklist', { kind: 'none' })).rejects.toThrow('id target');
  });
});

describe('channel_set', () => {
  const target = (events: string[]) => ({ kind: 'params' as const, params: { tournament_id: TID, events } });
  const read = (events: string[]) => fingerprintOf(liveFingerprints, 'channel_set', target(events));

  beforeEach(() => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: TID, season_id: SEASON } as never);
  });

  it('asks for each event of the card with the tournament and its league, and fingerprints row ids only', async () => {
    vi.mocked(previewRecipients).mockImplementation(async ({ eventType }) => (eventType === 'round_generated' ? reach(['w2', 'w1'], ['s1']) : reach(['w1'], [])));
    const state = await liveFingerprints.read('channel_set', target(['tournament_started', 'round_generated']));
    expect(previewRecipients).toHaveBeenCalledWith({ eventType: 'round_generated', tournamentId: TID, seasonId: SEASON });
    expect(previewRecipients).toHaveBeenCalledWith({ eventType: 'tournament_started', tournamentId: TID, seasonId: SEASON });
    expect(state).toEqual({ round_generated: { discord: ['w2', 'w1'], social: ['s1'] }, tournament_started: { discord: ['w1'], social: [] } });
    expect(JSON.stringify(state)).not.toContain('Discord');
  });

  it('changes when a channel is added or removed for one event, and not when the events are listed in another order', async () => {
    vi.mocked(previewRecipients).mockResolvedValue(reach(['w1'], []));
    const before = await read(['round_generated', 'tournament_started']);
    expect(await read(['tournament_started', 'round_generated'])).toBe(before);
    vi.mocked(previewRecipients).mockResolvedValue(reach(['w1', 'w2'], []));
    expect(await read(['round_generated', 'tournament_started'])).not.toBe(before);
    vi.mocked(previewRecipients).mockResolvedValue(reach(['w1'], ['s9']));
    expect(await read(['round_generated', 'tournament_started'])).not.toBe(before);
  });

  it('is null for a tournament that does not exist and empty for no events', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(null);
    expect(await liveFingerprints.read('channel_set', target(['round_generated']))).toBeNull();
    vi.mocked(getTournamentById).mockResolvedValue({ id: TID, season_id: null } as never);
    expect(await liveFingerprints.read('channel_set', target([]))).toEqual({});
  });
});

describe('the tournament roster reads', () => {
  it('tournament_roster_hash is the sorted, lower-cased player ids', async () => {
    vi.mocked(getParticipants).mockResolvedValue([{ id: p(2).toUpperCase() }, { id: p(1) }] as never);
    expect(await liveFingerprints.read('tournament_roster_hash', { kind: 'id', id: TID })).toEqual([p(1), p(2)]);
  });

  it('tournament_members keeps only the named players who are on the tournament, in the state the undo hashes', async () => {
    vi.mocked(getParticipants).mockResolvedValue([{ id: p(1) }, { id: p(2) }] as never);
    const state = await liveFingerprints.read('tournament_members', { kind: 'params', params: { tournament_id: TID, player_ids: [p(2), p(3)] } });
    expect(state).toEqual(rosterMembersState([p(2)]));
    expect(getParticipants).toHaveBeenCalledWith(TID);
  });
});

describe('the source', () => {
  it('startupChecklist builds the checklist of the loaded input, null when there is none', async () => {
    vi.mocked(loadStartupInput).mockResolvedValue(input(1));
    expect(await liveSource.startupChecklist(TID)).toMatchObject({ blocked: true, items: [{ id: 'participants', state: 'blocked' }, { id: 'ruleset', state: 'done' }, { id: 'bestOf', state: 'done' }] });
    vi.mocked(loadStartupInput).mockResolvedValue(null);
    expect(await liveSource.startupChecklist(TID)).toBeNull();
  });

  it('recipients gives counts and masked names, and nothing for a card without a tournament', async () => {
    vi.mocked(previewRecipients).mockResolvedValue(reach(['w1', 'w2'], ['s1']));
    expect(await liveSource.recipients!({ eventType: 'round_generated', tournamentId: TID, seasonId: SEASON })).toEqual({
      discord: { count: 2, names: ['Discord w1', 'Discord w2'] },
      social: { count: 1, names: ['x s1'] },
    });
    expect(await liveSource.recipients!({ eventType: 'round_generated', tournamentId: null, seasonId: null })).toEqual({ discord: { count: 0, names: [] }, social: { count: 0, names: [] } });
  });
});
