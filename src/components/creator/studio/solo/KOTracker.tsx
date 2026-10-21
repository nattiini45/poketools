'use client';

import { useCastStudio } from '../CastStudioContext';
import KOStatCard from './KOStatCard';
import { useT } from '@/i18n/client';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';

/**
 * KOTracker — tracks per-Pokémon KOs and deaths via the persisted TrackerState.
 * All mutations dispatch through the tracker reducer, which auto-saves to the
 * database and is readable by overlay components that poll the session.
 */
export default function KOTracker() {
  const { state, dispatchTracker } = useCastStudio();
  const t = useT(creatorStudioMessages);
  const slots = state.tracker.current_game.player1.slots;

  const filledSlots = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.pokemon_name !== null);

  if (filledSlots.length === 0) {
    return (
      <div className="rounded-poke-lg border border-poke-border bg-poke-surface p-6 text-center">
        <p className="text-sm text-poke-text-secondary">
          {t('solo.koEmpty')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-heading text-sm font-bold text-poke-text-secondary uppercase tracking-wide">
          {t('solo.koTracker')}
        </h3>
        <button
          onClick={() => dispatchTracker({ type: 'reset_game' })}
          className="text-xs text-poke-text-secondary hover:text-poke-accent transition-colors"
        >
          {t('solo.resetGame')}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {filledSlots.map(({ slot, index }) => (
          <KOStatCard
            key={`${slot.pokemon_name}-${index}`}
            species={slot.pokemon_name!}
            kosDealt={slot.kos_dealt}
            wasKoed={slot.was_koed}
            isActive={false}
            onIncrementKO={() => dispatchTracker({ type: 'increment_ko_dealt', player: 1, slot: index })}
            onDecrementKO={() => dispatchTracker({ type: 'decrement_ko_dealt', player: 1, slot: index })}
            onToggleKoed={() => dispatchTracker(
              slot.was_koed
                ? { type: 'unmark_ko', player: 1, slot: index }
                : { type: 'mark_ko', player: 1, slot: index },
            )}
          />
        ))}
      </div>
    </div>
  );
}
