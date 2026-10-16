'use client';

import { useState, useCallback } from 'react';
import MovePicker from './MovePicker';
import { useDataLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { useEditorContext } from '../editor/EditorContext';
import type { PokemonSet } from '@/types/team';

interface MoveSectionProps {
  slot: number;
  set: PokemonSet;
}

/**
 * MoveSection — four move slot chips. Clicking a chip opens the full
 * MovePicker learnset (with usage%, filters, sorting) below. Selecting a
 * move fills the active chip and advances to the next empty one.
 */
export default function MoveSection({ slot, set }: MoveSectionProps) {
  const { state, dispatch } = useEditorContext();
  const t = useT(teambuilderIntelMessages);
  const dl = useDataLocale();
  const [activeMoveSlot, setActiveMoveSlot] = useState<number | null>(null);
  const [trackedSlot, setTrackedSlot] = useState(slot);

  // Reset picker when switching team slots (render-time adjustment)
  if (slot !== trackedSlot) {
    setTrackedSlot(slot);
    setActiveMoveSlot(null);
  }

  const moves: string[] = Array.from({ length: 4 }, (_, i) => set.moves[i] ?? '');

  const handleSelectMove = useCallback(
    (moveName: string) => {
      if (activeMoveSlot === null) return;
      const newMoves = [...moves];
      newMoves[activeMoveSlot] = moveName;
      dispatch({ type: 'UPDATE_SLOT', slot, patch: { moves: newMoves } });
      // Advance to the next empty move slot, or close when the set is full
      const nextEmpty = newMoves.findIndex((m, i) => !m && i !== activeMoveSlot);
      setActiveMoveSlot(nextEmpty !== -1 ? nextEmpty : null);
    },
    [activeMoveSlot, moves, dispatch, slot],
  );

  const handleClearMove = useCallback(
    (i: number) => {
      const newMoves = [...moves];
      newMoves[i] = '';
      dispatch({ type: 'UPDATE_SLOT', slot, patch: { moves: newMoves } });
    },
    [moves, dispatch, slot],
  );

  return (
    <div>
      <h3 className="text-[10px] text-poke-text-muted uppercase tracking-wide mb-2">{t('moveSection.title')}</h3>

      {/* 4 move slot chips */}
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        {moves.map((move, i) => (
          <div key={i} className="relative">
            <button
              onClick={() => {
                if (state.locked) return;
                setActiveMoveSlot(activeMoveSlot === i ? null : i);
              }}
              disabled={state.locked}
              className={[
                'w-full px-2 py-1.5 text-xs rounded border text-left transition-colors pr-6',
                activeMoveSlot === i
                  ? 'border-poke-blue/60 bg-poke-blue/10 text-poke-text-primary'
                  : move
                    ? 'bg-poke-surface border-poke-border text-poke-text-primary hover:border-poke-blue/40'
                    : 'border-dashed border-poke-border text-poke-text-muted hover:border-poke-blue/40',
                state.locked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
              ].join(' ')}
            >
              {move ? (
                localizeMove(move, dl)
              ) : (
                <span className="opacity-50">{t('moveSection.addMove', { n: i + 1 })}</span>
              )}
            </button>

            {/* Clear button */}
            {move && !state.locked && (
              <button
                onClick={() => handleClearMove(i)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-poke-text-muted hover:text-poke-danger transition-colors"
                aria-label={t('moveSection.clearMove', { n: i + 1 })}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Learnset picker for the active move slot */}
      {activeMoveSlot !== null && !state.locked && (
        <MovePicker
          species={set.species}
          moveIndex={activeMoveSlot}
          currentMoves={moves}
          onSelect={handleSelectMove}
          onClose={() => setActiveMoveSlot(null)}
        />
      )}
    </div>
  );
}
