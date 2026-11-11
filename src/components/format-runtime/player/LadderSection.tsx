'use client';

import { useT } from '@/i18n/client';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { LadderView } from '@/lib/format-engine/runtime/view-types';
import type { LadderStatus } from './ChallengeRow';
import LadderCard from './LadderCard';
import { PlayerSection } from './parts';

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
    <PlayerSection title={t('ladder.heading')} icon="star-piece">
      <div className="flex flex-col gap-4">
        {ladders.map((ladder) => (
          <LadderCard key={ladder.phase_id} seasonId={seasonId} ladder={ladder} viewerId={viewerId} closed={closed} onReload={onReload} onStatus={onStatus} />
        ))}
      </div>
    </PlayerSection>
  );
}
