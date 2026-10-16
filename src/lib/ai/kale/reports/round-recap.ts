import { buildRecapFactPack } from '../fact-pack';
import { buildRecapPromptTasks, getPipelineMode } from '../prompts';
import { validateRecapOutput } from '../validator';
import type { ReportDefinition } from '../registry';
import type { RecapFactPack } from '../types';
import type { RoundRecapContent, RoundRecapMatchSummary } from '@/types/tournament-report';

function assemble(outputs: Map<string, string>, factPack: unknown): RoundRecapContent {
  const fp = factPack as RecapFactPack;
  const mode = getPipelineMode();

  if (mode === 'single') {
    return assembleFromSingle(outputs, fp);
  }
  return assembleFromDecomposed(outputs, fp);
}

function assembleFromDecomposed(results: Map<string, string>, fp: RecapFactPack): RoundRecapContent {
  const matchSummaries: RoundRecapMatchSummary[] = fp.matches.map((m, i) => ({
    player_1_name: m.player1Name,
    player_2_name: m.player2Name,
    winner_name: m.winnerName,
    score: m.scoreString,
    one_liner: results.get(`match_one_liner_${i}`)?.trim() || m.preWrittenOneLiner,
    mvp_pokemon: m.mvpPokemon,
  }));

  const spotlightPlayerName = fp.bestPerformer?.playerName ?? fp.matches[0]?.winnerName ?? '';
  const spotlightPlayerId = fp.currentStandings.find(
    (s) => s.playerName === spotlightPlayerName
  )?.playerId ?? '';

  const spicyPick = fp.unusualPick
    ? {
        pokemon_name: fp.unusualPick.pokemonName,
        player_id: fp.currentStandings.find(
          (s) => s.playerName === fp.unusualPick!.playerName
        )?.playerId ?? '',
        player_name: fp.unusualPick.playerName,
        context: results.get('spicy_context')?.trim() || fp.unusualPick.reason,
      }
    : null;

  return {
    headline: results.get('headline')?.trim() || `${fp.roundName} Results`,
    narrative: results.get('narrative')?.trim() || fp.matches.map((m) => m.preWrittenOneLiner).join('\n\n'),
    match_summaries: matchSummaries,
    match_data: fp.matchData,
    pokemon_types: fp.pokemonTypes,
    standings_story: results.get('standings_story')?.trim() || '',
    meta_trends: results.get('meta_trends')?.trim() || '',
    player_spotlight: {
      player_id: spotlightPlayerId,
      player_name: spotlightPlayerName,
      reason: results.get('spotlight_reason')?.trim() || (fp.bestPerformer?.reason ?? ''),
    },
    spicy_pick: spicyPick,
  };
}

function assembleFromSingle(results: Map<string, string>, fp: RecapFactPack): RoundRecapContent {
  const raw = results.get('single_recap') ?? '';

  try {
    const p = parseJson(raw);
    const str = (val: unknown, fallback = ''): string => typeof val === 'string' ? val : fallback;
    const obj = (val: unknown): Record<string, unknown> =>
      val && typeof val === 'object' && !Array.isArray(val) ? val as Record<string, unknown> : {};
    const arr = (val: unknown): Record<string, unknown>[] =>
      Array.isArray(val) ? val as Record<string, unknown>[] : [];

    const matchSummaries: RoundRecapMatchSummary[] = arr(p.match_summaries).map((ms, i) => {
      const mf = fp.matches[i];
      return {
        player_1_name: str(ms.player_1_name, mf?.player1Name),
        player_2_name: str(ms.player_2_name, mf?.player2Name),
        winner_name: str(ms.winner_name, mf?.winnerName),
        score: str(ms.score, mf?.scoreString),
        one_liner: str(ms.one_liner, mf?.preWrittenOneLiner),
        mvp_pokemon: str(ms.mvp_pokemon, mf?.mvpPokemon),
      };
    });

    const spotlight = obj(p.player_spotlight);
    const spotlightName = str(spotlight.player_name, fp.bestPerformer?.playerName);
    const spotlightId = fp.currentStandings.find((s) => s.playerName === spotlightName)?.playerId ?? '';

    const spicyRaw = p.spicy_pick ? obj(p.spicy_pick) : null;
    const spicyPick = spicyRaw
      ? {
          pokemon_name: str(spicyRaw.pokemon_name),
          player_id: fp.currentStandings.find((s) => s.playerName === str(spicyRaw.player_name))?.playerId ?? '',
          player_name: str(spicyRaw.player_name),
          context: str(spicyRaw.context),
        }
      : null;

    return {
      headline: str(p.headline, `${fp.roundName} Results`),
      narrative: str(p.narrative),
      match_summaries: matchSummaries,
      match_data: fp.matchData,
      pokemon_types: fp.pokemonTypes,
      standings_story: str(p.standings_story),
      meta_trends: str(p.meta_trends),
      player_spotlight: { player_id: spotlightId, player_name: spotlightName, reason: str(spotlight.reason) },
      spicy_pick: spicyPick,
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

export const roundRecapDefinition: ReportDefinition = {
  type: 'round_recap',
  buildFactPack: (params) => buildRecapFactPack(params.tournamentId, params.roundId),
  getPromptTasks: (factPack, mode) => buildRecapPromptTasks(factPack as RecapFactPack, mode),
  validate: (taskId, text, factPack) => validateRecapOutput(taskId, text, factPack as RecapFactPack),
  assemble,
};
