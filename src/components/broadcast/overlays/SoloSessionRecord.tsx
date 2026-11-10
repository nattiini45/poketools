'use client';

import { useSoloBroadcastPoll } from '@/lib/broadcast/use-solo-broadcast';
import { useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';

interface SoloSessionRecordProps {
  sessionId: string;
  pollInterval?: number;
}

/**
 * SoloSessionRecord — OBS overlay showing a compact W/L counter.
 * Polls the cast session and counts wins/losses from games_submitted.
 */
export default function SoloSessionRecord({ sessionId, pollInterval = 5000 }: SoloSessionRecordProps) {
  const t = useT(broadcastOverlaysMessages);
  const state = useSoloBroadcastPoll(sessionId, pollInterval);

  if (!state || state.games_submitted.length === 0) return null;

  return (
    <div className="flex items-center justify-center p-4">
      <div className="flex items-center gap-4 rounded-xl bg-[rgb(0_0_0/0.7)] backdrop-blur-xs px-8 py-4">
        <div className="flex items-center gap-2">
          <span className="text-green-400 font-bold text-4xl font-mono">{state.wins}</span>
          <span className="text-[rgb(74_222_128/0.6)] font-bold text-lg">{t('common.winsShort')}</span>
        </div>
        <span className="text-[rgb(255_255_255/0.3)] text-2xl font-bold">&ndash;</span>
        <div className="flex items-center gap-2">
          <span className="text-red-400 font-bold text-4xl font-mono">{state.losses}</span>
          <span className="text-[rgb(248_113_113/0.6)] font-bold text-lg">{t('common.lossesShort')}</span>
        </div>
      </div>
    </div>
  );
}
