/**
 * C2: the shared overlay map builder for the English route themes.
 *
 * `buildThemeOverlayMaps` is the pure core of `ThemeOverlays` — the keying
 * rules (participant ids for `team`, entry ids for `mon`, fixed value sets
 * for `board`/`rules`, and NOTHING for unknown values) are asserted here
 * without a DOM, mirroring the row-factory style of the world contract
 * tests.
 */
import { describe, expect, it } from 'vitest';
import { buildThemeOverlayMaps } from '../ThemeOverlays';
import type { RulesCopyFn, ThemeRouteData } from '../../types';
import type { SeasonParticipant, SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';
import type { PointBuyListEntry } from '@/types/point-buy';
import { lineIdOfEntry } from '@/lib/draft/line-identity';
import type { WorldRosterTile } from '@/lib/worlds/route-data';

const ISO = '2026-09-01T12:00:00.000Z';

function makeLeague(overrides: Partial<SeasonWithDetails> = {}): SeasonWithDetails {
  return {
    id: 'season-1',
    name: 'Sakura Park League',
    description: '',
    format_type: 'evolution_point_buy',
    ruleset_id: 'ruleset-1',
    start_date: null,
    end_date: null,
    status: 'active',
    archived: false,
    legacy: false,
    is_test_season: false,
    core_pool: null,
    point_buy_list_id: 'list-1',
    language: 'de',
    created_at: ISO,
    updated_at: ISO,
    ruleset_name: 'Park Standard',
    participant_count: 2,
    tournament_count: 1,
    ...overrides,
  };
}

function makeStage(overrides: Partial<TournamentWithDetails> = {}): TournamentWithDetails {
  return {
    id: 'stage-1',
    name: 'First Half',
    description: '',
    season_id: 'season-1',
    bracket_type: 'round_robin',
    ruleset_id: 'ruleset-1',
    best_of_default: 3,
    bo_overrides: {},
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    status: 'active',
    current_round: 2,
    stage_order: 0,
    advancement_rule: null,
    enrollment_source: null,
    archived: false,
    legacy: false,
    created_at: ISO,
    updated_at: ISO,
    ruleset_name: 'Park Standard',
    season_name: 'Sakura Park League',
    participant_count: 2,
    ...overrides,
  };
}

function makeParticipant(overrides: Partial<SeasonParticipant> = {}): SeasonParticipant {
  return {
    id: 'player-1',
    name: 'Mara Feldkamp',
    discord_id: null,
    auth_user_id: null,
    ps_username: 'mara',
    champions_username: '',
    is_admin: false,
    is_creator: false,
    is_guest: false,
    is_test_account: false,
    joined_date: ISO,
    avatar_url: null,
    avatar_config: null,
    status: 'active',
    suspended_until: null,
    ban_reason: null,
    created_at: ISO,
    updated_at: ISO,
    gym_type: 'Fire',
    core_types: null,
    core_assigned_at: null,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<PointBuyListEntry> = {}): PointBuyListEntry {
  const entry: Omit<PointBuyListEntry, 'line_id'> & { line_id?: string } = {
    id: 'line-1',
    list_version_id: 'list-1',
    line_number: 1,
    base_pokemon: 'Charmander',
    stage2_pokemon: 'Charmeleon',
    stage3_pokemon: 'Charizard',
    price: 27,
    kills_to_stage2: 3,
    additional_kills_to_stage3: 4,
    price_group: 'premium',
    early_rating: 4,
    mid_rating: 3,
    late_rating: 5,
    rationale: null,
    historical_data: null,
    special_rules: null,
    special_rules_text: null,
    sources: null,
    legacy_tier: null,
    species_ids: null,
    ...overrides,
  };
  return { ...entry, line_id: lineIdOfEntry(entry) };
}

function makeTile(overrides: Partial<WorldRosterTile> = {}): WorldRosterTile {
  return {
    id: 'line-1',
    line: 1,
    name: 'Charmander',
    band: 'premium',
    price: 27,
    ...overrides,
  };
}

/** The themes' own painter shape, stubbed — the rows are asserted in paint tests. */
const rulesCopy: RulesCopyFn = (_formatRules, rulesetName) => ({
  rulesetName: rulesetName ?? 'League Standard',
  rows: [['Draft budget', '180 pts']],
  note: null,
});

function makeData(overrides: Partial<ThemeRouteData> = {}): ThemeRouteData {
  return {
    league: makeLeague(),
    stages: [makeStage()],
    participants: [makeParticipant()],
    entries: [makeEntry()],
    rosterTiles: [makeTile()],
    trackers: [],
    teamAces: {},
    standings: [],
    fixtures: [],
    formatRules: null,
    rulesetName: 'Park Standard',
    hasDraftPool: false,
    ...overrides,
  };
}

describe('buildThemeOverlayMaps', () => {
  it('keys the team map by participant id and covers every participant', () => {
    const participants = [
      makeParticipant(),
      makeParticipant({ id: 'player-2', name: 'Toby Warren', gym_type: 'Water' }),
    ];
    const maps = buildThemeOverlayMaps(makeData({ participants }), rulesCopy);

    expect(Object.keys(maps.team.contents)).toEqual(['player-1', 'player-2']);
    expect(Object.keys(maps.team.titles)).toEqual(['player-1', 'player-2']);
    expect(maps.team.titles['player-1']).toBe('Team: Mara Feldkamp');
    expect(maps.team.titles['player-2']).toBe('Team: Toby Warren');
    for (const participant of participants) {
      expect(maps.team.contents[participant.id]).toBeDefined();
    }
  });

  it('leaves the mon map empty when the league has no point-buy entries', () => {
    const maps = buildThemeOverlayMaps(makeData({ entries: [], rosterTiles: [] }), rulesCopy);

    expect(maps.mon.contents).toEqual({});
    expect(maps.mon.titles).toEqual({});
  });

  it('keys the mon map by entry id when entries exist', () => {
    const entries = [makeEntry(), makeEntry({ id: 'line-2', base_pokemon: 'Sewaddle', line_number: 2 })];
    const maps = buildThemeOverlayMaps(makeData({ entries }), rulesCopy);

    expect(Object.keys(maps.mon.contents)).toEqual(['line-1', 'line-2']);
    expect(maps.mon.titles['line-1']).toBe('Line: Charmander');
    expect(maps.mon.titles['line-2']).toBe('Line: Sewaddle');
  });

  it('renders nothing for unknown param values — no fallback panels', () => {
    const maps = buildThemeOverlayMaps(makeData(), rulesCopy);

    expect('does-not-exist' in maps.team.contents).toBe(false);
    expect('does-not-exist' in maps.mon.contents).toBe(false);
    expect('does-not-exist' in maps.board.contents).toBe(false);
    expect('does-not-exist' in maps.rules.contents).toBe(false);
    // Params never cross-map: a participant id is not a line id and vice versa.
    expect('player-1' in maps.mon.contents).toBe(false);
    expect('line-1' in maps.team.contents).toBe(false);
    // Plaza values the English themes do not mount stay unanswerable.
    expect('left' in maps.rules.contents).toBe(false);
    expect('right' in maps.rules.contents).toBe(false);
  });

  it('answers exactly the declared board and rules values', () => {
    const maps = buildThemeOverlayMaps(makeData(), rulesCopy);

    // Wave 2 (2D): `roster` rides the board param — the full roster list.
    expect(Object.keys(maps.board.contents)).toEqual(['pulse', 'schedule', 'roster']);
    expect(maps.board.titles.pulse).toBe('Standings');
    expect(maps.board.titles.roster).toBe('Point-Buy list — every line');
    expect(maps.board.titles.schedule).toBe('Schedule — First Half, Matchday 2');
    expect(Object.keys(maps.rules.contents)).toEqual(['gate']);
    expect(maps.rules.titles.gate).toBe('Rulebook');
  });

  it('titles every panel in the viewer’s language, Pokémon names from the pkmn layer (i18n D11)', () => {
    const entries = [makeEntry()];
    const maps = buildThemeOverlayMaps(makeData({ entries }), rulesCopy, { locale: 'de' });

    expect(maps.team.titles['player-1']).toBe('Team: Mara Feldkamp');
    expect(maps.mon.titles['line-1']).toBe('Linie: Glumanda');
    expect(maps.board.titles.pulse).toBe('Tabelle');
    expect(maps.board.titles.roster).toBe('Point-Buy-Liste – alle Linien');
    expect(maps.board.titles.schedule).toBe('Spielplan – First Half, Spieltag 2');
    expect(maps.rules.titles.gate).toBe('Regelwerk');
    // A viewer who keeps Pokémon terms in English keeps the species name.
    const english = buildThemeOverlayMaps(makeData({ entries }), rulesCopy, { locale: 'de', dataLocale: 'en' });
    expect(english.mon.titles['line-1']).toBe('Linie: Charmander');
  });
});
