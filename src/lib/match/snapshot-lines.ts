/**
 * Which point-buy line a match evolution snapshot belongs to, keyed by the
 * stable draft line id.
 *
 * The list is keyed by `line_id`, never by `base_pokemon`: two lines can share
 * a base (Oshawott → Samurott and Oshawott → Samurott-Hisui), and a base-keyed
 * map silently kept only one of them.
 *
 * A snapshot that carries its own `line_id` is looked up exactly. Snapshots
 * written before that column exists are resolved from their base: a unique
 * base is exact; for a shared base the line whose final (or second) stage is
 * the form used in the match wins, else the first line of the list.
 */
import { lineIdOfEntry, type LineId } from '@/lib/draft/line-identity';
import type { MatchEvolutionSnapshot } from '@/types/evolution';
import type { PointBuyListEntry } from '@/types/point-buy';

/** A snapshot, with the `line_id` column once the snapshot table stores it. */
export type LineSnapshot = Pick<MatchEvolutionSnapshot, 'id' | 'base_pokemon' | 'species_at_match'> & {
  line_id?: LineId | null;
};

function pickByForm(candidates: readonly PointBuyListEntry[], form: string): PointBuyListEntry {
  return (
    candidates.find((c) => c.stage3_pokemon === form) ??
    candidates.find((c) => c.stage2_pokemon === form && c.stage3_pokemon === null) ??
    candidates[0]
  );
}

/** Map of snapshot id → its point-buy list entry. Snapshots without a matching line are absent. */
export function resolveSnapshotEntries(
  snapshots: readonly LineSnapshot[],
  entries: readonly PointBuyListEntry[],
): Map<string, PointBuyListEntry> {
  const byLine = new Map<LineId, PointBuyListEntry>();
  const byBase = new Map<string, PointBuyListEntry[]>();
  for (const entry of entries) {
    byLine.set(lineIdOfEntry(entry), entry);
    const list = byBase.get(entry.base_pokemon);
    if (list) list.push(entry);
    else byBase.set(entry.base_pokemon, [entry]);
  }

  const out = new Map<string, PointBuyListEntry>();
  for (const snapshot of snapshots) {
    const exact = snapshot.line_id ? byLine.get(snapshot.line_id) : undefined;
    if (exact) {
      out.set(snapshot.id, exact);
      continue;
    }
    const candidates = byBase.get(snapshot.base_pokemon);
    if (!candidates || candidates.length === 0) continue;
    out.set(snapshot.id, candidates.length === 1 ? candidates[0] : pickByForm(candidates, snapshot.species_at_match));
  }
  return out;
}
