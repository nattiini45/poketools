import { anthropicApiKey } from './api-key';
import { generateTournamentReportAsync } from './tournament-report-generator';
import type { TournamentReportType } from '@/types/tournament-report';

/**
 * Fire-and-forget trigger for tournament round reports.
 * Called when a round completes (recap) or new pairings are generated (forecast).
 */
export function triggerTournamentReport(
  tournamentId: string,
  roundId: string,
  reportType: TournamentReportType
): void {
  if (!process.env.KALE_API_KEY && !anthropicApiKey()) return;

  generateTournamentReportAsync(tournamentId, roundId, reportType).catch((err) => {
    console.error(`[ai/trigger] Failed to trigger ${reportType}:`, err);
  });
}

/**
 * Fire-and-forget trigger for post-match AI analysis.
 * Called from parse-replay and manual-result routes after recordGameResult()
 * when the best-of threshold is reached.
 */
export function triggerMatchAnalysis(
  matchId: string,
  cookie: string | null
): void {
  const baseUrl = process.env.NEXTAUTH_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  // Only trigger if the AI feature is configured
  if (!anthropicApiKey()) return;

  fetch(`${baseUrl}/api/ai/match-analysis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ match_id: matchId }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`[ai/trigger] Analysis trigger failed: ${res.status} ${text.slice(0, 200)}`);
      }
    })
    .catch((err) => {
      // Swallow — analysis is best-effort, never blocks match flow
      console.error('[ai/trigger] Failed to trigger match analysis:', err);
    });
}
