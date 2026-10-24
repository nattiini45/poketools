'use client';

import type { ReactNode } from 'react';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { useT } from '@/i18n/client';
import { LocalTime } from '@/i18n/LocalTime';
import { adminMatchMessages } from '@/i18n/messages/admin-match';
import type { MatchDisputeInfo } from '@/lib/admin/match-detail';

interface MatchDisputePanelProps {
  /** The newest dispute event, or null when the match was disputed before details were recorded. */
  dispute: MatchDisputeInfo | null;
  /** The winner the result reported (the match's current winner), if any. */
  reportedWinnerName: string | null;
  reporterName: string | null;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-heading text-poke-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-poke-text-primary">{children}</dd>
    </div>
  );
}

/** Who disputed the result, when and why. Read-only: resolving it stays in the override controls. */
export default function MatchDisputePanel({ dispute, reportedWinnerName, reporterName }: MatchDisputePanelProps) {
  const t = useT(adminMatchMessages);

  return (
    <Card variant="outlined" padding="md" className="border-poke-danger/40">
      <h2 className="text-lg font-heading font-bold tracking-tight text-poke-text-primary mb-3">
        {t('dispute.title')}
      </h2>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        {dispute ? (
          <>
            <Row label={t('dispute.disputedBy')}>
              <span className="inline-flex flex-wrap items-center gap-2">
                {dispute.actor_name || t('dispute.unknownActor')}
                {dispute.by_admin && <Badge variant="purple">{t('dispute.byAdmin')}</Badge>}
              </span>
            </Row>
            <Row label={t('dispute.disputedAt')}>
              <LocalTime value={dispute.disputed_at} preset="dateTimeYear" />
            </Row>
            <div className="sm:col-span-2">
              <dt className="text-xs font-heading text-poke-text-muted">{t('dispute.reason')}</dt>
              <dd className="mt-0.5 text-sm text-poke-text-primary whitespace-pre-line">
                {dispute.reason ?? <span className="text-poke-text-muted">{t('dispute.noReason')}</span>}
              </dd>
            </div>
          </>
        ) : (
          <div className="sm:col-span-2">
            <dt className="text-xs font-heading text-poke-text-muted">{t('dispute.details')}</dt>
            <dd className="mt-0.5 text-sm text-poke-text-muted">{t('dispute.notRecorded')}</dd>
          </div>
        )}
        <Row label={t('dispute.reportedWinner')}>{reportedWinnerName ?? t('dispute.noWinner')}</Row>
        {/* Without a reported winner no result was reported: the match's submitter is then whoever disputed it. */}
        <Row label={t('dispute.reportedBy')}>
          {reportedWinnerName === null ? t('header.noSubmitter') : (reporterName ?? t('header.noSubmitter'))}
        </Row>
      </dl>
    </Card>
  );
}
