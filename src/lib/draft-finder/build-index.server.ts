/**
 * Builds the draft search index. Server only: reads Gen 9 data
 * from `@pkmn/data` (`new Generations(Dex)` singleton of `src/lib/pkmn/dex.ts`).
 *
 * - Entries come only from `getListEntries` (line ids + league overrides); the list is authoritative for
 *   the chain, which is never derived from dex prevo/evos (Ursaluna-Bloodmoon has no prevo).
 * - Species: `entry.species_ids` first, else `toID(name)` checked against the dex (`toID` of
 *   `src/lib/pkmn/i18n/id.ts` strips accents, so the NFC-stored "Flabébé" resolves to `flabebe`).
 * - Moves: the full Gen 9 learnable set of each species, Paldea restriction; abilities: all slots incl.
 *   hidden; stats: base stats. `moveNames` / `abilityNames` are the canonical English names.
 * - A stage that fails to resolve is reported in `warnings` (and logged); its line is still emitted with
 *   empty data, so the wall stays complete.
 */
import 'server-only';

import type { PointBuyListEntry } from '@/types/point-buy';
import { lineIdOfEntry } from '@/lib/draft/line-identity';
import { getGeneration } from '@/lib/pkmn/dex';
import { toID } from '@/lib/pkmn/i18n/id';
import { INDEX_SCHEMA_VERSION, isTypeId, type DraftSearchIndex, type IndexStage, type StatTuple, type TypeId } from './index-types';

interface RawStage {
  stage: 1 | 2 | 3;
  speciesId: string;
  name: string;
  types: TypeId[];
  abilityIds: string[];
  stats: StatTuple;
  moveIds: string[];
}

type Gen = ReturnType<typeof getGeneration>;

const NO_STATS: StatTuple = [0, 0, 0, 0, 0, 0];

function stageNames(entry: PointBuyListEntry): { stage: 1 | 2 | 3; name: string; id: string | null }[] {
  const ids = entry.species_ids;
  const stages: { stage: 1 | 2 | 3; name: string; id: string | null }[] = [
    { stage: 1, name: entry.base_pokemon, id: ids?.base || null },
    { stage: 2, name: entry.stage2_pokemon, id: ids?.stage2 || null },
  ];
  if (entry.stage3_pokemon) stages.push({ stage: 3, name: entry.stage3_pokemon, id: ids?.stage3 || null });
  return stages;
}

async function resolveStage(
  gen: Gen,
  s: { stage: 1 | 2 | 3; name: string; id: string | null },
  lineId: string,
  warnings: string[],
): Promise<RawStage> {
  const nfcName = s.name.normalize('NFC');
  const species = (s.id ? gen.species.get(s.id) : undefined) ?? gen.species.get(toID(nfcName));
  if (!species) {
    warnings.push(`${lineId}: stage ${s.stage} "${nfcName}" not found in the Gen 9 dex`);
    return { stage: s.stage, speciesId: s.id ?? toID(nfcName), name: nfcName, types: [], abilityIds: [], stats: [...NO_STATS], moveIds: [] };
  }

  const learnable = await gen.learnsets.learnable(species.name, 'Paldea');
  if (!learnable) warnings.push(`${lineId}: stage ${s.stage} "${species.name}" has no Gen 9 learnset`);

  const abilityIds: string[] = [];
  for (const abilityName of Object.values(species.abilities)) {
    if (!abilityName) continue;
    const ability = gen.abilities.get(abilityName);
    if (ability && !abilityIds.includes(ability.id)) abilityIds.push(ability.id);
  }

  const types = species.types.filter((t): t is TypeId => isTypeId(t));
  const b = species.baseStats;
  return {
    stage: s.stage,
    speciesId: species.id,
    name: species.name.normalize('NFC'),
    types,
    abilityIds,
    stats: [b.hp, b.atk, b.def, b.spa, b.spd, b.spe],
    moveIds: Object.keys(learnable ?? {}),
  };
}

export async function buildDraftSearchIndex(
  listVersionId: string,
  entries: readonly PointBuyListEntry[],
): Promise<{ index: DraftSearchIndex; warnings: string[] }> {
  const gen = getGeneration(9);
  const warnings: string[] = [];
  const sorted = [...entries].sort((a, b) => a.line_number - b.line_number);

  const rawLines = await Promise.all(
    sorted.map(async (entry) => {
      const lineId = lineIdOfEntry(entry);
      const stages = await Promise.all(stageNames(entry).map((s) => resolveStage(gen, s, lineId, warnings)));
      return { lineId, entryId: entry.id, price: entry.price, stages };
    }),
  );

  const moveSet = new Set<string>();
  const abilitySet = new Set<string>();
  for (const line of rawLines) {
    for (const s of line.stages) {
      for (const m of s.moveIds) moveSet.add(m);
      for (const a of s.abilityIds) abilitySet.add(a);
    }
  }
  const moves = [...moveSet].sort();
  const abilities = [...abilitySet].sort();
  const moveIdx = new Map(moves.map((id, i) => [id, i]));
  const abilityIdx = new Map(abilities.map((id, i) => [id, i]));

  const lines = rawLines.map((line) => ({
    lineId: line.lineId,
    entryId: line.entryId,
    price: line.price,
    stages: line.stages.map(
      (s): IndexStage => ({
        stage: s.stage,
        speciesId: s.speciesId,
        name: s.name,
        types: s.types,
        abilities: s.abilityIds.map((id) => abilityIdx.get(id) ?? -1).filter((i) => i >= 0),
        stats: s.stats,
        moves: s.moveIds
          .map((id) => moveIdx.get(id) ?? -1)
          .filter((i) => i >= 0)
          .sort((a, b) => a - b),
      }),
    ),
  }));

  for (const w of warnings) console.error(`[draft-finder] ${w}`);

  return {
    index: {
      v: INDEX_SCHEMA_VERSION,
      listVersionId,
      moves,
      moveNames: moves.map((id) => gen.moves.get(id)?.name ?? id),
      abilities,
      abilityNames: abilities.map((id) => gen.abilities.get(id)?.name ?? id),
      lines,
    },
    warnings,
  };
}
