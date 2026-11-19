import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicMatchesByPhaseIds } from '../phase-matches';
import { listSeasonPhaseTeamLeadsWithFacts } from '../phase-teams';
import { callsOf, mock, resetQueryMock } from './query-mock';

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./query-mock')).mock.supabase }));

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const phaseId = uuid(1);
const seasonId = uuid(2);
const time = '2026-08-01T00:00:00Z';
const game = {
  id: uuid(9), game_number: 1, winner_id: uuid(6),
  replay_url: 'https://example.test/replay', source: 'ps_replay', stats_locked: true,
};
const match = {
  id: uuid(3), phase_id: phaseId, round_id: uuid(4), player_1_id: uuid(5), player_2_id: uuid(6),
  winner_id: uuid(6), status: 'completed', date_played: time, scheduled_at: time, social_image_url: null,
  bracket_side: 'losers', bracket_pos: 1, created_at: time, updated_at: time,
};
const matchRow = {
  ...match,
  player_1: { name: 'Moth', avatar_url: null, discord_id: 'private' },
  player_2: { name: 'Wisp', avatar_url: 'https://example.test/avatar' },
  winner: { name: 'Wisp' },
  round: { status: 'completed', round_number: 4 },
  games: [{ ...game, id: uuid(10), game_number: 2, stats_locked: null, replay_hash: 'private' }, game],
  notes: 'private', submitter_id: uuid(7), auto_confirm_at: time, confirmed_at: time, finalized_at: time,
  tournament_id: uuid(8),
};

beforeEach(resetQueryMock);

describe('getPublicMatchesByPhaseIds', () => {
  it('does not read an empty batch or any part of an invalid batch', async () => {
    expect(await getPublicMatchesByPhaseIds([])).toEqual(new Map());
    await expect(getPublicMatchesByPhaseIds([phaseId, 'invalid'])).rejects.toThrow('Invalid phaseId');
    expect(mock.state.queries).toEqual([]);
  });

  it('gets 50 distinct phases in one cold read and returns only public match, round and game facts', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => uuid(i + 1));
    mock.state.results.push({ data: [matchRow] });

    const result = await getPublicMatchesByPhaseIds([...ids, phaseId]);

    expect([...result.keys()]).toEqual(ids);
    expect(result.get(ids[1])).toEqual([]);
    expect(result.get(phaseId)).toEqual([{
      ...match,
      player_1_name: 'Moth', player_1_avatar_url: null,
      player_2_name: 'Wisp', player_2_avatar_url: 'https://example.test/avatar',
      winner_name: 'Wisp', round_status: 'completed', round_number: 4,
      games: [game, { ...game, id: uuid(10), game_number: 2, stats_locked: false }],
    }]);
    expect(mock.state.queries.map(q => q.table)).toEqual(['phase_matches']);
    const calls = callsOf(0);
    expect(calls.in).toEqual(['phase_id', ids]);
    expect(calls.range).toEqual([0, 999]);
    expect(String(calls.select[0]).replace(/\s/g, '')).toBe(
      'id,phase_id,round_id,player_1_id,player_2_id,winner_id,status,date_played,scheduled_at,social_image_url,bracket_side,bracket_pos,created_at,updated_at,' +
      'player_1:players!phase_matches_player_1_id_fkey(name,avatar_url),player_2:players!phase_matches_player_2_id_fkey(name,avatar_url),' +
      'winner:players!phase_matches_winner_id_fkey(name),games:phase_games(id,game_number,winner_id,replay_url,source,stats_locked),' +
      'round:phase_rounds!phase_matches_phase_round_fkey(status,round_number)',
    );
  });

  it('uses stable 1,000-row pages and chunks more than 50 IDs', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => uuid(i + 1));
    const rows = Array.from({ length: 1001 }, (_, i) => ({ ...matchRow, id: uuid(i + 100) }));
    mock.state.results.push({ data: rows.slice(0, 1000) }, { data: rows.slice(1000) }, { data: [] });

    const result = await getPublicMatchesByPhaseIds(ids);

    expect(result.get(phaseId)?.map(row => row.id)).toEqual(rows.map(row => row.id));
    expect(mock.state.queries.map((_, i) => callsOf(i).range)).toEqual([[0, 999], [1000, 1999], [0, 999]]);
    expect(callsOf(2).in).toEqual(['phase_id', ids.slice(50)]);
    for (const query of mock.state.queries) {
      expect(query.calls.filter(([method]) => method === 'order').map(([, [column]]) => column)).toEqual(['created_at', 'id']);
    }
  });

  it('groups a valid uppercase UUID under the requested key', async () => {
    const canonical = uuid(0xff);
    const upper = canonical.toUpperCase();
    mock.state.results.push({ data: [{ ...matchRow, phase_id: canonical, winner: null, round: null, games: [] }] });

    const result = await getPublicMatchesByPhaseIds([upper, canonical]);

    expect(callsOf(0).in).toEqual(['phase_id', [canonical]]);
    expect(result.get(upper)).toBe(result.get(canonical));
    expect(result.get(upper)?.[0]).toMatchObject({ winner_name: null, round_status: 'pending', games: [] });
    expect(result.get(upper)?.[0]).not.toHaveProperty('round_number');
  });
});

