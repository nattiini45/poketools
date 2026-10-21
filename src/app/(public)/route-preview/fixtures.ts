import { assembleWorldRouteData, teamToLead } from '@/lib/worlds/route-data';
import type { WorldRouteData } from '@/lib/worlds/route-data';
import { resolveWorld } from '@/lib/worlds/registry';
import type { SeasonWorld } from '@/lib/worlds/types';
import type { EvoligaWorldData } from '@/components/world/evoliga/types';
import type { SeasonParticipant, SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';
import type { PointBuyListEntry, PriceGroup } from '@/types/point-buy';
import { toLineId } from '@/lib/draft/line-identity';
import { epbLineRuleForBase, epbPack, storedSpecialRulesForBase } from '@/lib/format-pack';
import type { EvolutionTracker } from '@/types/evolution';
import type { FormatRules } from '@/types/format-rules';
import type { MatchStatus } from '@/types/match';
import type { Standing } from '@/lib/tournament/types';
import type { LeagueFixture, LeagueStanding } from '@/lib/supabase/queries/league-standings';
import type { Team, PokemonSet } from '@/types/team';
import exampleLines from '../draft-preview/fixture-lines.example.json';

/**
 * Deterministic fixture data for the dev-only route-world preview.
 *
 * Colocated with `/route-preview`, its only consumer, so it can never be
 * mistaken for production data. Everything is derived from a seed rather than
 * randomized: the preview has to render identically on every reload or it is
 * useless for comparing a camera endpoint against the one from five minutes
 * ago.
 *
 * The roster is the public example pack's synthetic line list, so a public
 * checkout carries no league pool. Lines without a world model fall back to
 * billboards, the same decision the real league's roster goes through.
 *
 * League tuning (price groups, special-rule flags, the participation line,
 * format defaults) comes from the active format pack, never from literals.
 */

const ISO = '2026-08-01T12:00:00.000Z';

/**
 * The preview roster: base → stage 2 → stage 3, one row per drafted line. Derived from the public
 * example pack's synthetic list (`../draft-preview/fixture-lines.example.json`, written by
 * `scripts/draft/make-example-list-fixtures.ts`), never from a league's pool.
 */
const LINES: readonly (readonly [string, string, string | null])[] = exampleLines.map(
  (line) => [line.base_pokemon, line.stage2_pokemon, line.stage3_pokemon ?? null] as const,
);

const TRAINERS: readonly (readonly [string, string])[] = [
  ['Mara Feldkamp', 'Fire'],
  ['Jonas Riedl', 'Water'],
  ['Selin Ayvaz', 'Grass'],
  ['Tobias Wenger', 'Electric'],
  ['Nele Brandt', 'Psychic'],
  ['Kaan Özdemir', 'Dark'],
  ['Lea Hofstetter', 'Fairy'],
  ['Vincent Krause', 'Steel'],
];

const PRICE_GROUPS_BY_BAND: readonly { group: PriceGroup; min: number; max: number }[] = epbPack.priceGroupOrder.map(
  (group) => ({ group, min: epbPack.priceGroups[group][0], max: epbPack.priceGroups[group][1] }),
);

/** Whether a base is the pack's participation line (earns participation tokens, not kills). */
function isParticipationBase(base: string): boolean {
  return !!epbLineRuleForBase(base)?.participationPoints;
}

/** Stable pseudo-random in [0,1) from an integer seed — no Math.random. */
function seeded(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function id(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

function buildEntries(): PointBuyListEntry[] {
  return LINES.map(([base, stage2, stage3], i) => {
    const band = PRICE_GROUPS_BY_BAND[i % PRICE_GROUPS_BY_BAND.length];
    const span = band.max - band.min;
    return {
      id: id('line', i + 1),
      list_version_id: 'preview-list',
      line_id: toLineId(base, stage3 ?? stage2),
      line_number: i + 1,
      base_pokemon: base,
      stage2_pokemon: stage2,
      stage3_pokemon: stage3,
      price: band.min + Math.floor(seeded(i + 1) * (span + 1)),
      kills_to_stage2: 2 + Math.floor(seeded(i + 41) * 4),
      additional_kills_to_stage3: stage3 ? 3 + Math.floor(seeded(i + 97) * 5) : null,
      price_group: band.group,
      early_rating: 1 + Math.floor(seeded(i + 11) * 5),
      mid_rating: 1 + Math.floor(seeded(i + 23) * 5),
      late_rating: 1 + Math.floor(seeded(i + 37) * 5),
      rationale: null,
      historical_data: null,
      special_rules: storedSpecialRulesForBase(base),
      special_rules_text: null,
      sources: null,
      legacy_tier: null,
      species_ids: null,
    };
  });
}

function buildParticipants(trainers: readonly (readonly [string, string])[] = TRAINERS): SeasonParticipant[] {
  return trainers.map(([name, gymType], i) => ({
    id: id('player', i + 1),
    name,
    discord_id: null,
    auth_user_id: null,
    ps_username: name.split(' ')[0].toLowerCase(),
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
    gym_type: gymType,
    core_types: null,
    core_assigned_at: null,
  }));
}

/**
 * Picks per trainer. The baseline drafts part of the example roster; the `'large'` scenario
 * raises the count so the whole roster is drafted (6 × 8 trainers covers all 48 example lines).
 */
const BASELINE_PICKS = 5;
const LARGE_PICKS = 6;

/** Lines per trainer, dealt round-robin so no two share a line. */
function buildTrackers(
  entries: PointBuyListEntry[],
  trainers: readonly (readonly [string, string])[] = TRAINERS,
  picksPerTrainer: number = BASELINE_PICKS,
): EvolutionTracker[] {
  const trackers: EvolutionTracker[] = [];

  trainers.forEach(([, ], playerIndex) => {
    for (let pick = 0; pick < picksPerTrainer; pick += 1) {
      const entryIndex = pick * trainers.length + playerIndex;
      const entry = entries[entryIndex];
      if (!entry) continue;

      const roll = seeded(entryIndex + 501);
      const stage = roll > 0.78 ? 3 : roll > 0.42 ? 2 : 1;
      const form =
        stage === 3 ? (entry.stage3_pokemon ?? entry.stage2_pokemon)
        : stage === 2 ? entry.stage2_pokemon
        : entry.base_pokemon;

      trackers.push({
        id: id('tracker', trackers.length + 1),
        season_id: 'preview-season',
        player_id: id('player', playerIndex + 1),
        base_pokemon: entry.base_pokemon,
        line_id: entry.line_id,
        transferred_evo_progress: 0,
        redraft_slot_id: null,
        current_form: form,
        total_kos: Math.floor(seeded(entryIndex + 7) * 14),
        current_stage: stage,
        evolved_at: stage > 1 ? ISO : null,
        created_at: ISO,
        updated_at: ISO,
        real_kills: Math.floor(seeded(entryIndex + 13) * 10),
        draft_tokens: Math.floor(seeded(entryIndex + 29) * 2),
        kill_tokens: Math.floor(seeded(entryIndex + 53) * 2),
        // Three matchdays brought.
        cosmo_points: isParticipationBase(entry.base_pokemon) ? 3 * epbPack.participationPoints.perMatchday : 0,
        suspended_until_matchday: null,
        evolution_points_awarded: stage - 1,
        locked_stage3_pokemon: null,
      });
    }
  });

  return trackers;
}

function buildStages(): TournamentWithDetails[] {
  return [
    { name: 'Hinrunde', order: 0, status: 'completed' as const },
    { name: 'Rückrunde', order: 1, status: 'active' as const },
  ].map((stage, i) => ({
    id: id('stage', i + 1),
    name: stage.name,
    description: '',
    season_id: 'preview-season',
    bracket_type: 'round_robin',
    ruleset_id: 'preview-ruleset',
    best_of_default: 3,
    bo_overrides: {},
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    status: stage.status,
    current_round: stage.status === 'active' ? 2 : 7,
    stage_order: stage.order,
    advancement_rule: null,
    enrollment_source: null,
    archived: false,
    legacy: false,
    created_at: ISO,
    updated_at: ISO,
    ruleset_name: 'EvoLiga Standard',
    season_name: 'EvoLiga Saison 3',
    participant_count: TRAINERS.length,
  }));
}

/**
 * Deterministic kickoff: 2026-08-10T18:00Z, one week per matchday, one month
 * per stage. `Date.UTC` rolls overflowing days into the next month, so the
 * doubled `'large'` matchdays stay valid ISO dates; for the baseline's three
 * matchdays the output is byte-identical to the old string template.
 */
function kickoffIso(stageIndex: number, matchday: number): string {
  return new Date(Date.UTC(2026, 7 + stageIndex, 10 + matchday * 7, 18)).toISOString();
}

/**
 * Round-robin fixtures per stage. `matchdaysPerPair` defaults to 3 — the
 * baseline cadence; the `'large'` scenario passes 6 to roughly double the
 * matchdays. Status shape is unchanged: stage 0 and every stage-1 matchday 0
 * are completed, one stage-1 fixture is live, the rest are scheduled.
 */
function buildFixtures(
  stages: TournamentWithDetails[],
  trainers: readonly (readonly [string, string])[] = TRAINERS,
  matchdaysPerPair: number = 3,
): LeagueFixture[] {
  const fixtures: LeagueFixture[] = [];
  let n = 0;

  stages.forEach((stage, stageIndex) => {
    for (let pair = 0; pair < trainers.length / 2; pair += 1) {
      for (let matchday = 0; matchday < matchdaysPerPair; matchday += 1) {
        n += 1;
        const p1 = pair * 2;
        const p2 = (pair * 2 + 1 + matchday) % trainers.length;
        if (p1 === p2) continue;

        const done = stageIndex === 0 || matchday === 0;
        const live = stageIndex === 1 && pair === 0 && matchday === 1;
        const status: MatchStatus = done ? 'completed' : live ? 'in_progress' : 'scheduled';
        const p1Wins = seeded(n + 211) > 0.5;

        fixtures.push({
          stageId: stage.id,
          stageName: stage.name,
          match: {
            id: id('match', n),
            round_id: id('round', stageIndex * 10 + matchday + 1),
            tournament_id: stage.id,
            player_1_id: id('player', p1 + 1),
            player_2_id: id('player', p2 + 1),
            winner_id: done ? id('player', (p1Wins ? p1 : p2) + 1) : null,
            status,
            date_played: done ? ISO : null,
            scheduled_at: kickoffIso(stageIndex, matchday),
            social_image_url: null,
            bracket_side: null,
            bracket_pos: null,
            created_at: ISO,
            updated_at: ISO,
            player_1_name: trainers[p1][0],
            player_2_name: trainers[p2][0],
            player_1_avatar_url: null,
            player_2_avatar_url: null,
            winner_name: done ? trainers[p1Wins ? p1 : p2][0] : null,
            round_status: done ? 'completed' : 'active',
            games: done
              ? [0, 1, 2].slice(0, p1Wins ? 2 : 3).map((g) => ({
                  id: id('game', n * 10 + g),
                  game_number: g + 1,
                  // Bo3 consistency: the match winner takes the series — a
                  // 2-game series is a clean sweep (both games), a 3-game
                  // series drops only the middle game to the loser (2-1).
                  // The old alternating deal recorded the sweep as 1-1
                  // against its own winner_id.
                  winner_id: id('player', (p1Wins ? p1 : g === 1 ? p1 : p2) + 1),
                  replay_url: '',
                  source: 'manual' as const,
                  stats_locked: false,
                }))
              : [],
          },
        });
      }
    }
  });

  return fixtures;
}

/** Wins/points tally over a fixture subset — the preview's own table math. */
function tallyStandings(
  fixtures: LeagueFixture[],
  trainers: readonly (readonly [string, string])[] = TRAINERS,
): Standing[] {
  return trainers.map(([name, gymType], i) => {
    const playerId = id('player', i + 1);
    const played = fixtures.filter(
      (f) =>
        f.match.status === 'completed' &&
        (f.match.player_1_id === playerId || f.match.player_2_id === playerId),
    );
    const wins = played.filter((f) => f.match.winner_id === playerId).length;
    const losses = played.length - wins;

    return {
      player_id: playerId,
      player_name: name,
      player_avatar_url: null,
      gym_type: gymType,
      wins,
      losses,
      draws: 0,
      points: wins * 3,
      buchholz: 0,
      games_played: played.length * 3,
      kill_differential: Math.round((seeded(i + 307) - 0.5) * 20),
      eliminated: false,
    };
  }).sort((a, b) => b.points - a.points || b.kill_differential - a.kill_differential);
}

/** When a fixture counts for matchday ordering: kickoff, else played, else updated. */
function playedAt(fixture: LeagueFixture): string {
  const { match } = fixture;
  return match.scheduled_at ?? match.date_played ?? match.updated_at;
}

/** A round's earliest kickoff — orders the rounds the season was played in. */
function earliestKickoff(group: LeagueFixture[]): string {
  return group.reduce(
    (min, f) => (playedAt(f).localeCompare(min) < 0 ? playedAt(f) : min),
    playedAt(group[0]),
  );
}

/** Completed fixtures grouped by round, ordered by each round's earliest kickoff. */
function completedRounds(fixtures: LeagueFixture[]): LeagueFixture[][] {
  const byRound = new Map<string, LeagueFixture[]>();
  for (const fixture of fixtures) {
    if (fixture.match.status !== 'completed') continue;
    const group = byRound.get(fixture.match.round_id);
    if (group) group.push(fixture);
    else byRound.set(fixture.match.round_id, [fixture]);
  }
  return [...byRound.values()].sort((a, b) => earliestKickoff(a).localeCompare(earliestKickoff(b)));
}

/**
 * Standings with deterministic rank movement: the table is compared against the
 * same tally over every completed matchday except the latest one with results,
 * so the Tabelle's `↑↓` column renders without a database. Mirrors the
 * server-side derivation in `league-standings.ts` (matchdays = rounds, ordered
 * by earliest kickoff). No earlier results (first matchday) → null movement.
 */
function buildStandings(
  fixtures: LeagueFixture[],
  trainers: readonly (readonly [string, string])[] = TRAINERS,
): LeagueStanding[] {
  const rounds = completedRounds(fixtures);
  const current = tallyStandings(fixtures, trainers);
  const previous =
    rounds.length > 1 ? tallyStandings(rounds.slice(0, -1).flat(), trainers) : null;
  const previousRank = new Map((previous ?? []).map((row, i) => [row.player_id, i + 1] as const));

  return current.map((row, i) => {
    const before = previousRank.get(row.player_id);
    return { ...row, rank_change: before === undefined ? null : before - (i + 1) };
  });
}

const FORMAT_RULES: FormatRules = {
  id: 'preview-format-rules',
  season_id: 'preview-season',
  banned_moves: [...epbPack.defaults.bannedMoves],
  banned_items: [...epbPack.defaults.bannedItems],
  // The pack's Tera rules; `TeraRules` still types the stored defaults literally (widened with the pack).
  tera_rules: { ...epbPack.teraByStage },
  tiebreaker_order: [...epbPack.tiebreakerChain],
  draft_budget: epbPack.defaults.draftBudget,
  draft_picks: epbPack.defaults.draftPicks,
  draft_token_ratio: epbPack.defaults.tokenRatio,
  draft_token_max: epbPack.defaults.tokenMax,
  draft_token_max_per_line: epbPack.defaults.tokenMaxPerLine,
  redraft_phase_open: false,
  created_at: ISO,
};

const LEAGUE: SeasonWithDetails = {
  id: 'preview-season',
  name: 'EvoLiga Saison 3 (Vorschau)',
  description: 'Deterministische Vorschaudaten für die Route-World-Inspektion.',
  language: 'de',
  format_type: 'evolution_point_buy',
  ruleset_id: 'preview-ruleset',
  start_date: '2026-08-01',
  end_date: '2026-12-15',
  status: 'active',
  archived: false,
  legacy: false,
  is_test_season: true,
  core_pool: null,
  point_buy_list_id: 'preview-list',
  created_at: ISO,
  updated_at: ISO,
  ruleset_name: 'EvoLiga Standard',
  participant_count: TRAINERS.length,
  tournament_count: 2,
};

/**
 * The preview payload: the generic contract's view of the deterministic rows,
 * narrowed to what `EvoligaWorld` renders (world included, `standings` rows
 * carrying rank movement exactly like the real query's `LeagueStanding`), so
 * the board's `↑↓` column renders DB-free and the preview exercises the same
 * assembly the server helper produces.
 */
export type PreviewWorldData = Omit<EvoligaWorldData, 'standings'> & {
  standings: LeagueStanding[];
};

/**
 * Assemble the full world payload. Deterministic across calls. The rows are
 * shaped through `assembleWorldRouteData` — the pure core of
 * `buildWorldRouteData` — and then mapped onto the evoliga view exactly like
 * the adapter (`toEvoligaRouteData`), inlined here because that adapter lives
 * in a client module and this fixture runs server-side. Every field is a
 * pass-through of the contract, so the painted preview is unchanged.
 */
/**
 * The generic contract payload of the default (plaza) preview — the same
 * deterministic rows, unassembled. `buildPreviewWorld` flattens this into
 * the evoliga view; the route-preview page hands THIS to `EvoligaWorld`
 * (which consumes the contract since C-093), so the painted default
 * preview keeps its exact pre-contract shape.
 */
export function buildPreviewRoute(): WorldRouteData {
  const entries = buildEntries();
  const stages = buildStages();
  const fixtures = buildFixtures(stages);
  return assembleWorldRouteData({
    league: LEAGUE,
    stages,
    participants: buildParticipants(),
    rosterLines: entries,
    trackers: buildTrackers(entries),
    standings: buildStandings(fixtures),
    fixtures,
    formatRules: FORMAT_RULES,
    hasDraftPool: true,
  });
}

export function buildPreviewWorld(): PreviewWorldData {
  const route = buildPreviewRoute();

  return {
    world: route.world,
    league: LEAGUE,
    stages: route.stages,
    participants: route.participants,
    entries: route.rosterLines ?? [],
    trackers: route.trackers,
    standings: route.standings,
    fixtures: route.fixtures,
    formatRules: route.formatRules,
    hasDraftPool: route.hasDraftPool,
  };
}

// ── Scenario axis (C4) ────────────────────────────────────────────────

/**
 * Named data scenarios, orthogonal to the epb/open format variant. Each one
 * reshapes the SAME deterministic rows so every theme can be inspected in a
 * given league life-cycle state without touching a database:
 *
 *  - `'populated'` — today's baseline season, mid-play (unchanged).
 *  - `'empty'` — brand-new league: no fixtures at all, empty standings and
 *    results; stages, participants and (per variant) roster/trackers remain.
 *  - `'disputed'` — baseline, but the most recent match is `'disputed'`.
 *  - `'archive'` — finished season: every fixture completed with a
 *    `date_played`, every stage `'completed'`, no live match.
 *  - `'long-names'` — trainer display names replaced with very long ones
 *    (fit/wrap/ellipsis stress); participant and fixture ids stay stable.
 *  - `'large'` — full roster drafted and roughly double the matchdays.
 *  - `'defaults'` — baseline data with `formatRules: null` (league defaults).
 */
export type PreviewScenario =
  | 'populated'
  | 'empty'
  | 'disputed'
  | 'archive'
  | 'long-names'
  | 'large'
  | 'defaults';

/** Every scenario name — `/route-preview` validates `?scenario=` against this. */
export const PREVIEW_SCENARIOS: readonly PreviewScenario[] = [
  'populated',
  'empty',
  'disputed',
  'archive',
  'long-names',
  'large',
  'defaults',
];

/** Type guard for query-param values; unknown strings fall back to 'populated'. */
export function isPreviewScenario(value: string | undefined): value is PreviewScenario {
  return value !== undefined && (PREVIEW_SCENARIOS as readonly string[]).includes(value);
}

/** Display-name stress set for the `'long-names'` scenario. */
const LONG_TRAINER_NAMES: readonly string[] = [
  'Maximiliana Featherstonehaugh-Vane',
  'Bartholomew Quillsworth-Ashgrove III',
  'Constantina Winterbourne-Hackett',
  'Reginald Ashford Pemberton-Wright',
  'Wilhelmina Thornycroft-Blackwood',
  'Ferdinand Castellan Hargreaves IV',
  'Seraphina Nightingale-Carrington',
  'Alistair Montgomery Foxwhistle',
  'Guinevere Ravensworth-Pemberton',
];

/** Swap display names for the long stress set; ids, order and gyms stay stable. */
function withLongNames(
  trainers: readonly (readonly [string, string])[],
): readonly (readonly [string, string])[] {
  return trainers.map(
    ([, gymType], i): readonly [string, string] => [
      LONG_TRAINER_NAMES[i % LONG_TRAINER_NAMES.length],
      gymType,
    ],
  );
}

/**
 * Flip the most recently played match to `'disputed'`, immutably. Candidates
 * are the finished-or-finishing fixtures (`'completed'` / `'in_progress'`);
 * in the baseline the latest one by `date_played ?? scheduled_at` is the live
 * match — it ends under dispute, so no live fixture remains and the boards
 * show the contested result instead of a live pill.
 */
function applyDisputed(fixtures: LeagueFixture[]): LeagueFixture[] {
  let targetId: string | null = null;
  let targetAt = '';
  for (const fixture of fixtures) {
    const { match } = fixture;
    if (match.status !== 'completed' && match.status !== 'in_progress') continue;
    const at = match.date_played ?? match.scheduled_at ?? match.updated_at;
    if (targetId === null || at.localeCompare(targetAt) >= 0) {
      targetId = match.id;
      targetAt = at;
    }
  }
  if (targetId === null) return fixtures;
  return fixtures.map((fixture) =>
    fixture.match.id === targetId
      ? {
          ...fixture,
          match: {
            ...fixture.match,
            status: 'disputed' as const,
            date_played: fixture.match.date_played ?? fixture.match.scheduled_at,
          },
        }
      : fixture,
  );
}

/** Every stage closed out — the `'archive'` scenario's stage side. */
function archiveStages(stages: TournamentWithDetails[]): TournamentWithDetails[] {
  return stages.map((stage) => ({ ...stage, status: 'completed' as const, current_round: 7 }));
}

/**
 * Complete every fixture for the `'archive'` scenario: `date_played` derived
 * from the existing kickoff, and previously unplayed matches get the same
 * deterministic winner/games `buildFixtures` would have dealt them (same
 * `seeded(n + 211)` roll, keyed off the match number).
 */
function archiveFixtures(fixtures: LeagueFixture[]): LeagueFixture[] {
  return fixtures.map((fixture) => {
    const { match } = fixture;
    const played = match.date_played ?? match.scheduled_at ?? ISO;
    if (match.status === 'completed' && match.winner_id !== null) {
      return { ...fixture, match: { ...match, date_played: played } };
    }
    const matchNumber = Number(match.id.slice('match-'.length));
    const p1Wins = seeded(matchNumber + 211) > 0.5;
    const winnerId = p1Wins ? match.player_1_id : match.player_2_id;
    const loserId = p1Wins ? match.player_2_id : match.player_1_id;
    return {
      ...fixture,
      match: {
        ...match,
        status: 'completed' as const,
        winner_id: winnerId,
        winner_name: p1Wins ? match.player_1_name : match.player_2_name,
        date_played: played,
        round_status: 'completed' as const,
        games: [0, 1, 2].slice(0, p1Wins ? 2 : 3).map((g) => ({
          id: id('game', matchNumber * 10 + g),
          game_number: g + 1,
          // Same Bo3 consistency as `buildFixtures`: a 2-game series is a
          // sweep — the winner takes every game; only the 3-game series
          // drops the middle game to the loser (2-1).
          winner_id: g === 1 && !p1Wins ? loserId : winnerId,
          replay_url: '',
          source: 'manual' as const,
          stats_locked: false,
        })),
      },
    };
  });
}

/** The scenario-shaped rows the themed builders hand to `assembleWorldRouteData`. */
interface ScenarioRows {
  stages: TournamentWithDetails[];
  trainers: readonly (readonly [string, string])[];
  fixtures: LeagueFixture[];
  standings: LeagueStanding[];
  /** Draft picks per trainer — raised by `'large'` so the full roster is drafted. */
  picksPerTrainer: number;
}

/**
 * One place where the scenario axis reshapes the baseline rows, shared by all
 * three themed builders so the scenarios can never drift apart per theme.
 * Deterministic like everything else here: no clock, no randomness beyond the
 * existing `seeded()` helper.
 */
function buildScenarioRows(
  stages: TournamentWithDetails[],
  trainers: readonly (readonly [string, string])[],
  scenario: PreviewScenario,
): ScenarioRows {
  const roster = scenario === 'long-names' ? withLongNames(trainers) : trainers;
  const large = scenario === 'large';

  if (scenario === 'empty') {
    return { stages, trainers: roster, fixtures: [], standings: [], picksPerTrainer: large ? LARGE_PICKS : BASELINE_PICKS };
  }

  let fixtures = buildFixtures(stages, roster, large ? 6 : 3);
  if (scenario === 'disputed') fixtures = applyDisputed(fixtures);
  if (scenario === 'archive') fixtures = archiveFixtures(fixtures);

  return {
    stages: scenario === 'archive' ? archiveStages(stages) : stages,
    trainers: roster,
    fixtures,
    standings: buildStandings(fixtures, roster),
    picksPerTrainer: large ? LARGE_PICKS : BASELINE_PICKS,
  };
}

// ── Sakura Park fixtures (C-093) ─────────────────────────────────────

/** English trainer roster for the sakura park preview. */
const SAKURA_TRAINERS: readonly (readonly [string, string])[] = [
  ['Mara Wells', 'Fire'],
  ['Jonas Reed', 'Water'],
  ['Selin Ay', 'Grass'],
  ['Toby Warren', 'Electric'],
  ['Nell Brady', 'Psychic'],
  ['Kai Osman', 'Dark'],
  ['Lea Hoffman', 'Fairy'],
  ['Vince Kraus', 'Steel'],
];

/** Each sakura trainer's showcase lead — the non-EPB fallback's team aces. */
const SAKURA_TEAM_LEADS: readonly string[] = [
  'Charizard',
  'Blastoise',
  'Venusaur',
  'Ampharos',
  'Gardevoir',
  'Hydreigon',
  'Sylveon',
  'Corviknight',
];

function sakuraLeague(format: 'evolution_point_buy' | 'singles'): SeasonWithDetails {
  return {
    id: 'sakura-preview-season',
    name: 'Sakura Park League (Preview)',
    description: 'Deterministic English preview data for the sakura route world.',
    language: 'en',
    format_type: format,
    ruleset_id: 'sakura-preview-ruleset',
    start_date: '2026-08-01',
    end_date: '2026-12-15',
    status: 'active',
    archived: false,
    legacy: false,
    is_test_season: true,
    core_pool: null,
    point_buy_list_id: format === 'evolution_point_buy' ? 'sakura-preview-list' : null,
    created_at: ISO,
    updated_at: ISO,
    ruleset_name: 'Sakura Standard',
    participant_count: SAKURA_TRAINERS.length,
    tournament_count: 2,
  };
}

function buildSakuraStages(): TournamentWithDetails[] {
  return [
    { name: 'First Half', order: 0, status: 'completed' as const },
    { name: 'Second Half', order: 1, status: 'active' as const },
  ].map((stage, i) => ({
    id: id('sakura-stage', i + 1),
    name: stage.name,
    description: '',
    season_id: 'sakura-preview-season',
    bracket_type: 'round_robin',
    ruleset_id: 'sakura-preview-ruleset',
    best_of_default: 3,
    bo_overrides: {},
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    status: stage.status,
    current_round: stage.status === 'active' ? 2 : 7,
    stage_order: stage.order,
    advancement_rule: null,
    enrollment_source: null,
    archived: false,
    legacy: false,
    created_at: ISO,
    updated_at: ISO,
    ruleset_name: 'Sakura Standard',
    season_name: 'Sakura Park League',
    participant_count: SAKURA_TRAINERS.length,
  }));
}

/** Minimal Pokémon set — the ace derivation (`teamToLead`) reads only the lead's species. */
function sakuraSet(species: string): PokemonSet {
  return {
    name: '',
    species,
    gender: '',
    item: '',
    ability: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Serious',
    level: 100,
    moves: [],
  };
}

/** One team per trainer (the lead species feeds the non-EPB roster tiles). */
function buildSakuraTeams(
  trainers: readonly (readonly [string, string])[] = SAKURA_TRAINERS,
): Team[] {
  return trainers.map(([name], i) => ({
    id: id('sakura-team', i + 1),
    player_id: id('player', i + 1),
    name: `${name.split(' ')[0]}'s park team`,
    tournament_id: null,
    season_id: 'sakura-preview-season',
    match_id: null,
    pokemon: [sakuraSet(SAKURA_TEAM_LEADS[i % SAKURA_TEAM_LEADS.length])],
    import_source: 'manual' as const,
    locked: false,
    is_draft_team: false,
    draft_pool_id: null,
    library_published_at: null,
    library_title: null,
    library_description: null,
    library_tags: null,
    forked_from_team_id: null,
    created_at: ISO,
    updated_at: ISO,
  }));
}

/** Which sakura fixture variant `?world=sakura` renders. */
export type SakuraPreviewVariant = 'epb' | 'open';

export interface SakuraPreviewWorld {
  /** The sakura registry world (English section manifest). */
  world: SeasonWorld;
  /** The generic route contract payload — what `SakuraWorld` consumes. */
  data: WorldRouteData;
}

/**
 * Assemble the sakura park preview. Deterministic across calls, like the
 * plaza preview. Two format variants:
 *
 *  - `'epb'` — an evolution-point-buy season with the example roster, the
 *    full tracker set and standings, exercising the exact board/shrine data
 *    path a sakura-themed EPB league renders.
 *  - `'open'` — a singles season with NO point-buy list (`rosterLines`
 *    null): the roster falls back to participant tiles (ace species from
 *    team data + gym band), the non-EPB path the contract promises.
 *
 * Orthogonal to the variant, `scenario` reshapes the season state — see
 * `PreviewScenario` for the axis (`'populated'` is the unchanged baseline).
 */
export function buildPreviewSakuraWorld(
  variant: SakuraPreviewVariant = 'epb',
  scenario: PreviewScenario = 'populated',
): SakuraPreviewWorld {
  const epb = variant === 'epb';
  const league = sakuraLeague(epb ? 'evolution_point_buy' : 'singles');
  const rows = buildScenarioRows(buildSakuraStages(), SAKURA_TRAINERS, scenario);
  const entries = buildEntries();
  const data = assembleWorldRouteData({
    league,
    stages: rows.stages,
    participants: buildParticipants(rows.trainers),
    // assembleWorldRouteData nulls rosterLines for non-point-buy formats,
    // so the open variant's null comes from the CONTRACT, not from here.
    rosterLines: epb ? entries : [],
    trackers: epb ? buildTrackers(entries, rows.trainers, rows.picksPerTrainer) : [],
    standings: rows.standings,
    fixtures: rows.fixtures,
    formatRules:
      scenario === 'defaults' ? null : { ...FORMAT_RULES, season_id: 'sakura-preview-season' },
    hasDraftPool: epb,
    teamLeads: epb ? [] : buildSakuraTeams(rows.trainers).map(teamToLead),
  });

  return {
    // resolveWorld with the explicit pick — the same resolution a league
    // with `route_theme: 'sakura'` gets on the live page.
    world: resolveWorld({ format_type: league.format_type, route_theme: 'sakura' }),
    data,
  };
}

// ── Mountain Pass fixtures (C-094) ───────────────────────────────────

/** English trainer roster for the mountain pass preview. */
const MOUNTAIN_TRAINERS: readonly (readonly [string, string])[] = [
  ['Aria Bell', 'Ice'],
  ['Finn Hart', 'Fighting'],
  ['Iris Cole', 'Grass'],
  ['Reed Marsh', 'Water'],
  ['Tess Vane', 'Ghost'],
  ['Owen Pike', 'Steel'],
  ['Mira Holt', 'Fairy'],
  ['Dane Roy', 'Rock'],
];

/** Each mountain trainer's showcase lead — the non-EPB fallback's team aces. */
const MOUNTAIN_TEAM_LEADS: readonly string[] = [
  'Abomasnow',
  'Machamp',
  'Roselia',
  'Gyarados',
  'Aegislash',
  'Corviknight',
  'Sylveon',
  'Tyranitar',
];

function mountainLeague(format: 'evolution_point_buy' | 'singles'): SeasonWithDetails {
  return {
    id: 'mountain-preview-season',
    name: 'Mountain Pass League (Preview)',
    description: 'Deterministic English preview data for the mountain route world.',
    language: 'en',
    format_type: format,
    ruleset_id: 'mountain-preview-ruleset',
    start_date: '2026-08-01',
    end_date: '2026-12-15',
    status: 'active',
    archived: false,
    legacy: false,
    is_test_season: true,
    core_pool: null,
    point_buy_list_id: format === 'evolution_point_buy' ? 'mountain-preview-list' : null,
    created_at: ISO,
    updated_at: ISO,
    ruleset_name: 'Mountain Standard',
    participant_count: MOUNTAIN_TRAINERS.length,
    tournament_count: 2,
  };
}

function buildMountainStages(): TournamentWithDetails[] {
  return [
    { name: 'First Half', order: 0, status: 'completed' as const },
    { name: 'Second Half', order: 1, status: 'active' as const },
  ].map((stage, i) => ({
    id: id('mountain-stage', i + 1),
    name: stage.name,
    description: '',
    season_id: 'mountain-preview-season',
    bracket_type: 'round_robin',
    ruleset_id: 'mountain-preview-ruleset',
    best_of_default: 3,
    bo_overrides: {},
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    status: stage.status,
    current_round: stage.status === 'active' ? 2 : 7,
    stage_order: stage.order,
    advancement_rule: null,
    enrollment_source: null,
    archived: false,
    legacy: false,
    created_at: ISO,
    updated_at: ISO,
    ruleset_name: 'Mountain Standard',
    season_name: 'Mountain Pass League',
    participant_count: MOUNTAIN_TRAINERS.length,
  }));
}

/** One team per trainer (the lead species feeds the non-EPB roster tiles). */
function buildMountainTeams(
  trainers: readonly (readonly [string, string])[] = MOUNTAIN_TRAINERS,
): Team[] {
  return trainers.map(([name], i) => ({
    id: id('mountain-team', i + 1),
    player_id: id('player', i + 1),
    name: `${name.split(' ')[0]}'s valley team`,
    tournament_id: null,
    season_id: 'mountain-preview-season',
    match_id: null,
    pokemon: [sakuraSet(MOUNTAIN_TEAM_LEADS[i % MOUNTAIN_TEAM_LEADS.length])],
    import_source: 'manual' as const,
    locked: false,
    is_draft_team: false,
    draft_pool_id: null,
    library_published_at: null,
    library_description: null,
    library_title: null,
    library_tags: null,
    forked_from_team_id: null,
    created_at: ISO,
    updated_at: ISO,
  }));
}

/** Which mountain fixture variant `?world=mountain` renders. */
export type MountainPreviewVariant = 'epb' | 'open';

export interface MountainPreviewWorld {
  /** The mountain registry world (English section manifest). */
  world: SeasonWorld;
  /** The generic route contract payload — what `MountainWorld` consumes. */
  data: WorldRouteData;
}

/**
 * Assemble the mountain pass preview. Deterministic across calls, like the
 * plaza preview. Two format variants:
 *
 *  - `'epb'` — an evolution-point-buy season with the example roster, the
 *    full tracker set and standings, exercising the exact board/register
 *    data path a mountain-themed EPB league renders.
 *  - `'open'` — a singles season with NO point-buy list (`rosterLines`
 *    null): the roster falls back to participant tiles (ace species from
 *    team data + gym band), the non-EPB path the contract promises.
 *
 * Orthogonal to the variant, `scenario` reshapes the season state — see
 * `PreviewScenario` for the axis (`'populated'` is the unchanged baseline).
 */
export function buildPreviewMountainWorld(
  variant: MountainPreviewVariant = 'epb',
  scenario: PreviewScenario = 'populated',
): MountainPreviewWorld {
  const epb = variant === 'epb';
  const league = mountainLeague(epb ? 'evolution_point_buy' : 'singles');
  const rows = buildScenarioRows(buildMountainStages(), MOUNTAIN_TRAINERS, scenario);
  const entries = buildEntries();
  const data = assembleWorldRouteData({
    league,
    stages: rows.stages,
    participants: buildParticipants(rows.trainers),
    // assembleWorldRouteData nulls rosterLines for non-point-buy formats,
    // so the open variant's null comes from the CONTRACT, not from here.
    rosterLines: epb ? entries : [],
    trackers: epb ? buildTrackers(entries, rows.trainers, rows.picksPerTrainer) : [],
    standings: rows.standings,
    fixtures: rows.fixtures,
    formatRules:
      scenario === 'defaults' ? null : { ...FORMAT_RULES, season_id: 'mountain-preview-season' },
    hasDraftPool: epb,
    teamLeads: epb ? [] : buildMountainTeams(rows.trainers).map(teamToLead),
  });

  return {
    // resolveWorld with the explicit pick — the same resolution a league
    // with `route_theme: 'mountain'` gets on the live page.
    world: resolveWorld({ format_type: league.format_type, route_theme: 'mountain' }),
    data,
  };
}

// ── Skyisle fixtures (C-095) ──────────────────────────────────────────

/** English trainer roster for the skyisle preview. */
const CLOUDS_TRAINERS: readonly (readonly [string, string])[] = [
  ['Wren Skye', 'Flying'],
  ['Ash Gale', 'Fire'],
  ['Brook Tide', 'Water'],
  ['Fern Vale', 'Grass'],
  ['Storm Vega', 'Electric'],
  ['Iris Lofty', 'Psychic'],
  ['Sela Misty', 'Fairy'],
  ['Dane Crag', 'Rock'],
];

/** Each skyisle trainer's showcase lead — the non-EPB fallback's team aces. */
const CLOUDS_TEAM_LEADS: readonly string[] = [
  'Altaria',
  'Charizard',
  'Gyarados',
  'Serperior',
  'Electivire',
  'Gardevoir',
  'Sylveon',
  'Tyranitar',
];

function cloudsLeague(format: 'evolution_point_buy' | 'singles'): SeasonWithDetails {
  return {
    id: 'clouds-preview-season',
    name: 'Skyisle League (Preview)',
    description: 'Deterministic English preview data for the clouds route world.',
    language: 'en',
    format_type: format,
    ruleset_id: 'clouds-preview-ruleset',
    start_date: '2026-08-01',
    end_date: '2026-12-15',
    status: 'active',
    archived: false,
    legacy: false,
    is_test_season: true,
    core_pool: null,
    point_buy_list_id: format === 'evolution_point_buy' ? 'clouds-preview-list' : null,
    created_at: ISO,
    updated_at: ISO,
    ruleset_name: 'Skyisle Standard',
    participant_count: CLOUDS_TRAINERS.length,
    tournament_count: 2,
  };
}

function buildCloudsStages(): TournamentWithDetails[] {
  return [
    { name: 'First Half', order: 0, status: 'completed' as const },
    { name: 'Second Half', order: 1, status: 'active' as const },
  ].map((stage, i) => ({
    id: id('clouds-stage', i + 1),
    name: stage.name,
    description: '',
    season_id: 'clouds-preview-season',
    bracket_type: 'round_robin',
    ruleset_id: 'clouds-preview-ruleset',
    best_of_default: 3,
    bo_overrides: {},
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    status: stage.status,
    current_round: stage.status === 'active' ? 2 : 7,
    stage_order: stage.order,
    advancement_rule: null,
    enrollment_source: null,
    archived: false,
    legacy: false,
    created_at: ISO,
    updated_at: ISO,
    ruleset_name: 'Skyisle Standard',
    season_name: 'Skyisle League',
    participant_count: CLOUDS_TRAINERS.length,
  }));
}

/** One team per trainer (the lead species feeds the non-EPB roster tiles). */
function buildCloudsTeams(
  trainers: readonly (readonly [string, string])[] = CLOUDS_TRAINERS,
): Team[] {
  return trainers.map(([name], i) => ({
    id: id('clouds-team', i + 1),
    player_id: id('player', i + 1),
    name: `${name.split(' ')[0]}'s isle team`,
    tournament_id: null,
    season_id: 'clouds-preview-season',
    match_id: null,
    pokemon: [sakuraSet(CLOUDS_TEAM_LEADS[i % CLOUDS_TEAM_LEADS.length])],
    import_source: 'manual' as const,
    locked: false,
    is_draft_team: false,
    draft_pool_id: null,
    library_published_at: null,
    library_title: null,
    library_description: null,
    library_tags: null,
    forked_from_team_id: null,
    created_at: ISO,
    updated_at: ISO,
  }));
}

/** Which clouds fixture variant `?world=clouds` renders. */
export type CloudsPreviewVariant = 'epb' | 'open';

export interface CloudsPreviewWorld {
  /** The clouds registry world (English section manifest). */
  world: SeasonWorld;
  /** The generic route contract payload — what `CloudsWorld` consumes. */
  data: WorldRouteData;
}

/**
 * Assemble the skyisle preview. Deterministic across calls, like the plaza
 * preview. Two format variants:
 *
 *  - `'epb'` — an evolution-point-buy season with the example roster, the
 *    full tracker set and standings, exercising the exact board/sail data
 *    path a clouds-themed EPB league renders.
 *  - `'open'` — a singles season with NO point-buy list (`rosterLines`
 *    null): the roster falls back to participant tiles (ace species from
 *    team data + gym band), the non-EPB path the contract promises.
 *
 * Orthogonal to the variant, `scenario` reshapes the season state — see
 * `PreviewScenario` for the axis (`'populated'` is the unchanged baseline).
 */
export function buildPreviewCloudsWorld(
  variant: CloudsPreviewVariant = 'epb',
  scenario: PreviewScenario = 'populated',
): CloudsPreviewWorld {
  const epb = variant === 'epb';
  const league = cloudsLeague(epb ? 'evolution_point_buy' : 'singles');
  const rows = buildScenarioRows(buildCloudsStages(), CLOUDS_TRAINERS, scenario);
  const entries = buildEntries();
  const data = assembleWorldRouteData({
    league,
    stages: rows.stages,
    participants: buildParticipants(rows.trainers),
    // assembleWorldRouteData nulls rosterLines for non-point-buy formats,
    // so the open variant's null comes from the CONTRACT, not from here.
    rosterLines: epb ? entries : [],
    trackers: epb ? buildTrackers(entries, rows.trainers, rows.picksPerTrainer) : [],
    standings: rows.standings,
    fixtures: rows.fixtures,
    formatRules:
      scenario === 'defaults' ? null : { ...FORMAT_RULES, season_id: 'clouds-preview-season' },
    hasDraftPool: epb,
    teamLeads: epb ? [] : buildCloudsTeams(rows.trainers).map(teamToLead),
  });

  return {
    // resolveWorld with the explicit pick — the same resolution a league
    // with `route_theme: 'clouds'` gets on the live page.
    world: resolveWorld({ format_type: league.format_type, route_theme: 'clouds' }),
    data,
  };
}
