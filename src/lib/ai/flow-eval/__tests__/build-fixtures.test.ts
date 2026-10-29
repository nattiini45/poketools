/**
 * Builds the synthetic fixtures of the AI flow eval (`scripts/eval-fixtures/ai-flows/*.json`).
 *
 * The post-match and scouting prompts are rendered by the app's own `buildMatchAnalysisPrompt` and
 * `buildMatchPrepPrompt`: the database queries are served from the in-memory synthetic world, the
 * Showdown log goes through the real `extractBattleFrames`, and the type analysis through the real
 * dex. Offline: no database, no network, no key.
 *
 * A plain `npm test` runs this file as a smoke test (the worlds still render, the fixtures still
 * validate, the build is deterministic) and writes nothing. `npm run eval:ai-flows:fixtures` sets
 * AI_FLOW_EVAL_WRITE=1 and rewrites the JSON files.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ world: null as unknown as import('../synthetic/world').World }));

vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: vi.fn(async () => holder.world.match) }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn(async () => holder.world.tournament) }));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(async () => holder.world.season),
  getSeasonParticipants: vi.fn(async () => holder.world.participants),
}));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn(async () => holder.world.ruleset) }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundById: vi.fn(async () => holder.world.round) }));
vi.mock('@/lib/supabase/queries/games', () => ({
  getGamesByMatch: vi.fn(async () => holder.world.games),
  getBattleStatsByMatch: vi.fn(async () => holder.world.battleStats),
  getOpponentBattleStatsInTournament: vi.fn(async () => holder.world.opponentHistory),
}));
vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAggregates: vi.fn(async () => holder.world.aggregates),
  getTotalGamesInScope: vi.fn(async () => holder.world.totalGames),
}));
vi.mock('@/lib/supabase/queries/teams', () => ({
  getPlayerTeamForMatch: vi.fn(async (playerId: string) => holder.world.teams[playerId] ?? null),
  getTeamByShareToken: vi.fn(),
  getTeamVisibilityFacts: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/match-prep-teams', () => ({ getMatchPrepTeam: vi.fn(async () => holder.world.prepTeam) }));
vi.mock('@/lib/pkmn/replay', () => ({
  fetchReplay: vi.fn(async (url: string) => ({
    id: url,
    format: 'gen9ou',
    players: ['', ''],
    winner: '',
    log: holder.world.replays[url] ?? '',
  })),
}));

import { buildMatchAnalysisPrompt, buildMatchPrepPrompt } from '../../context-builder';
import { INTERNAL_FIXTURE_DIR, parseFixtureFile, SYNTHETIC_FIXTURE_DIR } from '../fixtures';
import { FORECAST_SPECS, RECAP_SPECS, buildForecastCase, buildRecapCase, recapCases, slotCoachCases, teamCoachCases } from '../synthetic/inputs';
import { POST_MATCH_SPECS, PREP_SPECS } from '../synthetic/specs';
import { buildPostMatchWorld, buildPrepWorld, PLAYERS } from '../synthetic/world';
import type { CaseByFlow, FixtureFile, FlowId, MatchAnalysisCase, ScoutingCase } from '../types';

async function buildMatchAnalysisCases(): Promise<MatchAnalysisCase[]> {
  const cases: MatchAnalysisCase[] = [];
  for (const spec of POST_MATCH_SPECS) {
    const world = buildPostMatchWorld(spec);
    holder.world = world;
    const { systemPrompt, userPrompt } = await buildMatchAnalysisPrompt(String(world.match.id));
    cases.push({
      id: spec.id,
      label: spec.label,
      locale: spec.locale,
      systemPrompt,
      userPrompt,
      expect: {
        player1: PLAYERS[spec.p1.player].name,
        player2: PLAYERS[spec.p2.player].name,
        matchWinner: world.facts.matchWinner,
        games: world.facts.gameWinners,
        hasLeagueConstraint: spec.league !== 'open',
        gen: 9,
      },
    });
  }
  return cases;
}

async function buildScoutingCases(): Promise<ScoutingCase[]> {
  const cases: ScoutingCase[] = [];
  for (const spec of PREP_SPECS) {
    const world = buildPrepWorld(spec);
    holder.world = world;
    const prompt = await buildMatchPrepPrompt(String(world.match.id), String(world.match.player_1_id));
    cases.push({
      id: spec.id,
      label: spec.label,
      locale: spec.locale,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      hasUserTeam: prompt.hasUserTeam,
      expect: {
        opponent: String(world.match.player_2_name),
        opponentSpecies: world.facts.opponentSpecies,
        userGymType: world.facts.userGymType,
        gen: 9,
      },
    });
  }
  return cases;
}

async function buildAll(): Promise<{ [F in FlowId]: CaseByFlow[F][] }> {
  return {
    'kale-recap': RECAP_SPECS.map(buildRecapCase),
    'kale-forecast': FORECAST_SPECS.map(buildForecastCase),
    'match-analysis': await buildMatchAnalysisCases(),
    scouting: await buildScoutingCases(),
    'team-coach': teamCoachCases(),
    'slot-coach': slotCoachCases(),
    recap: recapCases(),
  };
}

const FLOWS: FlowId[] = ['kale-recap', 'kale-forecast', 'match-analysis', 'scouting', 'team-coach', 'slot-coach', 'recap'];

describe('synthetic AI flow fixtures', () => {
  it('renders every world through the app builders and validates against the fixture schema', async () => {
    const all = await buildAll();
    for (const flow of FLOWS) {
      const file: FixtureFile = { schemaVersion: 1, flow, synthetic: true, cases: all[flow] } as FixtureFile;
      const text = `${JSON.stringify(file, null, 2)}\n`;
      expect(() => parseFixtureFile(flow, text, flow)).not.toThrow();
      expect(all[flow].length).toBeGreaterThanOrEqual(8);
      if (process.env.AI_FLOW_EVAL_WRITE === '1') {
        const dir = path.resolve(process.cwd(), SYNTHETIC_FIXTURE_DIR);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `${flow}.json`), text);
      }
    }
  });

  it('renders the context sections each case is meant to exercise', async () => {
    const { 'match-analysis': analysis, scouting } = await buildAll();
    for (const spec of POST_MATCH_SPECS) {
      const c = analysis.find((x) => x.id === spec.id)!;
      expect(c.userPrompt).toContain(`## MATCH: ${PLAYERS[spec.p1.player].name} vs ${PLAYERS[spec.p2.player].name}`);
      expect(c.userPrompt.match(/^## GAME \d+/gm)).toHaveLength(spec.results.length);
      expect(c.userPrompt.includes('### Turn-by-Turn Summary')).toBe(spec.replays);
      expect(c.userPrompt.includes("'s Team Sheet")).toBe(spec.teamSheets);
      expect(c.userPrompt.includes('## LEAGUE CONTEXT')).toBe(spec.league !== 'open');
      if (spec.league === 'gym') expect(c.userPrompt).toContain('Gym Leader Typings');
      if (spec.league === 'core') expect(c.userPrompt).toContain('Assigned Core Types');
      expect(c.systemPrompt).toContain('Professor Linden');
    }
    for (const spec of PREP_SPECS) {
      const c = scouting.find((x) => x.id === spec.id)!;
      expect(c.userPrompt).toContain('## UPCOMING MATCH');
      expect(c.hasUserTeam).toBe(spec.userTeam === 'prep');
      expect(c.userPrompt.includes('### YOUR PLANNED TEAM')).toBe(spec.userTeam === 'prep');
      expect(c.userPrompt.includes('REGISTERED TOURNAMENT TEAM')).toBe(spec.userTeam === 'registered');
      expect(c.userPrompt.includes("BATTLE HISTORY (")).toBe(spec.historyGames > 0);
      expect(c.systemPrompt).toContain('scout');
    }
  });

  it('is deterministic: two builds are byte-identical', async () => {
    const a = JSON.stringify(await buildAll());
    const b = JSON.stringify(await buildAll());
    expect(a).toBe(b);
  });

  it('holds only invented data: invented names only, no address, no link, no id of a real service', async () => {
    const text = JSON.stringify(await buildAll());
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/\b\d{17,20}\b/);
    expect(INTERNAL_FIXTURE_DIR.startsWith('.internal')).toBe(true);
  });
});
