'use client';

import type { PlayerStreaks } from '@/types/streak';
import { useT } from '@/i18n/client';
import { gamificationMessages } from '@/i18n/messages/gamification';

interface StreakRecordsProps {
  streaks: PlayerStreaks;
}

function RecordPlate({ label, value }: { label: string; value: number }) {
  return (
    <li className="skew-plate justify-items-start px-3.5 py-2">
      <span aria-hidden="true" className="skew-plate-bg border border-hairline-strong bg-elevated" />
      <span className="flex flex-col">
        <span className="font-heading text-title text-fg tabular-nums">{value}</span>
        <span className="text-caption text-fg-muted">{label}</span>
      </span>
    </li>
  );
}

export default function StreakRecords({ streaks }: StreakRecordsProps) {
  const t = useT(gamificationMessages);
  return (
    <section>
      <h3 className="mb-2.5 text-subtitle font-[550] text-fg">{t('streaks.recordsTitle')}</h3>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-1.5">
        <RecordPlate label={t('streaks.bestWin')} value={streaks.best_win_streak} />
        <RecordPlate label={t('streaks.bestLoss')} value={streaks.best_loss_streak} />
        <RecordPlate label={t('streaks.bestKo')} value={streaks.best_ko_streak} />
        <RecordPlate label={t('streaks.bestFlawless')} value={streaks.best_flawless_streak} />
      </ul>
    </section>
  );
}
