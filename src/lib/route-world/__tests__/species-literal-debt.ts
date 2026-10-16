/**
 * D18 species-literal DEBT (D35 core round, L9): per file, the number of
 * species / capitalised-type literals `no-species-literals.test.ts` finds
 * today. Pinned from the lint's OWN first run (2026-09-30), not a hand grep.
 *
 * The lint fails BOTH ways: a file over its count (new debt) and a file under
 * it (paid debt left on the books — lower the count, or delete the row at 0).
 * The per-world staging rounds (4S sakura, 4M mountain, 4C clouds, 3C + 4P
 * plaza) must drive every row to 0 by the end of 4P, by replacing the
 * literal wild pools with `CastSlot` tables and `castSlots`.
 *
 * Q2 (the nurse): the manifest now bakes `roles: ['nurse']` and casting.ts
 * exposes `castRole(manifest, 'nurse')`. CenterDesk.tsx keeps its literal
 * list until the plaza round switches it over (it is not SEAT B's file, and
 * production still serves a manifest without `roles` until the D37 republish,
 * so switching now would drop the nurse in production).
 */
export const SPECIES_LITERAL_DEBT: Readonly<Record<string, number>> = {
  // 3C + 4P plaza: the nurse list (Q2 → castRole(manifest, 'nurse')).
  'src/components/world/evoliga/route/plaza/CenterDesk.tsx': 3,
  // 4C clouds: SKY_WILDS 12, RIDER_BACKFILL_FRONT 3, RIDER_BACKFILL_REAR 6.
  'src/components/world/themes/clouds/furniture/layout.ts': 21,
  // 4M mountain: WILD_SPOTS.
  'src/components/world/themes/mountain/furniture/layout.ts': 9,
  // 4S sakura: WILD_SPOTS.
  'src/components/world/themes/sakura/furniture/layout.ts': 14,
};
