'use client';

import type { PlayerStreaks } from '@/types/streak';
import { useT } from '@/i18n/client';
import { gamificationMessages } from '@/i18n/messages/gamification';

interface StreakRecordsProps {
  streaks: PlayerStreaks;
}

function RecordCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-poke-elevated border border-poke-border rounded-poke-lg p-3 text-center">
      <div className="text-2xl font-heading font-bold text-poke-text-primary">{value}</div>
      <div className="text-xs uppercase tracking-wide text-poke-text-tertiary mt-1">{label}</div>
    </div>
  );
}

export default function StreakRecords({ streaks }: StreakRecordsProps) {
  const t = useT(gamificationMessages);
  return (
    <section className="bg-poke-surface border border-poke-border rounded-poke-xl p-5 shadow-poke">
      <h3 className="text-base font-heading font-bold text-poke-text-primary mb-3">{t('streaks.recordsTitle')}</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <RecordCard label={t('streaks.bestWin')} value={streaks.best_win_streak} />
        <RecordCard label={t('streaks.bestLoss')} value={streaks.best_loss_streak} />
        <RecordCard label={t('streaks.bestKo')} value={streaks.best_ko_streak} />
        <RecordCard label={t('streaks.bestFlawless')} value={streaks.best_flawless_streak} />
      </div>
    </section>
  );
}
