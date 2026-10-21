/**
 * Measured asset defects that bar a GLB from casting (D35 Pokémon core round, 3B).
 *
 * DATA FILE, FLAGGED IN THE D18 LINT HEADER (`__tests__/no-species-literals.test.ts`):
 * a manifest `file` path (`models/<form>/<dexId>.glb`) is a dex identity in
 * disguise. It is kept here, species-free in spelling, because the defect
 * belongs to the exported ASSET (a skin-weight stray, a broken rest pose),
 * not to the species: a re-export that fixes the file must drop the row, and
 * no other code may key behaviour on these paths. The honest long-term home
 * is a baked manifest `flags` field (a later bake; Q1 baked `types`/`roles` only).
 *
 * `castSlots` always merges these into its exclusions, so every world's cast
 * skips a defective file with no per-world wiring.
 */

export interface CastDefect {
  /** Bucket-relative manifest `file`. */
  file: string;
  /** What is measured to be wrong, with its evidence reference. */
  reason: string;
}

export const CAST_DEFECTS: readonly CastDefect[] = [
  {
    file: 'models/regular/921.glb',
    reason:
      'skin-weight stray renders a forward streak 2.4–8 m past the figure across idle phases (C-104 r2, raw-c104r2-verts.log)',
  },
];

/** The defective files as a set, for `CastExclusions.files`. */
export const CAST_DEFECT_FILES: ReadonlySet<string> = new Set(CAST_DEFECTS.map((d) => d.file));
