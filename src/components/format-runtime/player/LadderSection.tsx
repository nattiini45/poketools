'use client';

import Section from '@/components/ui/Section';
import { useT } from '@/i18n/client';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { LadderView } from '@/lib/format-engine/runtime/view-types';
import type { LadderStatus } from './ChallengeRow';
import LadderCard from './LadderCard';

export interface LadderSectionProps {
  seasonId: string;
  ladders: readonly LadderView[];
  viewerId: string;
  closed: boolean;
  onReload: () => Promise<void>;
  onStatus?: (status: LadderStatus) => void;
}

/** The challenge ladders of the league, one card each. */
export default function LadderSection({ seasonId, ladders, viewerId, closed, onReload, onStatus }: LadderSectionProps) {
  const t = useT(formatRuntimePlayerMessages);
  return (
    <Section title={t('ladder.heading')}>
      <div className="space-y-4">
        {ladders.map((ladder) => (
          <LadderCard key={ladder.phase_id} seasonId={seasonId} ladder={ladder} viewerId={viewerId} closed={closed} onReload={onReload} onStatus={onStatus} />
        ))}
      </div>
    </Section>
  );
}
