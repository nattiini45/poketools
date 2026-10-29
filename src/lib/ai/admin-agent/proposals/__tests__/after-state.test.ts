import { describe, expect, it } from 'vitest';
import { hashJson } from '../../plans/hash';
import { leagueAfterState, tournamentAfterState } from '../after-state';

const SEASON = {
  name: 'Spring OU',
  description: 'Weekly games',
  format_type: 'singles',
  archived: false,
  start_date: '2026-11-01',
  end_date: null,
  ruleset_id: '00000000-0000-4000-8000-000000009001',
  language: 'de',
};

const TOURNAMENT = {
  name: 'Cup',
  description: '',
  season_id: null,
  bracket_type: 'single_elimination',
  ruleset_id: '00000000-0000-4000-8000-000000009001',
  best_of_default: 3,
  archived: false,
  stage_order: 1,
};

const fp = (state: unknown) => hashJson(state as never);

describe('the after-state of a league: what an admin edits, not what happens to it', () => {
  it('does not change when the league starts or plays: status, counters and timestamps are not part of it', () => {
    const before = fp(leagueAfterState(SEASON));
    const played = { ...SEASON, status: 'active', current_round: 4, updated_at: '2026-11-02T10:00:00.000Z', participant_count: 12, tournament_count: 2 };
    expect(fp(leagueAfterState(played))).toBe(before);
    const finished = { ...played, status: 'completed' };
    expect(fp(leagueAfterState(finished))).toBe(before);
    expect(Object.keys(leagueAfterState(played) as object).sort()).toEqual(['archived', 'description', 'end_date', 'format_type', 'language', 'name', 'start_date']);
  });

  it.each([
    ['name', { name: 'Renamed' }],
    ['description', { description: 'Other' }],
    ['format', { format_type: 'doubles' }],
    ['archived', { archived: true }],
    ['start date', { start_date: '2026-12-01' }],
    ['end date', { end_date: '2027-01-01' }],
    ['language', { language: 'en' }],
  ])('changes when an admin edits the %s', (_field, edit) => {
    expect(fp(leagueAfterState({ ...SEASON, ...edit }))).not.toBe(fp(leagueAfterState(SEASON)));
  });

  it('does not change when the pin moves: a pin move has its own undo', () => {
    const movedLeague = { ...SEASON, ruleset_id: '00000000-0000-4000-8000-000000009002' };
    const movedPhase = { ...TOURNAMENT, ruleset_id: '00000000-0000-4000-8000-000000009002' };
    expect(fp(leagueAfterState(movedLeague))).toBe(fp(leagueAfterState(SEASON)));
    expect(fp(tournamentAfterState(movedPhase))).toBe(fp(tournamentAfterState(TOURNAMENT)));
  });

  it('reads a missing language as null, like the stored state', () => {
    const { language: _language, ...without } = SEASON;
    expect(fp(leagueAfterState(without))).toBe(fp(leagueAfterState({ ...SEASON, language: null })));
  });
});

describe('the after-state of a tournament', () => {
  it('does not change when the tournament starts or plays', () => {
    const before = fp(tournamentAfterState(TOURNAMENT));
    const played = { ...TOURNAMENT, status: 'in_progress', current_round: 2, updated_at: '2026-11-02T10:00:00.000Z', participant_count: 8 };
    expect(fp(tournamentAfterState(played))).toBe(before);
    expect(Object.keys(tournamentAfterState(played) as object).sort()).toEqual(['archived', 'best_of_default', 'bracket_type', 'description', 'name', 'season_id', 'stage_order']);
  });

  it.each([
    ['name', { name: 'Renamed' }],
    ['description', { description: 'Other' }],
    ['league', { season_id: '00000000-0000-4000-8000-000000007001' }],
    ['bracket type', { bracket_type: 'round_robin' }],
    ['best of', { best_of_default: 5 }],
    ['archived', { archived: true }],
    ['phase order', { stage_order: 2 }],
  ])('changes when an admin edits the %s', (_field, edit) => {
    expect(fp(tournamentAfterState({ ...TOURNAMENT, ...edit }))).not.toBe(fp(tournamentAfterState(TOURNAMENT)));
  });
});