describe('listSeasonPhaseTeamLeadsWithFacts', () => {
  it('uses actual phase ownership instead of nullable team season_id and returns only lead/fact slices', async () => {
    const lead = { id: uuid(11), player_id: uuid(6), updated_at: time, lead_species: 'Mimikyu' };
    const unplayed = { id: uuid(12), player_id: uuid(5), updated_at: time, lead_species: null };
    mock.state.results.push({ data: [
      { ...lead, season_id: null, match: { status: 'completed', notes: 'private' }, phase: { team_visibility: 'hidden_until_match' },
        pokemon: [{ species: 'Mimikyu', moves: ['Shadow Sneak'] }], share_token: uuid(13), share_enabled_at: time },
      { ...unplayed, lead_species: { malformed: true }, match: null, phase: { team_visibility: 'always_public' } },
    ] });

    expect(await listSeasonPhaseTeamLeadsWithFacts(seasonId)).toEqual([
      { ...lead, facts: { match_status: 'completed', tournament_visibility: 'hidden_until_match' } },
      { ...unplayed, facts: { match_status: null, tournament_visibility: 'always_public' } },
    ]);
    expect(mock.state.queries.map(q => q.table)).toEqual(['phase_teams']);
    const calls = callsOf(0);
    expect(calls.eq).toEqual(['phase.season_id', seasonId]);
    expect(calls.range).toEqual([0, 999]);
    expect(String(calls.select[0]).replace(/\s/g, '')).toBe(
      'id,player_id,updated_at,lead_species:pokemon->0->>species,' +
      'match:phase_matches!phase_teams_phase_match_fkey(status),phase:league_phases!phase_teams_phase_id_fkey!inner(team_visibility)',
    );
  });

  it('returns an empty league in one read and propagates read errors', async () => {
    mock.state.results.push({ data: [] });
    expect(await listSeasonPhaseTeamLeadsWithFacts(seasonId)).toEqual([]);
    expect(mock.state.queries).toHaveLength(1);

    const error = new Error('phase lead read failed');
    mock.state.results.push({ error });
    await expect(listSeasonPhaseTeamLeadsWithFacts(seasonId)).rejects.toBe(error);
  });

  it('keeps the same season and stable ordering across pages', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      id: uuid(i + 100), player_id: uuid(6), updated_at: time, lead_species: null, match: null,
      phase: { team_visibility: 'hidden_until_match' },
    }));
    mock.state.results.push({ data: rows.slice(0, 1000) }, { data: rows.slice(1000) });

    const result = await listSeasonPhaseTeamLeadsWithFacts(seasonId);

    expect(result.map(lead => lead.id)).toEqual(rows.map(row => row.id));
    expect(mock.state.queries.map((_, i) => callsOf(i).range)).toEqual([[0, 999], [1000, 1999]]);
    for (const query of mock.state.queries) {
      expect(query.calls).toContainEqual(['eq', ['phase.season_id', seasonId]]);
      expect(query.calls.filter(([method]) => method === 'order').map(([, [column]]) => column)).toEqual(['created_at', 'id']);
    }
  });
});
