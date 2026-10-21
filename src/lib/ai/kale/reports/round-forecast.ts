import { buildForecastFactPack } from '../fact-pack';
import { buildForecastPromptTasks, getPipelineMode } from '../prompts';
import { validateForecastOutput } from '../validator';
import type { ReportDefinition } from '../registry';
import type { ForecastFactPack } from '../types';
import type { RoundForecastContent, RoundForecastMatchup } from '@/types/tournament-report';

function assemble(outputs: Map<string, string>, factPack: unknown): RoundForecastContent {
  const fp = factPack as ForecastFactPack;
  const mode = getPipelineMode();

  if (mode === 'single') {
    return assembleFromSingle(outputs, fp);
  }
  return assembleFromDecomposed(outputs, fp);
}

function assembleFromDecomposed(results: Map<string, string>, fp: ForecastFactPack): RoundForecastContent {
  const matchupPreviews: RoundForecastMatchup[] = fp.matchups.map((m, i) => {
    const storylineText = results.get(`matchup_storyline_${i}`) ?? '';
    const parsed = safeParseJson(storylineText);

    return {
      player_1_name: m.player1Name,
      player_2_name: m.player2Name,
      storyline: parsed?.storyline ?? `${m.player1Name} (#${m.player1Rank}) faces ${m.player2Name} (#${m.player2Rank}). ${m.headToHead}.`,
      edge: parsed?.edge ?? 'Even matchup',
      key_pokemon: parsed?.key_pokemon ?? '',
    };
  });

  const playersToWatch = fp.currentStandings.slice(0, 2).map((s) => ({
    player_name: s.playerName,
    reason: `Currently ranked #${s.rank} with ${s.recordString}`,
  }));

  return {
    headline: results.get('forecast_headline')?.trim() || `${fp.roundName} Preview`,
    narrative: results.get('forecast_narrative')?.trim() || '',
    matchup_previews: matchupPreviews,
    standings_context: results.get('standings_context')?.trim() || '',
    players_to_watch: playersToWatch,
    bold_prediction: results.get('bold_prediction')?.trim() || '',
  };
}

function assembleFromSingle(results: Map<string, string>, fp: ForecastFactPack): RoundForecastContent {
  const raw = results.get('single_forecast') ?? '';

  try {
    const p = parseJson(raw);
    const str = (val: unknown, fallback = ''): string => typeof val === 'string' ? val : fallback;
    const arr = (val: unknown): Record<string, unknown>[] =>
      Array.isArray(val) ? val as Record<string, unknown>[] : [];

    const matchupPreviews: RoundForecastMatchup[] = arr(p.matchup_previews).map((mp, i) => {
      const m = fp.matchups[i];
      return {
        player_1_name: str(mp.player_1_name, m?.player1Name),
        player_2_name: str(mp.player_2_name, m?.player2Name),
        storyline: str(mp.storyline),
        edge: str(mp.edge),
        key_pokemon: str(mp.key_pokemon),
      };
    });

    return {
      headline: str(p.headline, `${fp.roundName} Preview`),
      narrative: str(p.narrative),
      matchup_previews: matchupPreviews,
      standings_context: str(p.standings_context),
      players_to_watch: arr(p.players_to_watch).map((pw) => ({
        player_name: str(pw.player_name),
        reason: str(pw.reason),
      })),
      bold_prediction: str(p.bold_prediction),
    };
  } catch {
    return assembleFromDecomposed(new Map(), fp);
  }
}

function parseJson(raw: string): Record<string, unknown> {
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  cleaned = cleaned.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON found');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function safeParseJson(text: string): Record<string, string> | null {
  try {
    return parseJson(text) as Record<string, string>;
  } catch {
    return null;
  }
}

export const roundForecastDefinition: ReportDefinition = {
  type: 'round_forecast',
  buildFactPack: (params) => buildForecastFactPack(params.tournamentId, params.roundId),
  getPromptTasks: (factPack, mode) => buildForecastPromptTasks(factPack as ForecastFactPack, mode),
  validate: (taskId, text, factPack) => validateForecastOutput(taskId, text, factPack as ForecastFactPack),
  assemble,
};
