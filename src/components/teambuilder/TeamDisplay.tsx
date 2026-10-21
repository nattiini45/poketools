'use client';

import { useState, useEffect } from 'react';
import { TeamCardPrimitive } from './v3/primitives';
import LegalityBadge from './LegalityBadge';
import type { PokemonSet, TeamValidationResult } from '@/types/team';

/* ─── Types ────────────────────────────────────────────────────────── */

interface SpeciesInfo {
  name: string;
  types: string[];
  baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

interface TeamDisplayProps {
  pokemon: PokemonSet[];
  validation?: TeamValidationResult | null;
  onSlotClick?: (index: number) => void;
  readOnly?: boolean;
}

/* ─── Hooks ────────────────────────────────────────────────────────── */

function useSpeciesInfo(pokemon: PokemonSet[]) {
  const [info, setInfo] = useState<Record<string, SpeciesInfo>>({});

  useEffect(() => {
    const species = pokemon.map((p) => p.species).filter(Boolean);
    if (species.length === 0) return;
    const unique = [...new Set(species)];
    const toFetch = unique.filter((s) => !info[s]);
    if (toFetch.length === 0) return;

    let cancelled = false;
    fetch(`/api/pkmn/species-info?names=${toFetch.map(encodeURIComponent).join(',')}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json.success) return;
        const newInfo: Record<string, SpeciesInfo> = { ...info };
        for (const s of json.data as SpeciesInfo[]) {
          newInfo[s.name] = s;
        }
        setInfo(newInfo);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pokemon]); // eslint-disable-line react-hooks/exhaustive-deps

  return info;
}

function useMoveTypes(pokemon: PokemonSet[]) {
  const [moveTypes, setMoveTypes] = useState<Record<string, string>>({});

  useEffect(() => {
    const allMoves = new Set<string>();
    for (const p of pokemon) {
      for (const m of p.moves ?? []) {
        if (m && !moveTypes[m]) allMoves.add(m);
      }
    }
    if (allMoves.size === 0) return;

    let cancelled = false;
    const movesArr = [...allMoves].slice(0, 24);
    Promise.all(
      movesArr.map((m) =>
        fetch(`/api/pkmn/search?type=move&rich=1&q=${encodeURIComponent(m)}`)
          .then((r) => r.json())
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      const newTypes: Record<string, string> = { ...moveTypes };
      for (let i = 0; i < results.length; i++) {
        const json = results[i];
        if (!json?.success || !json.data?.length) continue;
        const exact = (json.data as { name: string; type: string }[]).find(
          (d) => d.name.toLowerCase() === movesArr[i].toLowerCase(),
        );
        if (exact) newTypes[movesArr[i]] = exact.type;
      }
      setMoveTypes(newTypes);
    });
    return () => { cancelled = true; };
  }, [pokemon]); // eslint-disable-line react-hooks/exhaustive-deps

  return moveTypes;
}

/* ─── TeamDisplay ──────────────────────────────────────────────────── */

export default function TeamDisplay({
  pokemon,
  validation,
  onSlotClick,
  readOnly,
}: TeamDisplayProps) {
  const slots = Array.from({ length: 6 }, (_, i) => pokemon[i] ?? null);
  const speciesInfo = useSpeciesInfo(pokemon);
  const moveTypes = useMoveTypes(pokemon);

  return (
    <div>
      {/* Team-level validation */}
      {validation && (
        <div className="mb-3">
          <LegalityBadge validation={validation} />
        </div>
      )}

      {/* 6-slot grid — delegates to TeamCardPrimitive */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {slots.map((set, i) => (
          <TeamCardPrimitive
            key={i}
            set={set}
            index={i}
            types={set ? speciesInfo[set.species]?.types : undefined}
            moveTypes={moveTypes}
            issues={validation?.issues.filter((iss) => iss.pokemon_index === i)}
            onClick={!readOnly && onSlotClick ? () => onSlotClick(i) : undefined}
            showStats
          />
        ))}
      </div>
    </div>
  );
}
