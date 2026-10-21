'use client';

import { useState, useCallback } from 'react';
import Button from '@/components/ui/Button';
import type { TrackerState, BroadcastMomentType } from '@/types/broadcast';
import type { TrackerDispatchAction } from '@/lib/broadcast/tracker-reducer';
import { buildGamePayload } from '@/lib/broadcast/tracker-reducer';
import {
  MOMENT_DESCRIPTION_MAX_LENGTH,
  MOMENT_MAX_PER_GAME,
  buildTrackerMoment,
} from '@/lib/broadcast/moment-limits';
import { useT } from '@/i18n/client';
import { broadcastCasterMessages } from '@/i18n/messages/broadcast-caster';
import { usePlayerDisplayName } from './usePlayerDisplayName';

interface TrackerControlsProps {
  state: TrackerState;
  dispatch: (action: TrackerDispatchAction) => void;
  onSubmitGame: (payload: ReturnType<typeof buildGamePayload>) => Promise<void>;
  /** Show moment markers and annotations (Producer Mode) */
  producerMode?: boolean;
}

const MOMENT_TYPES: { value: BroadcastMomentType; emoji: string }[] = [
  { value: 'big_ko', emoji: '💥' },
  { value: 'turning_point', emoji: '🔄' },
  { value: 'clutch', emoji: '🎯' },
  { value: 'misplay', emoji: '❌' },
  { value: 'highlight', emoji: '✨' },
];

export default function TrackerControls({
  state,
  dispatch,
  onSubmitGame,
  producerMode = false,
}: TrackerControlsProps) {
  const t = useT(broadcastCasterMessages);
  const displayName = usePlayerDisplayName();
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [momentNote, setMomentNote] = useState('');

  const { player1, player2 } = state.current_game;

  const canSubmit = winnerId !== null;
  const hasAnyData = player1.slots.some((s) => s.was_brought) || player2.slots.some((s) => s.was_brought);

  const handleSubmit = useCallback(async () => {
    if (!winnerId || submitting) return;
    setSubmitting(true);
    try {
      const payload = buildGamePayload(state, winnerId);
      await onSubmitGame(payload);
      setWinnerId(null);
    } finally {
      setSubmitting(false);
    }
  }, [winnerId, submitting, state, onSubmitGame]);

  // The server rejects the whole game when one moment breaks its bounds, so
  // the tracker stops producing moments past them (see moment-limits).
  const momentLimitReached = state.current_game.moments.length >= MOMENT_MAX_PER_GAME;

  const handleMoment = useCallback(
    (momentType: BroadcastMomentType) => {
      if (momentLimitReached) return;
      const moment = buildTrackerMoment({
        matchId: state.match_id,
        momentType,
        turn: state.current_game.turn,
        note: momentNote,
        now: new Date(),
      });
      dispatch({ type: 'mark_moment', moment });
      setMomentNote('');
    },
    [momentLimitReached, state.match_id, state.current_game.turn, momentNote, dispatch]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Winner selection */}
      <div className="flex flex-col gap-2">
        <label className="text-xs text-poke-text-secondary uppercase tracking-wider font-semibold">
          {t('controls.gameWinner')}
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setWinnerId(player1.player_id)}
            className={`
              flex-1 py-3 rounded-xl font-semibold text-sm transition-all
              ${winnerId === player1.player_id
                ? 'bg-blue-500 text-white ring-2 ring-blue-400'
                : 'bg-poke-elevated text-poke-text hover:bg-poke-border'}
            `}
          >
            {displayName(player1.player_name)}
          </button>
          <button
            type="button"
            onClick={() => setWinnerId(player2.player_id)}
            className={`
              flex-1 py-3 rounded-xl font-semibold text-sm transition-all
              ${winnerId === player2.player_id
                ? 'bg-red-500 text-white ring-2 ring-red-400'
                : 'bg-poke-elevated text-poke-text hover:bg-poke-border'}
            `}
          >
            {displayName(player2.player_name)}
          </button>
        </div>
      </div>

      {/* Submit / Undo / Reset */}
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          disabled={!canSubmit || !hasAnyData}
          loading={submitting}
          onClick={handleSubmit}
        >
          {t('controls.submitGame', { game: state.current_game.game_number })}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          disabled={state.history.length === 0}
          onClick={() => dispatch({ type: 'undo' })}
        >
          {t('controls.undo')}
        </Button>
        <Button
          variant="danger"
          size="lg"
          onClick={() => {
            if (window.confirm(t('controls.resetConfirm'))) {
              dispatch({ type: 'reset_game' });
              setWinnerId(null);
            }
          }}
        >
          {t('controls.reset')}
        </Button>
      </div>

      {/* Producer Mode: Moment markers */}
      {producerMode && (
        <div className="flex flex-col gap-2 pt-2 border-t border-poke-border/30">
          <label className="text-xs text-poke-text-secondary uppercase tracking-wider font-semibold">
            {t('controls.markMoment')}
          </label>
          <input
            type="text"
            value={momentNote}
            onChange={(e) => setMomentNote(e.target.value)}
            maxLength={MOMENT_DESCRIPTION_MAX_LENGTH}
            placeholder={t('controls.notePlaceholder')}
            className="w-full px-3 py-2 rounded-lg bg-poke-elevated border border-poke-border text-sm text-poke-text placeholder:text-poke-text-muted"
          />
          <div className="flex flex-wrap gap-1">
            {MOMENT_TYPES.map((mt) => (
              <button
                key={mt.value}
                type="button"
                onClick={() => handleMoment(mt.value)}
                disabled={momentLimitReached}
                className="px-3 py-1.5 rounded-lg bg-poke-elevated text-xs font-semibold text-poke-text hover:bg-poke-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {mt.emoji} {t(`controls.momentType.${mt.value}`)}
              </button>
            ))}
          </div>
          {state.current_game.moments.length > 0 && (
            <div className="text-xs text-poke-text-secondary">
              {t('controls.momentsMarked', { count: state.current_game.moments.length })}
            </div>
          )}
          {momentLimitReached && (
            <div className="text-xs text-poke-text-secondary" role="status">
              {t('controls.momentLimitReached', { max: MOMENT_MAX_PER_GAME })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
