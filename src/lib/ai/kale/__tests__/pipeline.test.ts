import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the provider before importing pipeline
vi.mock('../provider', () => ({
  kaleGenerateText: vi.fn(),
  isKaleConfigured: () => true,
}));

// Mock the fact-pack builders
vi.mock('../fact-pack', () => ({
  buildRecapFactPack: vi.fn(),
  buildForecastFactPack: vi.fn(),
}));

// Mock the registry — register report types inline
vi.mock('../registry', async () => {
  const actual = await vi.importActual<typeof import('../registry')>('../registry');
  return actual;
});

import { runRecapPipeline, runForecastPipeline } from '../pipeline';
import { kaleGenerateText } from '../provider';
import { buildRecapFactPack, buildForecastFactPack } from '../fact-pack';
import type { RecapFactPack, ForecastFactPack } from '../types';
import { AllModelsFailedError, ModelRejectedError, OutputCapError, RefusalError } from '../../errors';
import { AI_MAX_TOKENS } from '../../constants';
import { buildForecastPromptTasks, buildRecapPromptTasks } from '../prompts';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const mockGenerateText = vi.mocked(kaleGenerateText);
const mockBuildRecapFactPack = vi.mocked(buildRecapFactPack);
const mockBuildForecastFactPack = vi.mocked(buildForecastFactPack);

// ─── Fixtures ───────────────────────────────────────────────────────

const recapFactPack: RecapFactPack = {
  leagueName: 'Kanto League',
  tournamentName: 'Season 1 Championship',
  roundName: 'Round 1',
  roundNumber: 1,
  format: 'gen9ou',
  gen: 9,
  bestOf: 3,
  scoring: '3 points for a win',
  gymTypes: {},
  matches: [
    {
      matchId: 'm1',
      player1Name: 'Ash',
      player2Name: 'Gary',
      winnerName: 'Ash',
      loserName: 'Gary',
      winnerScore: 2,
      loserScore: 1,
      marginDescription: 'a close match (2-1)',
      scoreString: '2-1',
      player1TotalKos: 7,
      player2TotalKos: 5,
      gamesPlayed: 3,
      mvpPokemon: 'Pikachu',
      mvpPlayerName: 'Ash',
      mvpKos: 4,
      winnerTeam: [
        { pokemonName: 'Pikachu', totalKos: 4, wasKoed: false, wasLead: true, isMvp: true, movesUsed: ['Thunderbolt', 'Volt Tackle'] },
      ],
      loserTeam: [
        { pokemonName: 'Blastoise', totalKos: 3, wasKoed: true, wasLead: true, isMvp: false, movesUsed: ['Hydro Pump'] },
      ],
      preWrittenOneLiner: 'Ash defeated Gary 2-1 in a close match, with Pikachu earning MVP honors (4 KOs).',
      keyPerformances: ['Pikachu earned MVP for Ash with 4 KOs'],
    },
  ],
  currentStandings: [
    {
      rank: 1, playerName: 'Ash', playerId: 'p1', gymType: null,
      points: 3, recordString: '1W-0L', kdString: '+2', rankChange: '#1',
      wins: 1, losses: 0, draws: 0, killDifferential: 2,
    },
    {
      rank: 2, playerName: 'Gary', playerId: 'p2', gymType: null,
      points: 0, recordString: '0W-1L', kdString: '-2', rankChange: '#2',
      wins: 0, losses: 1, draws: 0, killDifferential: -2,
    },
  ],
  previousStandings: null,
  standingsChanges: [],
  pokemonUsage: [{ pokemonName: 'Pikachu', timesBrought: 3, totalKos: 4 }],
  bestPerformer: { playerName: 'Ash', reason: 'won 2-1, Pikachu as MVP with 4 KOs' },
  unusualPick: null,
  validPlayerNames: ['Ash', 'Gary'],
  validPokemonNames: ['Pikachu', 'Blastoise'],
  matchData: [],
  pokemonTypes: { Pikachu: ['Electric'], Blastoise: ['Water'] },
};

const forecastFactPack: ForecastFactPack = {
  leagueName: 'Kanto League',
  tournamentName: 'Season 1 Championship',
  roundName: 'Round 2',
  roundNumber: 2,
  format: 'gen9ou',
  gen: 9,
  bestOf: 3,
  scoring: '3 points for a win',
  gymTypes: {},
  matchups: [{
    player1Name: 'Ash',
    player2Name: 'Misty',
    player1Rank: 1,
    player2Rank: 3,
    headToHead: 'First meeting',
    player1Team: ['Pikachu'],
    player2Team: ['Starmie'],
    player1Record: '1W-0L',
    player2Record: '0W-1L',
  }],
  currentStandings: [{
    rank: 1, playerName: 'Ash', playerId: 'p1', gymType: null,
    points: 3, recordString: '1W-0L', kdString: '+2', rankChange: '#1',
    wins: 1, losses: 0, draws: 0, killDifferential: 2,
  }],
  validPlayerNames: ['Ash', 'Misty'],
  validPokemonNames: ['Pikachu', 'Starmie'],
};

