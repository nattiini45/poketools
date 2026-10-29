import { isKaleConfigured } from './kale/provider';
import { runPipeline } from './kale/pipeline';
// Force registry initialization — imports all report definitions
import './kale/registry';
import {
  createTournamentReport,
  updateTournamentReport,
  getTournamentReport,
  deleteTournamentReport,
} from '@/lib/supabase/queries/tournament-reports';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { revalidateMatchPages } from '@/lib/revalidation';
import type {
  TournamentReportType,
  RoundRecapContent,
  RoundForecastContent,
} from '@/types/tournament-report';
import type { RoundRecapPublishedData, RoundForecastPublishedData } from '@/types/discord';
import { AI_ANALYSIS_STALE_MS, getKaleModelId } from './constants';

/**
 * Generate a tournament report asynchronously (fire-and-forget).
 * Uses the Kale 2.0 fact-first pipeline for improved accuracy and model flexibility.
 */
export async function generateTournamentReportAsync(
  tournamentId: string,
  roundId: string,
  reportType: TournamentReportType
): Promise<void> {
  if (!isKaleConfigured()) return;

  try {
    // Skip if report already exists and completed
    const existing = await getTournamentReport(tournamentId, roundId, reportType);
    if (existing?.status === 'completed') return;

    // Clean up stale pending records
    if (existing?.status === 'pending') {
      const age = Date.now() - new Date(existing.created_at).getTime();
      if (age < AI_ANALYSIS_STALE_MS) return;
      await deleteTournamentReport(tournamentId, roundId, reportType);
    } else if (existing) {
      await deleteTournamentReport(tournamentId, roundId, reportType);
    }

    const record = await createTournamentReport(tournamentId, roundId, reportType, getKaleModelId());

    // Run the Kale 2.0 pipeline (registry resolves the correct report definition)
    const pipelineResult = await runPipeline(reportType, { tournamentId, roundId });

    const validationErrorLog = pipelineResult.validationErrors.length > 0
      ? JSON.stringify(pipelineResult.validationErrors)
      : null;

    await updateTournamentReport(record.id, {
      content: pipelineResult.content,
      // The model that answered, not the one that was asked ('unknown' = no task finished).
      ...(pipelineResult.modelUsed && pipelineResult.modelUsed !== 'unknown' && { model_id: pipelineResult.modelUsed }),
      prompt_tokens: pipelineResult.promptTokens,
      completion_tokens: pipelineResult.completionTokens,
      generation_time_ms: pipelineResult.generationTimeMs,
      status: 'completed',
      error: validationErrorLog,
    });

    // Revalidate pages
    await revalidateMatchPages(tournamentId);

    // Emit Discord notification (fire-and-forget) — only for recap/forecast
    if (reportType === 'round_recap' || reportType === 'round_forecast') {
      emitDiscordNotification(tournamentId, roundId, reportType, pipelineResult.content as RoundRecapContent | RoundForecastContent);
    }
  } catch (err) {
    console.error(`[ai/tournament-report] Failed to generate ${reportType}:`, err);
  }
}

// ─── Legacy Parsing (kept for streaming API route compatibility) ────

/**
 * @deprecated Used by single-mode pipeline internally. Prefer the Kale 2.0 pipeline.
 */
export function parseReportResponse(
  raw: string,
  reportType: TournamentReportType
): RoundRecapContent | RoundForecastContent {
  let cleaned = raw.trim();

  // Strip <think>...</think> blocks
  const thinkEnd = cleaned.lastIndexOf('</think>');
  if (thinkEnd !== -1) {
    cleaned = cleaned.slice(thinkEnd + 8).trim();
  }

  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();

  // Extract JSON object
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('No JSON object found in LLM response');
  }
  cleaned = cleaned.slice(firstBrace, lastBrace + 1);

  const parsed = JSON.parse(cleaned);

  if (reportType === 'round_recap') {
    return parseRecapContent(parsed);
  }
  return parseForecastContent(parsed);
}

