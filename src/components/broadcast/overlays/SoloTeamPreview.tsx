'use client';

import { getSpriteUrl } from '@/lib/pkmn/sprites';
import { useSoloBroadcastPoll } from '@/lib/broadcast/use-solo-broadcast';
import { useDataLocale, useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { soloPlaceholderOf } from '@/lib/broadcast/solo-defaults';

interface SoloTeamPreviewProps {
  sessionId: string;
  pollInterval?: number;
}

/**
 * SoloTeamPreview — OBS overlay showing both teams side-by-side.
 * Polls the cast session for team data updates.
 */
export default function SoloTeamPreview({ sessionId, pollInterval = 5000 }: SoloTeamPreviewProps) {
  const t = useT(broadcastOverlaysMessages);
  const dl = useDataLocale();
  const state = useSoloBroadcastPoll(sessionId, pollInterval);

  /** Stored English placeholders ('Me'/'Opponent') read in the viewer's language; real names pass through. */
  const displayName = (name: string | null | undefined, fallback: string): string => {
    if (!name) return fallback;
    const placeholder = soloPlaceholderOf(name);
    if (placeholder === 'me') return t('common.me');
    if (placeholder === 'opponent') return t('common.opponent');
    return name;
  };

  if (!state) return null;

  const p1Name = displayName(state.current_game.player1.player_name || state.player1_name, t('common.myTeam'));
  const p2Name = displayName(state.current_game.player2.player_name || state.player2_name, t('common.opponent'));
  const p1Team = state.player1_team;
  const p2Team = state.player2_team;

  if (p1Team.length === 0 && p2Team.length === 0) return null;

  return (
    <div className="flex items-center justify-center gap-8 p-6">
      {/* Player 1 */}
      <div className="flex flex-col items-center gap-3">
        <span className="text-white font-bold text-lg drop-shadow-lg">{p1Name}</span>
        <div className="flex gap-1">
          {p1Team.map((set, i) => (
            <div key={`p1-${i}`} className="flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getSpriteUrl(set.species)}
                alt={localizeSpecies(set.species, dl)}
                className="w-12 h-12"
              />
            </div>
          ))}
        </div>
      </div>

      {/* VS divider */}
      <span className="text-white/60 font-bold text-2xl">{t('common.vs')}</span>

      {/* Player 2 */}
      <div className="flex flex-col items-center gap-3">
        <span className="text-white font-bold text-lg drop-shadow-lg">{p2Name}</span>
        <div className="flex gap-1">
          {p2Team.map((set, i) => (
            <div key={`p2-${i}`} className="flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getSpriteUrl(set.species)}
                alt={localizeSpecies(set.species, dl)}
                className="w-12 h-12"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
