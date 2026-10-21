'use client';

import { useCallback, useState } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeBadge from '@/components/shared/TypeBadge';
import { Popover } from '@/components/ui';
import PokemonInfoCard from './PokemonInfoCard';
import MoveQuickSelect from './MoveQuickSelect';
import { useCasterPokemonInfo } from './CasterDataContext';
import type { TrackerSlot } from '@/types/broadcast';
import type { TrackerDispatchAction } from '@/lib/broadcast/tracker-reducer';
import { useDataLocale, useT } from '@/i18n/client';
import { broadcastCasterMessages } from '@/i18n/messages/broadcast-caster';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

interface TrackerPokemonSlotProps {
  slot: TrackerSlot;
  slotIndex: number;
  player: 1 | 2;
  dispatch: (action: TrackerDispatchAction) => void;
  /** Whether moves panel is available (Producer Mode) */
  showMoves?: boolean;
}

export default function TrackerPokemonSlot({
  slot,
  slotIndex,
  player,
  dispatch,
  showMoves = false,
}: TrackerPokemonSlotProps) {
  const t = useT(broadcastCasterMessages);
  const dataLocale = useDataLocale();
  const [movesExpanded, setMovesExpanded] = useState(false);
  const pokemonInfo = useCasterPokemonInfo(slot.pokemon_name, player);

  const handleTap = useCallback(() => {
    if (!slot.pokemon_name) return;
    if (!slot.was_brought) {
      dispatch({ type: 'mark_brought', player, slot: slotIndex });
    } else if (!slot.was_lead) {
      dispatch({ type: 'mark_lead', player, slot: slotIndex });
    } else {
      // Toggle brought off (cycles back)
      dispatch({ type: 'unmark_brought', player, slot: slotIndex });
    }
  }, [slot, slotIndex, player, dispatch]);

  const handleKo = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      if (!slot.pokemon_name) return;
      if (slot.was_koed) {
        dispatch({ type: 'unmark_ko', player, slot: slotIndex });
      } else {
        dispatch({ type: 'mark_ko', player, slot: slotIndex });
      }
    },
    [slot, slotIndex, player, dispatch]
  );

  const handleKoDeal = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      dispatch({ type: 'increment_ko_dealt', player, slot: slotIndex });
    },
    [slotIndex, player, dispatch]
  );

  // Empty slot
  if (!slot.pokemon_name) {
    return (
      <div className="relative flex items-center justify-center w-full min-h-[72px] rounded-xl border-2 border-dashed border-poke-border/40 bg-poke-surface/30 text-poke-text-muted text-xs">
        {t('tracker.emptySlot')}
      </div>
    );
  }

  // State-dependent styling
  const borderColor = slot.was_koed
    ? 'border-red-500/70'
    : slot.was_lead
      ? 'border-yellow-400/70'
      : slot.was_brought
        ? 'border-emerald-400/70'
        : 'border-poke-border/50';

  const bgColor = slot.was_koed
    ? 'bg-red-950/30'
    : slot.was_lead
      ? 'bg-yellow-950/20'
      : slot.was_brought
        ? 'bg-emerald-950/20'
        : 'bg-poke-surface/50';

  const opacity = slot.was_koed ? 'opacity-60' : '';

  // Popover side: P1 shows on right, P2 shows on left
  const popoverSide = player === 1 ? 'right' : 'left';

  const slotContent = (
    <button
      type="button"
      onClick={handleTap}
      className={`
        relative flex items-center gap-3 w-full min-h-[72px] px-3 py-2
        rounded-xl border-2 ${borderColor} ${bgColor} ${opacity}
        transition-all duration-150 ease-out
        hover:scale-[1.02] active:scale-[0.98]
        touch-manipulation select-none cursor-pointer
      `}
    >
      {/* Sprite */}
      <div className="relative flex-shrink-0">
        <PokemonSprite name={slot.pokemon_name} size={48} animated />
        {/* Status badges */}
        {slot.was_lead && (
          <span className="absolute -top-1 -left-1 text-yellow-400 text-sm" title={t('tracker.lead')}>
            ★
          </span>
        )}
        {slot.was_koed && (
          <span className="absolute -bottom-1 -right-1 text-red-400 text-sm" title={t('tracker.koed')}>
            ✕
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 text-left min-w-0">
        <div className="text-sm font-semibold text-poke-text truncate">
          {localizeSpecies(slot.pokemon_name, dataLocale)}
        </div>

        {/* Type badges (F5) */}
        {pokemonInfo?.types && pokemonInfo.types.length > 0 && (
          <div className="flex items-center gap-0.5 mt-0.5">
            {pokemonInfo.types.map((type) => (
              <TypeBadge key={type} type={type} className="text-[9px] px-1 py-0" />
            ))}
            {/* Usage badges (F8) */}
            {pokemonInfo.usagePct !== null && pokemonInfo.usagePct < 1 && (
              <span className="ml-1 px-1 py-0 rounded text-[8px] font-bold uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30">
                {t('tracker.ultraRare')}
              </span>
            )}
            {pokemonInfo.usagePct !== null && pokemonInfo.usagePct >= 1 && pokemonInfo.usagePct < 5 && (
              <span className="ml-1 px-1 py-0 rounded text-[8px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {t('tracker.spicy')}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-poke-text-secondary mt-0.5">
          {slot.was_brought && (
            <span className="text-emerald-400">{t('tracker.brought')}</span>
          )}
          {slot.kos_dealt > 0 && (
            <span className="text-orange-400">{t('tracker.kos', { count: slot.kos_dealt })}</span>
          )}
          {slot.moves_used.length > 0 && (
            <span>{t('tracker.moveCount', { count: slot.moves_used.length })}</span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={handleKo}
          className={`
            px-2 py-1 rounded-lg text-xs font-bold transition-colors
            ${slot.was_koed
              ? 'bg-red-500 text-white'
              : 'bg-poke-elevated text-poke-text-secondary hover:bg-red-500/20 hover:text-red-400'}
          `}
          title={slot.was_koed ? t('tracker.undoKo') : t('tracker.markKoed')}
        >
          KO
        </button>
        <button
          type="button"
          onClick={handleKoDeal}
          className="px-2 py-1 rounded-lg text-xs font-bold bg-poke-elevated text-poke-text-secondary hover:bg-orange-500/20 hover:text-orange-400 transition-colors"
          title={t('tracker.recordKoDealt')}
        >
          +KO
        </button>
      </div>
    </button>
  );

  return (
    <div className="relative">
      {pokemonInfo ? (
        <Popover
          content={<PokemonInfoCard info={pokemonInfo} />}
          trigger="hover"
          side={popoverSide}
          maxWidth={320}
        >
          {slotContent}
        </Popover>
      ) : (
        slotContent
      )}

      {/* Expandable moves section (Producer Mode) — F31 MoveQuickSelect */}
      {showMoves && slot.was_brought && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setMovesExpanded(!movesExpanded)}
            className="text-xs text-poke-text-secondary hover:text-poke-text transition-colors px-2"
          >
            {movesExpanded ? '▾' : '▸'} {t('tracker.moves')}{' '}
            {slot.moves_used.length > 0 && `(${slot.moves_used.length})`}
          </button>
          {movesExpanded && (
            <MoveQuickSelect
              pokemonName={slot.pokemon_name!}
              player={player}
              slotIndex={slotIndex}
              movesUsed={slot.moves_used}
              dispatch={dispatch}
            />
          )}
        </div>
      )}
    </div>
  );
}
