import TournamentReportCard from '@/components/tournament/TournamentReportCard';
import type { LeagueHubCopy } from '@/lib/league-hub/copy';
import type { HubStage } from '@/lib/league-hub/views';
import type { TournamentReport } from '@/types/tournament-report';
import { HubNotice } from './HubBits';

interface HubReportsPanelProps {
  reports: { stage: HubStage; reports: TournamentReport[] }[];
  copy: LeagueHubCopy;
}

/**
 * Kale Cabbage's reports, grouped by phase, newest first. The tab only exists
 * behind `ENABLE_KALE_CABBAGE` (soft-deprecated, off by default).
 */
export default function HubReportsPanel({ reports, copy }: HubReportsPanelProps) {
  const withReports = reports.filter((entry) => entry.reports.length > 0);
  if (withReports.length === 0) return <HubNotice>{copy.reportsEmpty}</HubNotice>;

  return (
    <div className="space-y-8">
      {withReports.map(({ stage, reports: stageReports }) => (
        <div key={stage.id} className="space-y-3">
          <h4 className="font-heading text-lg font-bold text-arena-ink">{stage.name}</h4>
          <div className="space-y-3">
            {[...stageReports]
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((report) => (
                <TournamentReportCard key={report.id} report={report} tournamentId={stage.id} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
