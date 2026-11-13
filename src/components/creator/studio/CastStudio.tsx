'use client';

import { useCallback, useState } from 'react';
import { useCastStudio } from './CastStudioContext';
import CastToolbar from './CastToolbar';
import MatchSelector from './MatchSelector';
import CastTeamEditor from './CastTeamEditor';
import TrackerTeamColumn from '@/components/broadcast/tracker/TrackerTeamColumn';
import TrackerScorebar from '@/components/broadcast/tracker/TrackerScorebar';
import TrackerControls from '@/components/broadcast/tracker/TrackerControls';
import type { GameSummary } from '@/types/match';
import { buildGamePayload } from '@/lib/broadcast/tracker-reducer';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsMatches } from '@/i18n/messages/errors';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';
import { soloPlaceholderOf } from '@/lib/broadcast/solo-defaults';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';

/** A failure to show: the API's error when it sent one, else the local message key. */
interface StudioError {
  res: ApiErrorLike | null;
  fallback: 'selectMatchFirst' | 'submitFailed' | 'networkError';
}

/**
 * CastStudio — the main broadcast workspace.
 * Replaces the old BattleTracker with structured match selection,
 * persistent sessions, and full team editing support.
 */
export default function CastStudio() {
  const { state, dispatch, dispatchTracker } = useCastStudio();
  const { tracker, facing, showFacing } = state;
  const t = useT(creatorStudioMessages);
  const errorText = useApiErrorText(errorsMatches);
  const [error, setError] = useState<StudioError | null>(null);

  /**
   * Stored English placeholders ('Me'/'Opponent') read in the viewer's
   * language; an empty name or the stored 'Player {n}' sentinel
   * (CastStudioContext) reads as the localized 'Player {n}'; real names pass
   * through.
   */
  const displayName = (name: string, slot: 1 | 2): string => {
    if (!name || name === `Player ${slot}`) return t('team.player', { n: slot });
    const placeholder = soloPlaceholderOf(name);
    if (placeholder === 'me') return t('solo.me');
    if (placeholder === 'opponent') return t('solo.opponent');
    return name;
  };

  const handleSubmitGame = useCallback(
    async (payload: ReturnType<typeof buildGamePayload>) => {
      setError(null);

      if (!payload.match_id) {
        setError({ res: null, fallback: 'selectMatchFirst' });
        return;
      }

      try {
        const res = await fetch('/api/manual-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.success) {
          setError({ res: toApiErrorLike(data), fallback: 'submitFailed' });
          return;
        }

        const game: GameSummary = {
          id: data.data?.game_id ?? crypto.randomUUID(),
          game_number: tracker.current_game.game_number,
          winner_id: payload.winner_id,
          replay_url: '',
          source: 'manual',
          stats_locked: false,
        };

        dispatchTracker({ type: 'submit_game', game });
      } catch (err) {
        setError({ res: toApiErrorLike(err), fallback: 'networkError' });
      }
    },
    [dispatchTracker, tracker.current_game.game_number],
  );

  return (
    <div className="space-y-4">
      {/* Toolbar: session name, mode, format, facing toggle, tools link, save indicator */}
      <CastToolbar />

      {/* Match Selector: cascading league → tournament → round → match */}
      {(!state.matchId || state.matchId === '') && <MatchSelector />}

      {/* Match info bar (when a match is selected) */}
      {state.matchId && state.matchId !== '' && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-poke-lg border border-hairline bg-surface px-4 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-heading text-subtitle text-fg">
              {displayName(tracker.current_game.player1.player_name, 1)}
            </span>
            <span className="text-body text-fg-muted">{t('studio.versus')}</span>
            <span className="font-heading text-subtitle text-fg">
              {displayName(tracker.current_game.player2.player_name, 2)}
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => dispatch({ type: 'set_match', matchId: '', tournamentId: state.tournamentId, seasonId: state.seasonId })}
          >
            {t('studio.changeMatch')}
          </Button>
        </div>
      )}

      {error && (
        <Alert variant="error" className="text-loss">
          {error.res && (error.res.error || error.res.code) ? errorText(error.res) : t(`studio.${error.fallback}`)}
        </Alert>
      )}

      {/* Score bar */}
      <TrackerScorebar
        state={tracker}
        dispatch={dispatchTracker}
      />

      {/* Two-column team tracker */}
      <div className="grid grid-cols-2 gap-4">
        <TrackerTeamColumn
          playerState={tracker.current_game.player1}
          player={1}
          dispatch={dispatchTracker}
        />
        <TrackerTeamColumn
          playerState={tracker.current_game.player2}
          player={2}
          dispatch={dispatchTracker}
        />
      </div>

      {/* Facing indicator (when enabled) */}
      {showFacing && facing.player1Slot !== null && facing.player2Slot !== null && (
        <div className="text-center font-heading text-caption text-accent-ink">
          {t('studio.facingSlots', { slot1: facing.player1Slot + 1, slot2: facing.player2Slot + 1 })}
        </div>
      )}

      {/* Inline Team Editors */}
      <div className="grid grid-cols-2 gap-4">
        <CastTeamEditor player={1} />
        <CastTeamEditor player={2} />
      </div>

      {/* Controls: turn counter, undo, submit */}
      <TrackerControls
        state={tracker}
        dispatch={dispatchTracker}
        onSubmitGame={handleSubmitGame}
      />
    </div>
  );
}
