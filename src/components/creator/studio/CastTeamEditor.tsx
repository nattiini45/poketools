'use client';

import { useState, useCallback } from 'react';
import { useCastStudio } from './CastStudioContext';
import CastTeamStrip, { EMPTY_SET } from './CastTeamStrip';
import CastSetEditor from './CastSetEditor';
import type { PokemonSet } from '@/types/team';
import { useT } from '@/i18n/client';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';

interface CastTeamEditorProps {
  player: 1 | 2;
}

/**
 * CastTeamEditor — inline team editor for a single player in the Cast Studio.
 * Shows a 6-slot strip + expandable set editor. Standalone pickers (not TeambuilderContext).
 */
export default function CastTeamEditor({ player }: CastTeamEditorProps) {
  const { state, updatePlayer1Set, updatePlayer2Set, setFacing } = useCastStudio();
  const t = useT(creatorStudioMessages);

  const team = player === 1 ? state.player1Team : state.player2Team;
  const updateSet = player === 1 ? updatePlayer1Set : updatePlayer2Set;
  const label = player === 1
    ? (state.tracker.current_game.player1.player_name || t('team.player', { n: 1 }))
    : (state.tracker.current_game.player2.player_name || t('team.player', { n: 2 }));

  const [activeSlot, setActiveSlot] = useState<number | null>(null);

  const facingSlot = player === 1 ? state.facing.player1Slot : state.facing.player2Slot;

  const handleSlotClick = useCallback((index: number) => {
    if (activeSlot === index) {
      setActiveSlot(null);
    } else {
      setActiveSlot(index);
    }
  }, [activeSlot]);

  const _handleSlotDoubleClick = useCallback((index: number) => {
    // Double-click sets facing — wired in future via onDoubleClick prop
    if (player === 1) {
      setFacing(index, state.facing.player2Slot);
    } else {
      setFacing(state.facing.player1Slot, index);
    }
  }, [player, state.facing, setFacing]);

  const handleUpdate = useCallback((update: Partial<PokemonSet>) => {
    if (activeSlot === null) return;
    updateSet(activeSlot, update);
  }, [activeSlot, updateSet]);

  // Ensure team has at least 6 slots for display
  const paddedTeam: PokemonSet[] = Array.from({ length: 6 }, (_, i) =>
    team[i] ?? { ...EMPTY_SET }
  );

  // Get the current set for the active slot
  const activeSet = activeSlot !== null ? paddedTeam[activeSlot] : null;

  return (
    <div className="space-y-2">
      <CastTeamStrip
        team={paddedTeam}
        activeSlot={activeSlot}
        facingSlot={state.showFacing ? facingSlot : null}
        onSlotClick={handleSlotClick}
        label={label}
      />

      {activeSlot !== null && activeSet && (
        <CastSetEditor
          set={activeSet}
          slotIndex={activeSlot}
          generation={state.generation}
          format={state.format}
          onUpdate={handleUpdate}
          onClose={() => setActiveSlot(null)}
        />
      )}
    </div>
  );
}