function parseRecapContent(parsed: Record<string, unknown>): RoundRecapContent {
  if (!parsed.headline || typeof parsed.headline !== 'string') {
    throw new Error('Missing or invalid "headline" in recap response');
  }
  if (!parsed.narrative || typeof parsed.narrative !== 'string') {
    throw new Error('Missing or invalid "narrative" in recap response');
  }

  return {
    headline: parsed.headline,
    narrative: parsed.narrative,
    match_summaries: Array.isArray(parsed.match_summaries)
      ? parsed.match_summaries.map((ms: Record<string, unknown>) => ({
          player_1_name: String(ms.player_1_name ?? ''),
          player_2_name: String(ms.player_2_name ?? ''),
          winner_name: String(ms.winner_name ?? ''),
          score: String(ms.score ?? ''),
          one_liner: String(ms.one_liner ?? ''),
          mvp_pokemon: String(ms.mvp_pokemon ?? ''),
        }))
      : [],
    match_data: [],
    pokemon_types: {},
    standings_story: String(parsed.standings_story ?? ''),
    meta_trends: String(parsed.meta_trends ?? ''),
    player_spotlight: {
      player_id: '',
      player_name: String((parsed.player_spotlight as Record<string, unknown>)?.player_name ?? ''),
      reason: String((parsed.player_spotlight as Record<string, unknown>)?.reason ?? ''),
    },
    spicy_pick: parsed.spicy_pick
      ? {
          pokemon_name: String((parsed.spicy_pick as Record<string, unknown>).pokemon_name ?? ''),
          player_id: '',
          player_name: String((parsed.spicy_pick as Record<string, unknown>).player_name ?? ''),
          context: String((parsed.spicy_pick as Record<string, unknown>).context ?? ''),
        }
      : null,
  };
}

function parseForecastContent(parsed: Record<string, unknown>): RoundForecastContent {
  if (!parsed.headline || typeof parsed.headline !== 'string') {
    throw new Error('Missing or invalid "headline" in forecast response');
  }
  if (!parsed.narrative || typeof parsed.narrative !== 'string') {
    throw new Error('Missing or invalid "narrative" in forecast response');
  }

  return {
    headline: parsed.headline,
    narrative: parsed.narrative,
    matchup_previews: Array.isArray(parsed.matchup_previews)
      ? parsed.matchup_previews.map((mp: Record<string, unknown>) => ({
          player_1_name: String(mp.player_1_name ?? ''),
          player_2_name: String(mp.player_2_name ?? ''),
          storyline: String(mp.storyline ?? ''),
          edge: String(mp.edge ?? ''),
          key_pokemon: String(mp.key_pokemon ?? ''),
        }))
      : [],
    standings_context: String(parsed.standings_context ?? ''),
    players_to_watch: Array.isArray(parsed.players_to_watch)
      ? parsed.players_to_watch.map((pw: Record<string, unknown>) => ({
          player_name: String(pw.player_name ?? ''),
          reason: String(pw.reason ?? ''),
        }))
      : [],
    bold_prediction: String(parsed.bold_prediction ?? ''),
  };
}

// ─── Discord Notification ───────────────────────────────────────────

async function emitDiscordNotification(
  tournamentId: string,
  roundId: string,
  reportType: TournamentReportType,
  content: RoundRecapContent | RoundForecastContent
): Promise<void> {
  try {
    const [tournament, round] = await Promise.all([
      getTournamentById(tournamentId),
      getRoundById(roundId),
    ]);
    if (!tournament || !round) return;

    const baseUrl = process.env.NEXTAUTH_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    const tournamentUrl = `${baseUrl}/tournaments/${tournamentId}`;

    if (reportType === 'round_recap') {
      const recap = content as RoundRecapContent;
      const data: RoundRecapPublishedData = {
        kind: 'round_recap_published',
        tournament_name: tournament.name,
        round_name: round.name,
        headline: recap.headline,
        match_summaries: recap.match_summaries.map((ms) => ({
          players: `${ms.player_1_name} vs ${ms.player_2_name}`,
          score: ms.score,
          one_liner: ms.one_liner,
        })),
        meta_trends: recap.meta_trends,
        player_spotlight: recap.player_spotlight,
        tournament_url: tournamentUrl,
      };

      emitDiscordEvent({
        event_type: 'round_recap_published',
        tournament_id: tournamentId,
        season_id: tournament.season_id ?? null,
        data,
      });
    } else {
      const forecast = content as RoundForecastContent;
      const data: RoundForecastPublishedData = {
        kind: 'round_forecast_published',
        tournament_name: tournament.name,
        round_name: round.name,
        headline: forecast.headline,
        matchup_previews: forecast.matchup_previews.map((mp) => ({
          players: `${mp.player_1_name} vs ${mp.player_2_name}`,
          storyline: mp.storyline,
        })),
        bold_prediction: forecast.bold_prediction,
        tournament_url: tournamentUrl,
      };

      emitDiscordEvent({
        event_type: 'round_forecast_published',
        tournament_id: tournamentId,
        season_id: tournament.season_id ?? null,
        data,
      });
    }
  } catch (err) {
    console.error('[ai/tournament-report] Discord notification failed:', err);
  }
}
