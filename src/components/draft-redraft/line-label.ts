/**
 * Localized line label for a line id ("Teddiursa → Ursaluna"), through the
 * pkmn layer (`NameResolver.lineLabel`). Falls back to the raw id when the
 * catalog does not know the line. Client-safe.
 */
import type { Locale } from '@/i18n/config';
import type { DraftLineCatalog, DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { pkmnNameResolver, type NameResolver } from '@/lib/draft-finder/names-port';
import type { LineId } from '@/types/draft-queue';

export type LineLabelFn = (lineId: LineId) => string;

export function entriesById(catalog: DraftLineCatalog): Map<LineId, DraftLineCatalogEntry> {
  return new Map(catalog.lines.map((l) => [l.lineId, l]));
}

export function makeLineLabel(
  byId: ReadonlyMap<LineId, DraftLineCatalogEntry>,
  dl: Locale,
  names: NameResolver = pkmnNameResolver,
): LineLabelFn {
  return (lineId) => {
    const entry = byId.get(lineId);
    return entry ? names.lineLabel(entry.stages[0].name, entry.stages[2]?.name ?? null, dl) : lineId;
  };
}

/**
 * The pre-evolutions of a line ("Dratini/Dragonair"): every stage before the final
 * one, localized through the pkmn layer and joined by "/". The `locked.cosmog`
 * text names them. Falls back to the raw id when the catalog does not know the line.
 */
export function makePreEvolutionLabel(
  byId: ReadonlyMap<LineId, DraftLineCatalogEntry>,
  dl: Locale,
  names: NameResolver = pkmnNameResolver,
): LineLabelFn {
  return (lineId) => {
    const entry = byId.get(lineId);
    if (!entry) return lineId;
    const early = entry.stages.length > 1 ? entry.stages.slice(0, -1) : entry.stages;
    return early.map((s) => names.species(s.name, dl)).join('/');
  };
}
