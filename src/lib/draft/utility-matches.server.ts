/**
 * Stage-specific utility matches of a draft line. Server only:
 * reads Gen 9 learnsets and abilities from `@pkmn/data` (the `'Paldea'`
 * restriction of `src/lib/pkmn/dex.ts`). The client finder derives the same
 * result from the search index; this module exists so the server can report
 * and test it (acceptance #3: a member one form learns, e.g. a regional final stage, matches only that line).
 */
// No `import 'server-only'`: the reconciliation CLI (scripts/draft/reconcile-point-buy.ts) runs this under tsx,
// where that package throws. `@pkmn/data` keeps it out of client code (client-bundle scan + AGENTS.md).

import { getGeneration } from '@/lib/pkmn/dex';
import { lineIdOfEntry, type LineId } from '@/lib/draft/line-identity';
import { UTILITY_CATEGORIES, type UtilityKey } from '@/lib/draft/utility-categories';
import { toID } from '@/lib/pkmn/i18n/id';

export interface LineUtilityMatch {
  key: UtilityKey;
  /** The earliest stage at which this member is available. */
  stage: 1 | 2 | 3;
  via: { kind: 'move' | 'ability'; id: string };
}

export interface UtilityLineInput {
  line_id?: LineId;
  base_pokemon: string;
  stage2_pokemon: string;
  stage3_pokemon: string | null;
  species_ids?: { base: string; stage2: string; stage3: string | null } | null;
}

interface StageData {
  stage: 1 | 2 | 3;
  moves: ReadonlySet<string>;
  abilities: ReadonlySet<string>;
}

async function stageData(name: string, stage: 1 | 2 | 3, speciesId: string | null): Promise<StageData | null> {
  const gen = getGeneration(9);
  // Same fold as draft-finder/build-index.server.ts: species_ids first, else the app-wide toID of the NFC name.
  const species = gen.species.get(speciesId ?? toID(name.normalize('NFC')));
  if (!species) return null;
  const learnable = await gen.learnsets.learnable(species.name, 'Paldea');
  const abilities = new Set<string>();
  for (const ability of Object.values(species.abilities)) {
    if (!ability) continue;
    const a = gen.abilities.get(ability);
    if (a) abilities.add(a.id);
  }
  return { stage, moves: new Set(Object.keys(learnable ?? {})), abilities };
}

/**
 * Every (category, member) the line has, at the earliest stage where the move is
 * learnable or the species has the ability (learnsets are not monotonic, so each
 * stage is checked). Banned move ids never match.
 */
export async function computeLineUtility(
  entry: UtilityLineInput,
  banned: ReadonlySet<string>,
): Promise<LineUtilityMatch[]> {
  const ids = entry.species_ids ?? null;
  const stages: { name: string; stage: 1 | 2 | 3; id: string | null }[] = [
    { name: entry.base_pokemon, stage: 1, id: ids?.base ?? null },
    { name: entry.stage2_pokemon, stage: 2, id: ids?.stage2 ?? null },
  ];
  if (entry.stage3_pokemon) stages.push({ name: entry.stage3_pokemon, stage: 3, id: ids?.stage3 ?? null });

  const data = (await Promise.all(stages.map((s) => stageData(s.name, s.stage, s.id)))).filter(
    (d): d is StageData => d !== null,
  );

  const matches: LineUtilityMatch[] = [];
  for (const def of UTILITY_CATEGORIES) {
    for (const member of def.members) {
      if (member.kind === 'move' && banned.has(member.id)) continue;
      const first = data.find((d) => (member.kind === 'move' ? d.moves : d.abilities).has(member.id));
      if (first) matches.push({ key: def.key, stage: first.stage, via: { kind: member.kind, id: member.id } });
    }
  }
  return matches;
}

/** `computeLineUtility` for many lines, keyed by line id. */
export async function computeListUtility(
  entries: readonly UtilityLineInput[],
  banned: ReadonlySet<string>,
): Promise<Map<LineId, LineUtilityMatch[]>> {
  const out = new Map<LineId, LineUtilityMatch[]>();
  for (const entry of entries) {
    out.set(entry.line_id ?? lineIdOfEntry(entry), await computeLineUtility(entry, banned));
  }
  return out;
}
