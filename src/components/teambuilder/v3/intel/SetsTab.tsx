'use client';

import { useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import SampleSetPicker from '../editor/SampleSetPicker';
import { useEditorContext } from '../editor/EditorContext';
import { useIntelSubject } from '../hooks/useIntelSubject';

export default function SetsTab() {
  const { state, dispatch } = useEditorContext();
  const { slot, set } = useIntelSubject();
  const t = useT(teambuilderIntelMessages);

  if (slot === null || !set?.species) {
    return (
      <div className="text-[11px] text-poke-text-muted text-center py-6">
        {t('sets.empty')}
      </div>
    );
  }

  return (
    <SampleSetPicker
      species={set.species}
      format={state.format}
      generation={state.generation}
      onApplySet={(appliedSet) => {
        if (slot === null) return;
        dispatch({
          type: 'SET_SLOT',
          slot,
          set: { ...set, ...appliedSet, species: set.species },
        });
      }}
      onApplyMove={(moveName) => {
        if (slot === null) return;
        const moves = [...(set.moves ?? [])];
        const emptyIdx = moves.findIndex((m) => !m);
        if (emptyIdx !== -1) moves[emptyIdx] = moveName;
        else moves[3] = moveName;
        dispatch({ type: 'UPDATE_SLOT', slot, patch: { moves } });
      }}
      onApplyItem={(item) => {
        if (slot === null) return;
        dispatch({ type: 'UPDATE_SLOT', slot, patch: { item } });
      }}
      onApplyAbility={(ability) => {
        if (slot === null) return;
        dispatch({ type: 'UPDATE_SLOT', slot, patch: { ability } });
      }}
    />
  );
}
