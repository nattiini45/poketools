'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import PokemonLink from '@/components/shared/PokemonLink';
import TypeBadge from '@/components/shared/TypeBadge';
import { useDataLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeNature, localizeStat } from '@/lib/pkmn/i18n/names/misc';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { PokemonSet, SetIssue } from '@/types/team';

/**
 * TeamCardPrimitive — a read-only card for a single Pokémon set.
 *
 * Shared primitive used across all team display surfaces:
 * - Teambuilder editor (3-column grid)
 * - Public team view (/teambuilder/share/[token])
 * - Library listing (/teambuilder/library)
 * - BroadcastTeam overlays
 * - Match highlight cards
 *
 * Design principles:
 * - Server-friendly: accepts pre-fetched data, no internal fetches
 * - Zero layout dependencies: renders in any container width
 * - Variants via `size` prop: 'sm' (broadcast strip), 'md' (default), 'lg' (modal)
 */

export interface TeamCardPrimitiveProps {
  /** The Pokémon set to display. Null renders an empty slot. */
  set: PokemonSet | null;
  /** Slot index (0–5), used for aria labels and click handlers */
  index: number;
  /** Pre-fetched type info for this species (e.g. ['Fire', 'Flying']) */
  types?: string[];
  /** Pre-fetched move type map { 'Flamethrower': 'Fire', ... } */
  moveTypes?: Record<string, string>;
  /** Validation issues for this specific slot (filtered by pokemon_index) */
  issues?: SetIssue[];
  /** Click handler — omitted in read-only surfaces */
  onClick?: () => void;
  /** Card size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show the sprite (hide for broadcast overlays that use custom art) */
  showSprite?: boolean;
  /** Show detailed stats (hide for compact views like broadcast strips) */
  showStats?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export default function TeamCardPrimitive({
  set,
  index,
  types = [],
  moveTypes = {},
  issues = [],
  onClick,
  size = 'md',
  showSprite = true,
  showStats = true,
  className = '',
}: TeamCardPrimitiveProps) {
  const t = useT(teambuilderIntelMessages);
  const dl = useDataLocale();

  if (!set) {
    return (
      <div
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
        aria-label={
          onClick
            ? t('teamCard.addToSlot', { n: index + 1 })
            : t('teamCard.emptySlot', { n: index + 1 })
        }
        className={[
          'border-2 border-dashed border-poke-border rounded-poke-lg',
          'flex flex-col items-center justify-center text-poke-text-muted',
          'transition-colors',
          onClick ? 'cursor-pointer hover:border-poke-border-focus hover:text-poke-blue' : '',
          size === 'sm' ? 'min-h-[80px] p-2 text-[10px]' : 'min-h-[180px] p-4 text-sm',
          className,
        ].filter(Boolean).join(' ')}
      >
        <svg
          width={size === 'sm' ? 20 : 32}
          height={size === 'sm' ? 20 : 32}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="opacity-40"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v8M8 12h8" />
        </svg>
        {size !== 'sm' && <span className="mt-1">{t('teamCard.add')}</span>}
      </div>
    );
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  const hasWarnings = issues.some((i) => i.severity === 'warning');

  // Size-specific class maps
  const spriteSize = size === 'sm' ? 40 : size === 'lg' ? 96 : 72;
  const nameClass = size === 'sm' ? 'text-[11px]' : 'text-sm font-bold';
  const badgeClass = size === 'sm' ? '!text-[7px] !px-1 !py-0 !min-w-[2.5rem]' : '!text-[9px] !px-1.5 !py-0 !min-w-[3.5rem]';
  const moveBadgeClass = size === 'sm' ? '!text-[6px] !px-0.5 !py-0 !min-w-[2rem]' : '!text-[7px] !px-1 !py-0 !min-w-[3rem]';
  const metaClass = size === 'sm' ? 'text-[9px]' : 'text-xs';
  const moveClass = size === 'sm' ? 'text-[9px]' : 'text-xs';

  // The nickname is the player's own text; only the species name is localized.
  const speciesName = localizeSpecies(set.species, dl);
  const displayName = set.name && set.name !== set.species
    ? t('teamCard.nickname', { nickname: set.name, species: speciesName })
    : speciesName;

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
      aria-label={t('teamCard.slotAria', { name: displayName, n: index + 1 })}
      className={[
        'rounded-poke-lg border relative overflow-hidden transition-colors',
        hasErrors ? 'border-red-500/40 bg-red-500/[0.03]' : hasWarnings ? 'border-yellow-500/30 bg-yellow-500/[0.02]' : 'border-poke-border bg-poke-card',
        onClick ? 'cursor-pointer hover:border-poke-border-focus hover:shadow-sm' : '',
        size === 'sm' ? 'p-2' : size === 'lg' ? 'p-5' : 'p-3',
        className,
      ].filter(Boolean).join(' ')}
    >
      {/* Validation indicator dot */}
      {hasErrors && (
        <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" title={t('teamCard.hasErrors')} />
      )}
      {!hasErrors && hasWarnings && (
        <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-yellow-500" title={t('teamCard.hasWarnings')} />
      )}

      {/* Header: sprite + name + types + item */}
      <div className="flex items-start gap-2">
        {showSprite && (
          <div className="shrink-0">
            <PokemonSprite name={set.species} size={spriteSize} animated />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            <PokemonLink name={set.species} className="inline-flex">
              <span className={`font-heading ${nameClass} text-poke-text-primary truncate`}>
                {displayName}
              </span>
            </PokemonLink>
          </div>
          {/* Type badges */}
          {types.length > 0 && (
            <div className="flex gap-0.5 mt-0.5">
              {types.map((t) => (
                <TypeBadge key={t} type={t} className={badgeClass} />
              ))}
            </div>
          )}
          {/* Item + Ability + Nature */}
          {!size?.startsWith('s') && (
            <div className={`flex gap-2 mt-1 ${metaClass} text-poke-text-muted flex-wrap`}>
              {set.item && (
                <span className="bg-poke-elevated px-1.5 py-0.5 rounded text-[10px]">
                  @ {localizeItem(set.item, dl)}
                </span>
              )}
              {set.ability && <span>{localizeAbility(set.ability, dl)}</span>}
              {set.nature && <span className="italic">{localizeNature(set.nature, dl)}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Moves with type badges */}
      {(set.moves?.filter(Boolean).length ?? 0) > 0 && (
        <div className={`${size === 'sm' ? 'mt-1' : 'mt-2'} grid grid-cols-2 gap-x-2 gap-y-0.5`}>
          {set.moves.filter(Boolean).map((move, i) => (
            <div key={i} className="flex items-center gap-1 min-w-0">
              {moveTypes[move] && (
                <TypeBadge type={moveTypes[move]} className={moveBadgeClass} />
              )}
              <span className={`${moveClass} text-poke-text-secondary truncate`}>
                {localizeMove(move, dl)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Stat bars — only in md/lg */}
      {showStats && size !== 'sm' && set.evs && (
        <div className="mt-2 pt-2 border-t border-poke-border/50">
          <div className={`flex gap-3 ${metaClass} text-poke-text-muted`}>
            {(['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const).map((stat) => (
              <span key={stat} className="flex flex-col items-center">
                <span className="text-[9px] uppercase opacity-60">{localizeStat(stat, dl, 'short')}</span>
                <span className="font-mono text-[10px]">{set.evs[stat]}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
