'use client';

/**
 * Localized line labels and form names for the token centre, through the
 * pkmn name layer (`localizeLineLabel` is the only line label, critique S13).
 * Pokémon names follow the data locale ("keep Pokémon terms in English").
 * An unknown line renders its id.
 */
import { useMemo } from 'react';
import { useDataLocale } from '@/i18n/client';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import { pkmnNameResolver } from '@/lib/draft-finder/names-port';
import type { LineId } from '@/types/draft-queue';
import { catalogById, lineNameParts } from './token-view';

export interface LineText {
  label(lineId: LineId): string;
  /** A canonical English species name in the data locale. */
  species(englishName: string): string;
}

export function useLineText(catalog: DraftLineCatalog): LineText {
  const dl = useDataLocale();
  const byId = useMemo(() => catalogById(catalog), [catalog]);
  return useMemo<LineText>(
    () => ({
      label(lineId) {
        const parts = lineNameParts(byId.get(lineId));
        return parts ? pkmnNameResolver.lineLabel(parts.base, parts.stage3, dl) : lineId;
      },
      species(englishName) {
        return pkmnNameResolver.species(englishName, dl);
      },
    }),
    [byId, dl],
  );
}
