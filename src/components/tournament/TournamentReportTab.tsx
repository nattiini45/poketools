'use client';

import Image from 'next/image';
import TournamentReportCard from './TournamentReportCard';
import type { TournamentReport } from '@/types/tournament-report';
import { useT } from '@/i18n/client';
import { tournamentsMessages } from '@/i18n/messages/tournaments';

interface RoundInfo {
  id: string;
  name: string;
  round_number: number;
  status: string;
}

interface TournamentReportTabProps {
  reports: TournamentReport[];
  rounds: RoundInfo[];
  tournamentId: string;
}

export default function TournamentReportTab({
  reports,
  rounds,
  tournamentId,
}: TournamentReportTabProps) {
  const t = useT(tournamentsMessages);
  // Group reports by round_id
  const reportsByRound = new Map<string, TournamentReport[]>();
  for (const r of reports) {
    const list = reportsByRound.get(r.round_id) ?? [];
    list.push(r);
    reportsByRound.set(r.round_id, list);
  }

  // Sort rounds by round_number descending (newest first)
  const sortedRounds = [...rounds].sort((a, b) => b.round_number - a.round_number);

  // Only show rounds that have reports
  const roundsWithReports = sortedRounds.filter(
    (round) => (reportsByRound.get(round.id) ?? []).length > 0
  );

  if (roundsWithReports.length === 0) {
    return (
      <div className="text-center py-8 flex flex-col items-center gap-3">
        <Image
          src="/characters/Kale-Cabbage.jpg"
          alt={t('report.kale')}
          width={64}
          height={64}
          className="rounded-full object-cover opacity-60"
          unoptimized
        />
        <div>
          <p className="text-poke-text-muted text-sm">{t('report.empty')}</p>
          <p className="text-poke-text-muted text-xs mt-1">{t('report.emptyAuto')}</p>
          <p className="text-poke-text-muted text-xs mt-0.5">{t('report.emptyManual')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {roundsWithReports.map((round) => {
        const roundReports = reportsByRound.get(round.id) ?? [];

        return (
          <div key={round.id}>
            <h3 className="text-sm font-heading font-semibold text-poke-text-primary mb-2">
              {round.name}
            </h3>

            <div className="space-y-2">
              {/* Show forecast first (pre-round), then recap (post-round) */}
              {roundReports
                .sort((a, _b) => (a.report_type === 'round_forecast' ? -1 : 1))
                .map((report) => (
                  <TournamentReportCard
                    key={report.id}
                    report={report}
                    tournamentId={tournamentId}
                  />
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