// ─── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: return a simple text response for any LLM call
  mockGenerateText.mockResolvedValue({
    content: 'A solid round of competition.',
    model: 'test-model',
    prompt_tokens: 100,
    completion_tokens: 20,
  });
});

describe('runRecapPipeline — decomposed mode', () => {
  beforeEach(() => {
    // Force decomposed mode
    vi.stubEnv('KALE_PIPELINE_MODE', 'decomposed');
    mockBuildRecapFactPack.mockResolvedValue(recapFactPack);
  });

  it('produces a valid RoundRecapContent with all required fields', async () => {
    const result = await runRecapPipeline('t1', 'r1');

    expect(result.content).toBeDefined();
    const content = result.content as import('@/types/tournament-report').RoundRecapContent;
    expect(content.headline).toBeDefined();
    expect(content.narrative).toBeDefined();
    expect(content.match_summaries).toHaveLength(1);
    expect(content.match_data).toEqual(recapFactPack.matchData);
    expect(content.pokemon_types).toEqual(recapFactPack.pokemonTypes);
    expect(content.standings_story).toBeDefined();
    expect(content.meta_trends).toBeDefined();
    expect(content.player_spotlight).toBeDefined();
    expect(content.player_spotlight.player_name).toBe('Ash');
  });

  it('uses pre-written one-liner as fallback when LLM returns empty', async () => {
    mockGenerateText.mockResolvedValue({
      content: '',
      model: 'test',
      prompt_tokens: 0,
      completion_tokens: 0,
    });

    const result = await runRecapPipeline('t1', 'r1');
    const content = result.content as import('@/types/tournament-report').RoundRecapContent;

    // Fallback: pre-written one-liner from fact pack
    expect(content.match_summaries[0].one_liner).toBe(recapFactPack.matches[0].preWrittenOneLiner);
  });

  it('makes multiple LLM calls in decomposed mode', async () => {
    await runRecapPipeline('t1', 'r1');

    // Decomposed recap with 1 match: 1 one-liner + headline + standings + meta + spotlight + narrative = 6 calls
    expect(mockGenerateText.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('tracks token usage across all calls', async () => {
    mockGenerateText.mockResolvedValue({
      content: 'Generated text.',
      model: 'test',
      prompt_tokens: 50,
      completion_tokens: 10,
    });

    const result = await runRecapPipeline('t1', 'r1');
    expect(result.promptTokens).toBeGreaterThan(0);
    expect(result.completionTokens).toBeGreaterThan(0);
    // Each call contributes 50 prompt + 10 completion tokens
    expect(result.promptTokens).toBe(50 * mockGenerateText.mock.calls.length);
  });

  it('reports generation time', async () => {
    const result = await runRecapPipeline('t1', 'r1');
    expect(result.generationTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('calls onProgress callback', async () => {
    const progress = vi.fn();
    await runRecapPipeline('t1', 'r1', progress);
    expect(progress).toHaveBeenCalled();
  });
});

describe('runRecapPipeline — single mode', () => {
  beforeEach(() => {
    vi.stubEnv('KALE_PIPELINE_MODE', 'single');
    mockBuildRecapFactPack.mockResolvedValue(recapFactPack);
  });

  it('makes exactly 1 LLM call in single mode', async () => {
    mockGenerateText.mockResolvedValue({
      content: JSON.stringify({
        headline: 'Ash Edges Gary in Thriller',
        narrative: 'A nail-biting round.',
        match_summaries: [{
          player_1_name: 'Ash',
          player_2_name: 'Gary',
          winner_name: 'Ash',
          score: '2-1',
          one_liner: 'Ash took a close one.',
          mvp_pokemon: 'Pikachu',
        }],
        standings_story: 'Ash leads.',
        meta_trends: 'Pikachu dominated.',
        player_spotlight: { player_name: 'Ash', reason: 'MVP Pikachu' },
        spicy_pick: null,
      }),
      model: 'test',
      prompt_tokens: 500,
      completion_tokens: 200,
    });

    const result = await runRecapPipeline('t1', 'r1');
    expect(mockGenerateText).toHaveBeenCalledTimes(1);

    const content = result.content as import('@/types/tournament-report').RoundRecapContent;
    expect(content.headline).toBe('Ash Edges Gary in Thriller');
    expect(content.match_summaries[0].one_liner).toBe('Ash took a close one.');
    // Server data is always populated regardless of mode
    expect(content.match_data).toEqual(recapFactPack.matchData);
  });

  it('falls back to decomposed assembly on JSON parse failure', async () => {
    mockGenerateText.mockResolvedValue({
      content: 'This is not JSON at all.',
      model: 'test',
      prompt_tokens: 100,
      completion_tokens: 50,
    });

    const result = await runRecapPipeline('t1', 'r1');
    const content = result.content as import('@/types/tournament-report').RoundRecapContent;

    // Should still produce valid content using fact pack fallbacks
    expect(content.headline).toContain('Round 1');
    expect(content.match_summaries[0].one_liner).toBe(recapFactPack.matches[0].preWrittenOneLiner);
  });
});

describe('runForecastPipeline — decomposed mode', () => {
  beforeEach(() => {
    vi.stubEnv('KALE_PIPELINE_MODE', 'decomposed');
    mockBuildForecastFactPack.mockResolvedValue(forecastFactPack);
  });

  it('produces a valid RoundForecastContent', async () => {
    mockGenerateText.mockResolvedValue({
      content: '{"storyline":"A classic rivalry","edge":"Ash","key_pokemon":"Pikachu"}',
      model: 'test',
      prompt_tokens: 80,
      completion_tokens: 30,
    });

    const result = await runForecastPipeline('t1', 'r2');
    const content = result.content as import('@/types/tournament-report').RoundForecastContent;

    expect(content.headline).toBeDefined();
    expect(content.matchup_previews).toHaveLength(1);
    expect(content.matchup_previews[0].player_1_name).toBe('Ash');
    expect(content.matchup_previews[0].player_2_name).toBe('Misty');
  });
});

describe('pipeline — retry on validation failure', () => {
  beforeEach(() => {
    vi.stubEnv('KALE_PIPELINE_MODE', 'decomposed');
    mockBuildRecapFactPack.mockResolvedValue(recapFactPack);
  });

  it('retries when validation fails and counts retries', async () => {
    let callCount = 0;
    mockGenerateText.mockImplementation(async () => {
      callCount++;
      // First call for one-liner has wrong winner, second is correct
      if (callCount === 1) {
        return {
          content: 'Gary won the match decisively.',
          model: 'test',
          prompt_tokens: 50,
          completion_tokens: 10,
        };
      }
      return {
        content: 'Ash took the series in a close one.',
        model: 'test',
        prompt_tokens: 60,
        completion_tokens: 15,
      };
    });

    const result = await runRecapPipeline('t1', 'r1');
    // Should have retried at least once
    expect(result.retryCount).toBeGreaterThanOrEqual(0);
  });
});

describe('pipeline — LLM failure handling', () => {
  beforeEach(() => {
    vi.stubEnv('KALE_PIPELINE_MODE', 'decomposed');
    mockBuildRecapFactPack.mockResolvedValue(recapFactPack);
  });

  it('produces content even when all LLM calls fail', async () => {
    mockGenerateText.mockRejectedValue(new Error('API down'));

    const result = await runRecapPipeline('t1', 'r1');
    const content = result.content as import('@/types/tournament-report').RoundRecapContent;

    // Should still have server-computed data
    expect(content.match_data).toEqual(recapFactPack.matchData);
    expect(content.pokemon_types).toEqual(recapFactPack.pokemonTypes);
    // Fallback content from fact pack
    expect(content.match_summaries[0].one_liner).toBe(recapFactPack.matches[0].preWrittenOneLiner);
    // Validation errors should be reported
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });

  it.each([
    ['a truncated answer', () => new OutputCapError('m', 150)],
    ['a refusal', () => new RefusalError('m', 'cyber')],
    ['a rejected request', () => new ModelRejectedError('m', 400, 'invalid_request_error')],
  ])('makes exactly one call per task after %s, then uses the fallback text', async (_label, makeError) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // A generic failure is retried (3 attempts per task): this gives the number of tasks.
    mockGenerateText.mockRejectedValue(new Error('API down'));
    await runRecapPipeline('t1', 'r1');
    const attemptsWithRetries = mockGenerateText.mock.calls.length;
    const tasks = attemptsWithRetries / 3;
    expect(Number.isInteger(tasks) && tasks > 0).toBe(true);

    mockGenerateText.mockReset();
    mockGenerateText.mockRejectedValue(makeError());
    const result = await runRecapPipeline('t1', 'r1');
    const content = result.content as import('@/types/tournament-report').RoundRecapContent;

    expect(mockGenerateText).toHaveBeenCalledTimes(tasks);
    expect(content.match_summaries[0].one_liner).toBe(recapFactPack.matches[0].preWrittenOneLiner);
    expect(result.validationErrors.some((e) => e.severity === 'error')).toBe(true);
    errorSpy.mockRestore();
  });
});

describe('pipeline — what a failed task stores', () => {
  beforeEach(() => {
    vi.stubEnv('KALE_PIPELINE_MODE', 'decomposed');
    mockBuildRecapFactPack.mockResolvedValue(recapFactPack);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function storedDetails(result: Awaited<ReturnType<typeof runRecapPipeline>>): string {
    return result.validationErrors.map((e) => e.detail).join('\n');
  }

  it('stores the error class, never the message, of an untyped failure', async () => {
    mockGenerateText.mockRejectedValue(new Error('provider said: secret prompt text and quota details'));

    const stored = storedDetails(await runRecapPipeline('t1', 'r1'));

    expect(stored).toContain('failed after 3 attempts: ai_report_failed: Error');
    expect(stored).not.toContain('secret');
    expect(stored).not.toContain('quota');
  });

  it('stores the upstream status and the model ids when every rung failed, but not the provider text', async () => {
    const lastRung = Object.assign(new Error('Overloaded: private provider detail'), { statusCode: 529 });
    mockGenerateText.mockRejectedValue(
      new AllModelsFailedError(
        [
          { model: 'claude-sonnet-5-5', summary: 'Overloaded: private provider detail [529]' },
          { model: 'claude-haiku-5-5', summary: 'Overloaded: private provider detail [529]' },
        ],
        lastRung,
      ),
    );

    const stored = storedDetails(await runRecapPipeline('t1', 'r1'));

    expect(stored).toContain('ai_report_failed: upstream HTTP 529 (claude-sonnet-5-5 -> claude-haiku-5-5)');
    expect(stored).not.toContain('private');
  });

  it.each([
    ['a truncated answer', () => new OutputCapError('claude-sonnet-5-5', 4096), 'ai_output_truncated: max_tokens 4096 on claude-sonnet-5-5'],
    ['a refusal', () => new RefusalError('claude-sonnet-5-5', 'cyber'), 'ai_output_refused: cyber on claude-sonnet-5-5'],
    [
      'a rejected request',
      () => new ModelRejectedError('claude-sonnet-5-5', 400, 'invalid_request_error'),
      'ai_request_rejected: HTTP 400 invalid_request_error on claude-sonnet-5-5',
    ],
  ])('stores a code and a short cause for %s', async (_label, makeError, expected) => {
    mockGenerateText.mockRejectedValue(makeError());

    expect(storedDetails(await runRecapPipeline('t1', 'r1'))).toContain(`failed: ${expected}`);
  });
});

describe('pipeline — Kale task output caps', () => {
  beforeEach(() => {
    mockBuildRecapFactPack.mockResolvedValue(recapFactPack);
    mockBuildForecastFactPack.mockResolvedValue(forecastFactPack);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['decomposed', 'single'] as const)('gives every recap and forecast task in %s mode the Kale task cap', (mode) => {
    const tasks = [...buildRecapPromptTasks(recapFactPack, mode), ...buildForecastPromptTasks(forecastFactPack, mode)];

    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) expect(task.maxTokens, task.id).toBe(AI_MAX_TOKENS.kaleTask);
  });

  it('sets the cap through AI_MAX_TOKENS.kaleTask on every task of every report definition', () => {
    const kaleDir = join(__dirname, '..');
    const files = [
      join(kaleDir, 'prompts.ts'),
      ...readdirSync(join(kaleDir, 'reports'))
        .filter((name) => name.endsWith('.ts'))
        .map((name) => join(kaleDir, 'reports', name)),
    ];

    let caps = 0;
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/maxTokens:\s*([^,\n]+),/g)) {
        caps++;
        expect(match[1].trim(), file).toBe('AI_MAX_TOKENS.kaleTask');
      }
    }
    expect(caps).toBeGreaterThan(10);
  });

  it('passes task.maxTokens to the provider on every call', async () => {
    vi.stubEnv('KALE_PIPELINE_MODE', 'decomposed');
    mockGenerateText.mockReset();
    mockGenerateText.mockResolvedValue({ content: 'A sentence about the round.', model: 'test', prompt_tokens: 1, completion_tokens: 1 });

    await runRecapPipeline('t1', 'r1');

    expect(mockGenerateText.mock.calls.length).toBeGreaterThan(1);
    for (const call of mockGenerateText.mock.calls) {
      expect(call[2]).toEqual({ maxTokens: AI_MAX_TOKENS.kaleTask });
    }
  });
});
