import 'server-only';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getPhaseRoundById } from '@/lib/supabase/queries/phase-rounds';
import { emitPhaseDiscordEvent } from '@/lib/discord/notify';
import type { PhaseReport } from '@/types/phase-report';
import type { NativePhaseInvalidation } from './services';
import { phaseHref } from './paths';

export function createPhaseReportPublisher(invalidate: NativePhaseInvalidation['invalidateSeason']) {
  return async (report: PhaseReport): Promise<void> => {
    if (report.status !== 'completed' || !report.round_id) throw new Error('Only completed native round reports can be published');
    const [phase, round] = await Promise.all([getPhaseById(report.phase_id), getPhaseRoundById(report.round_id)]);
    if (!phase || !round || round.phase_id !== phase.id) throw new Error('Native report publication scope mismatch');
    const baseUrl = process.env.NEXTAUTH_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    const owner = { kind: 'phase' as const, phase_id: phase.id, season_id: phase.season_id };
    const phaseUrl = new URL(phaseHref(owner), baseUrl).toString();
    const content = report.content;
    if (report.report_type === 'round_recap' && 'match_summaries' in content) {
      await invalidate(phase.season_id, [phase.id]);
      emitPhaseDiscordEvent({
        version: 1, owner, event_type: 'round_recap_published', data: {
          kind: 'round_recap_published', phase_name: phase.name, round_name: round.name, headline: content.headline,
          match_summaries: content.match_summaries.map(summary => ({
            players: `${summary.player_1_name} vs ${summary.player_2_name}`, score: summary.score, one_liner: summary.one_liner,
          })), meta_trends: content.meta_trends,
          player_spotlight: { player_name: content.player_spotlight.player_name, reason: content.player_spotlight.reason },
          phase_url: phaseUrl,
        },
      });
      return;
    }
    if (report.report_type === 'round_forecast' && 'matchup_previews' in content) {
      await invalidate(phase.season_id, [phase.id]);
      emitPhaseDiscordEvent({
        version: 1, owner, event_type: 'round_forecast_published', data: {
          kind: 'round_forecast_published', phase_name: phase.name, round_name: round.name, headline: content.headline,
          matchup_previews: content.matchup_previews.map(preview => ({
            players: `${preview.player_1_name} vs ${preview.player_2_name}`, storyline: preview.storyline,
          })), bold_prediction: content.bold_prediction, phase_url: phaseUrl,
        },
      });
      return;
    }
    throw new Error('Native report content does not match its report type');
  };
}
